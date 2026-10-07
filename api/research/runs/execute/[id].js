const {call}=require('../../../../src/infrastructure/research-control-client');
const {searchJobs}=require('../../../../src/application/search-service');
const {scoreEvidence}=require('../../../../src/domain/research/scoring');
const {buildRecommendation}=require('../../../../src/domain/research/recommendation');
const {buildReport}=require('../../../../src/domain/research/report');
const {resolveCandidates}=require('../../../../src/domain/research/entity-resolution');
const {scoreOpportunity,rankOpportunities}=require('../../../../src/domain/research/opportunity-scoring');
const {scorePersonalFit}=require('../../../../src/domain/research/profile-scoring');
const {detectGaps,buildExpansionQueries}=require('../../../../src/domain/research/gap-detection');

async function runSearchTask(task,run,token,all,provider){
  await call({op:'task',taskKey:task.task_key,status:'running',attempts:task.attempts||0},{token});
  try{
    const r=await searchJobs(task.query,{location:run.plan?.intent?.location||'',sourceIds:[provider]});
    for(const key of Object.keys(all))all[key].push(...r[key]);
    await call({op:'task',taskKey:task.task_key,status:'completed'},{token});
  }catch(error){
    await call({op:'task',taskKey:task.task_key,status:'failed',error:error.message},{token});
    throw error;
  }
}
function appendResults(all,r){for(const key of Object.keys(all))all[key].push(...r[key])}

