const {call}=require('../../../../src/infrastructure/research-control-client');
const {searchJobs}=require('../../../../src/application/search-service');
const {scoreEvidence}=require('../../../../src/domain/research/scoring');
const {buildRecommendation}=require('../../../../src/domain/research/recommendation');
const {buildReport}=require('../../../../src/domain/research/report');
const {resolveCandidates}=require('../../../../src/domain/research/entity-resolution');
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
   await call({op:'task',taskKey:task.task_key,status:'running',attempts:task.attempts||0},{token});
   try{
    const provider=task.task_key==='search_wuzzuf'?'wuzzuf':task.task_key==='search_forasna'?'forasna':null;
    if(!provider){await call({op:'task',taskKey:task.task_key,status:'blocked_manual'},{token});continue}
    const r=await searchJobs(task.query,{location:run.plan?.intent?.location||'',sourceIds:[provider]});
    for(const key of Object.keys(all))all[key].push(...r[key]);
    await call({op:'task',taskKey:task.task_key,status:'completed'},{token});
   }catch(e){await call({op:'task',taskKey:task.task_key,status:'failed',error:e.message},{token});throw e}
  }
  for(const task of run.tasks||[]){if(task.task_type==='manual_research'&&task.status==='pending')await call({op:'task',taskKey:task.task_key,status:'blocked_manual'},{token})}
  run=(await call({op:'transition',target:'extracting'},{token})).run;
  const groups=resolveCandidates(all.jobs);
  const scoredGroups=groups.map(group=>{const independentSources=new Set(group.postings.map(p=>p.sourceId).filter(Boolean)).size;const evidenceConfidence=all.evidence.filter(e=>group.postings.some(p=>p.canonicalKey===group.key&&p.sourceId===e.sourceId)).reduce((a,e)=>Math.max(a,e.confidence||0),0);const sourceReliability=all.sources.filter(s=>group.postings.some(p=>p.url&&s.metadata?.provider===p.sourceId)).reduce((a,s)=>Math.max(a,s.reliability||0),0);const scoring=scoreOpportunity(group.representative,{sourceReliability,evidenceConfidence,independentSources});const personalFit=scorePersonalFit(group.representative,run.preferences||{});const decisionScore=personalFit===null?scoring.score:Number((scoring.score*.65+personalFit.score*.35).toFixed(2));return {...group,decisionScore,dataQuality:scoring.dataQuality,riskFlags:scoring.riskFlags,fitScore:personalFit?.score??null,fitSignals:personalFit?.signals??[],scoreComponents:scoring.components}});const ranked=rankOpportunities(scoredGroups);
  const verificationTask=(run.tasks||[]).find(t=>t.task_key==='verify_cross_source');
  if(verificationTask?.status==='pending')await call({op:'task',taskKey:'verify_cross_source',status:'running',attempts:verificationTask.attempts||0},{token});
  const verified=groups.filter(g=>new Set(g.postings.map(p=>p.sourceId).filter(Boolean)).size>=2).map(g=>({claim:'The same job opportunity is independently listed across '+new Set(g.postings.map(p=>p.sourceId)).size+' sources: '+(g.representative.title||g.key),sourceId:g.representative.sourceId,status:'verified_fact',confidence:.9,provenance:{canonicalKey:g.key,evidenceKey:'verify-'+g.key,verificationMethod:'cross_source_core_v1',independentSources:[...new Set(g.postings.map(p=>p.sourceId).filter(Boolean))],postings:g.postings.map(p=>p.url).filter(Boolean)}}));
  const jobsToStore=all.jobs.map(job=>{const g=ranked.find(x=>x.key===job.canonicalKey);return g?{...job,decisionScore:g.decisionScore,dataQuality:g.dataQuality,riskFlags:g.riskFlags,fit:g.fitScore===null?null:{score:g.fitScore,signals:g.fitSignals}}:job});
  run=(await call({op:'ingest',sources:all.sources,documents:all.documents,jobs:jobsToStore,evidence:all.evidence},{token})).run;
  run=(await call({op:'transition',target:'verifying'},{token})).run;
  if(verified.length){const relations=[];for(const v of verified){for(const e of all.evidence.filter(x=>x.provenance?.canonicalKey===v.provenance?.canonicalKey&&x.sourceId&&v.provenance.independentSources.includes(x.sourceId)&&x.sourceId!==v.sourceId)){relations.push({evidenceKey:v.provenance.evidenceKey,relatedEvidenceKey:e.provenance.evidenceKey,relation:'supports'})}}run=(await call({op:'ingest',evidence:verified,relations},{token})).run;}
  if(verificationTask?.status==='pending')await call({op:'task',taskKey:'verify_cross_source',status:'completed'},{token});
  const finalEvidence=all.evidence.concat(verified),diversity=new Set(finalEvidence.map(e=>e.sourceId).filter(Boolean)).size,evidenceScore=scoreEvidence({evidence:finalEvidence,sourceDiversity:diversity}),recommendation=buildRecommendation({evidenceScore:evidenceScore.score}),report={...buildReport({run,evidence:finalEvidence,recommendation}),opportunities:groups.length,evidenceScore,manualSources:(run.tasks||[]).filter(t=>t.status==='blocked_manual').map(t=>t.task_key)};
  run=(await call({op:'transition',target:'scoring'},{token})).run;
  run=(await call({op:'ingest',recommendation,report},{token})).run;
  run=(await call({op:'transition',target:'reporting'},{token})).run;
  run=(await call({op:'transition',target:'completed'},{token})).run;
  return res.status(200).json({run,evidenceScore,opportunityGroups:groups.length});
 }catch(error){try{await call({op:'transition',target:'failed'},{token})}catch{}return res.status(error.status||500).json({error:error.code||'RESEARCH_EXECUTION_FAILED',message:error.message})}
};