module.exports=async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
 const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();if(!token)return res.status(401).json({error:'UNAUTHORIZED'});
 try{
  let run=(await call({op:'get'},{token})).run;if(!run)return res.status(404).json({error:'NOT_FOUND'});
  if(['completed','cancelled','failed'].includes(run.state))return res.status(200).json({run});
  if(run.state==='paused')return res.status(409).json({error:'PAUSED_RUN',message:'Resume the run before executing it again.'});
  if(run.state==='created')run=(await call({op:'transition',target:'planning'},{token})).run;
  if(run.state==='planning')run=(await call({op:'transition',target:'searching'},{token})).run;

  const all={documents:[],sources:[],jobs:[],evidence:[]};
  for(const task of run.tasks||[]){
    if(task.status!=='pending'||task.task_type!=='search')continue;
    const provider=task.task_key==='search_wuzzuf'||task.task_key.startsWith('expand_')&&task.task_key.endsWith('_wuzzuf')?'wuzzuf':task.task_key==='search_forasna'||task.task_key.startsWith('expand_')&&task.task_key.endsWith('_forasna')?'forasna':null;
    if(!provider){await call({op:'task',taskKey:task.task_key,status:'blocked_manual'},{token});continue}
    await runSearchTask(task,run,token,all,provider);
  }
  for(const task of run.tasks||[])if(task.task_type==='manual_research'&&task.status==='pending')await call({op:'task',taskKey:task.task_key,status:'blocked_manual'},{token});

  const maxRounds=Math.min(2,Number(run.plan?.execution?.maxExpansionRounds||0));
  let round=0,gaps=detectGaps(all);
  while(round<maxRounds&&gaps.length){
    round++;
    const expansions=buildExpansionQueries(run.goal,run.plan?.intent?.location||'',gaps);
    for(const provider of ['wuzzuf','forasna']){
      for(let i=0;i<expansions.length;i++){
        const taskKey='expand_'+round+'_'+(i+1)+'_'+provider;
        const q=expansions[i];
        await call({op:'task',taskKey,status:'running',createIfMissing:true,taskType:'search',query:q,attempts:0},{token});
        try{
          const r=await searchJobs(q,{location:run.plan?.intent?.location||'',sourceIds:[provider]});
          appendResults(all,r);
          await call({op:'task',taskKey,status:'completed'},{token});
        }catch(error){
          await call({op:'task',taskKey,status:'failed',error:error.message},{token});
        }
      }
    }
    gaps=detectGaps(all);
  }

  run=(await call({op:'transition',target:'extracting'},{token})).run;
  const groups=resolveCandidates(all.jobs);
  const scoredGroups=groups.map(group=>{
    const independentSources=new Set(group.postings.map(p=>p.sourceId).filter(Boolean)).size;
    const evidenceForGroup=all.evidence.filter(e=>group.postings.some(p=>p.canonicalKey===group.key&&p.sourceId===e.sourceId));
    const evidenceConfidence=evidenceForGroup.reduce((a,e)=>Math.max(a,e.confidence||0),0);
    const sourceReliability=all.sources.filter(s=>group.postings.some(p=>s.metadata?.provider===p.sourceId)).reduce((a,s)=>Math.max(a,s.reliability||0),0);
    const objective=scoreOpportunity(group.representative,{sourceReliability,evidenceConfidence,independentSources});
    const fit=scorePersonalFit(group.representative,run.preferences||{});
    const decisionScore=fit===null?objective.score:Number((objective.score*.65+fit.score*.35).toFixed(2));
    return {...group,decisionScore,dataQuality:objective.dataQuality,riskFlags:objective.riskFlags,fitScore:fit?.score??null,fitSignals:fit?.signals??[],scoreComponents:objective.components};
  });
  const ranked=rankOpportunities(scoredGroups);
  const verificationTask=(run.tasks||[]).find(t=>t.task_key==='verify_cross_source');
  if(verificationTask?.status==='pending')await call({op:'task',taskKey:'verify_cross_source',status:'running',attempts:verificationTask.attempts||0},{token});

  const verified=groups.filter(g=>new Set(g.postings.map(p=>p.sourceId).filter(Boolean)).size>=2).map(g=>({
    claim:'The same job opportunity is independently listed across '+new Set(g.postings.map(p=>p.sourceId)).size+' sources: '+(g.representative.title||g.key),
    sourceId:g.representative.sourceId,status:'verified_fact',confidence:.9,
    provenance:{canonicalKey:g.key,evidenceKey:'verify-'+g.key,verificationMethod:'cross_source_core_v1',independentSources:[...new Set(g.postings.map(p=>p.sourceId).filter(Boolean))],postings:g.postings.map(p=>p.url).filter(Boolean)}
  }));

  const jobsToStore=all.jobs.map(job=>{const g=ranked.find(x=>x.key===job.canonicalKey);return g?{...job,decisionScore:g.decisionScore,dataQuality:g.dataQuality,riskFlags:g.riskFlags,fit:g.fitScore===null?null:{score:g.fitScore,signals:g.fitSignals}}:job});
  run=(await call({op:'ingest',sources:all.sources,documents:all.documents,jobs:jobsToStore,evidence:all.evidence},{token})).run;
  run=(await call({op:'transition',target:'verifying'},{token})).run;

  if(verified.length){
    const relations=[];
    for(const v of verified){
      for(const e of all.evidence.filter(x=>x.provenance?.canonicalKey===v.provenance?.canonicalKey&&x.sourceId&&v.provenance.independentSources.includes(x.sourceId)&&x.sourceId!==v.sourceId))
        relations.push({evidenceKey:v.provenance.evidenceKey,relatedEvidenceKey:e.provenance.evidenceKey,relation:'supports'});
    }
    run=(await call({op:'ingest',evidence:verified,relations},{token})).run;
  }
  if(verificationTask?.status==='pending')await call({op:'task',taskKey:'verify_cross_source',status:'completed'},{token});

  const finalEvidence=all.evidence.concat(verified);
  const diversity=new Set(finalEvidence.map(e=>e.sourceId).filter(Boolean)).size;
  const evidenceScore=scoreEvidence({evidence:finalEvidence,sourceDiversity:diversity});
  const best=ranked[0]||null;
  const recommendation=buildRecommendation({evidenceScore:evidenceScore.score,fitScore:best?.fitScore??null,opportunities:ranked});
  const report=buildReport({run,evidence:finalEvidence,recommendation,opportunities:ranked,evidenceScore,gaps});
  report.manualSources=(run.tasks||[]).filter(t=>t.status==='blocked_manual').map(t=>t.task_key);
  report.execution={expansionRounds:round,maxExpansionRounds:maxRounds,stopping:gaps.length?'gaps_remaining':'evidence_sufficient'};

  run=(await call({op:'transition',target:'scoring'},{token})).run;
  run=(await call({op:'ingest',recommendation,report},{token})).run;
  run=(await call({op:'transition',target:'reporting'},{token})).run;
  run=(await call({op:'transition',target:'completed'},{token})).run;
  return res.status(200).json({run,evidenceScore,opportunityGroups:ranked.length,gaps});
 }catch(error){
  try{await call({op:'transition',target:'failed'},{token})}catch{}
  return res.status(error.status||500).json({error:error.code||'RESEARCH_EXECUTION_FAILED',message:error.message});
 }
};
