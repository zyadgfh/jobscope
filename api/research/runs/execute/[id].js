const {call}=require('../../../../src/infrastructure/research-control-client');
const {searchJobs}=require('../../../../src/application/search-service');
const {searchWeb}=require('../../../../src/application/generic-web-search');
const {searchWithProviders}=require('../../../../src/application/provider-search');
const {scoreEvidence}=require('../../../../src/domain/research/scoring');
const {buildRecommendation}=require('../../../../src/domain/research/recommendation');
const {buildReport}=require('../../../../src/domain/research/report');
const {scoreOpportunity}=require('../../../../src/domain/research/opportunity-scoring');
const {scorePersonalFit}=require('../../../../src/domain/research/profile-scoring');
const {evaluateOpportunities}=require('../../../../src/domain/research/decision-engine');
const {detectGaps,buildExpansionQueries}=require('../../../../src/domain/research/gap-detection');

const SEARCH_TYPES=new Set(['search','search_web']);

function providerFor(task,domain){
  if(domain!=='jobs' && task.task_key==='search_web')return 'duckduckgo';
  if(task.task_key==='search_wuzzuf'||/_(wuzzuf)$/.test(task.task_key))return 'wuzzuf';
  if(task.task_key==='search_forasna'||/_(forasna)$/.test(task.task_key))return 'forasna';
  return null;
}

function rebuildJobs(snapshot){
  return (snapshot.opportunities||[]).map(op=>{
    const posting=(snapshot.postings||[]).filter(p=>p.opportunity_id===op.id);
    return {...op,sourceId:posting[0]?.source_id||null,sourceCount:new Set(posting.map(p=>p.source_id).filter(Boolean)).size};
  });
}

function dedupeGapsForExpansion(run,snapshot){
  const jobs=rebuildJobs(snapshot);
  const gaps=detectGaps({
    jobs,
    evidence:snapshot.evidence||[],
    sources:(snapshot.sources||[]).map(s=>({...s,metadata:s.metadata||{}}))
  });
  const maxRounds=Math.min(2,Number(run.plan?.execution?.maxExpansionRounds||0));
  const expansionTasks=(snapshot.run?.tasks||[]).filter(t=>/^expand_/.test(t.task_key));
  const completedRounds=new Set(expansionTasks.map(t=>Number((t.task_key.match(/^expand_(\d+)_/)||[])[1])).filter(Number.isFinite));
  const nextRound=[...completedRounds].reduce((a,b)=>Math.max(a,b),0)+(completedRounds.size?0:1);
  if(gaps.length&&nextRound<=maxRounds)return {gaps,round:nextRound,queries:buildExpansionQueries(run.goal,run.plan?.intent?.location||'',gaps)};
  return {gaps,round:null,queries:[]};
}

async function finalizeRun(run,token){
  const snapshot=await call({op:'snapshot'},{token});
  const snap=snapshot.run;
  const jobs=rebuildJobs(snapshot);
  const enriched=jobs.map(job=>{
    const evidenceForJob=(snap.evidence||[]).filter(e=>jobs.some(j=>j.id===job.id&&j.sourceId===e.source_id));
    const confidence=evidenceForJob.reduce((a,e)=>Math.max(a,Number(e.confidence||0)),0);
    const source=(snap.sources||[]).find(s=>s.id===job.sourceId);
    const objective=scoreOpportunity(job,{sourceReliability:Number(source?.reliability||0),evidenceConfidence:confidence,independentSources:job.sourceCount});
    const fit=run.plan?.domain==='jobs'?scorePersonalFit(job,run.preferences||{}):null;
    return {...job,objectiveScore:objective.score,dataQuality:objective.dataQuality,riskFlags:objective.riskFlags,fitScore:fit?.score??null,fitSignals:fit?.signals??[],sourceCount:job.sourceCount};
  });
  const evaluated=evaluateOpportunities(enriched);
  const ranked=evaluated.sort((a,b)=>b.decisionScore-a.decisionScore).map(item=>({...item,decisionComponents:{objective:item.objectiveScore,fit:item.fitScore,financial:item.financialScore,career:item.careerProfile?.score,risk:item.riskProfile?.score,opportunityCost:item.opportunityCost,weights:item.decisionWeights}}));
  const verificationClaims=[];
  for(const job of jobs){
    const posting=(snapshot.postings||[]).filter(p=>p.opportunity_id===job.id);
    const independent=[...new Set(posting.map(p=>p.source_id).filter(Boolean))];
    if(independent.length>=2){
      verificationClaims.push({
        claim:'The same job opportunity is independently listed across '+independent.length+' sources: '+(job.title||job.canonical_key),
        sourceId:null,
        status:'verified_fact',
        confidence:.9,
        provenance:{canonicalKey:job.canonical_key,evidenceKey:'verify-'+job.canonical_key,verificationMethod:'cross_source_core_v1',independentSources:independent}
      });
    }
  }
  if(verificationClaims.length)await call({op:'ingest',evidence:verificationClaims},{token});
  const allEvidence=(await call({op:'snapshot'},{token})).evidence||[];
  const sourceDiversity=new Set(allEvidence.map(e=>e.source_id).filter(Boolean)).size;
  const evidenceScore=scoreEvidence({evidence:allEvidence,sourceDiversity});
  const best=ranked[0]||null;
  const recommendation=buildRecommendation({domain:run.plan?.domain||'jobs',evidenceScore:evidenceScore.score,fitScore:best?.fitScore??null,opportunities:ranked});
  const gaps=dedupeGapsForExpansion(run,{...snapshot,opportunities:jobs,evidence:allEvidence}).gaps;
  const report=buildReport({run:evaluateRunShell(run),evidence:allEvidence,recommendation,opportunities:ranked,evidenceScore,gaps});
  report.execution={mode:'checkpointed',status:'finalized',stopping:gaps.length?'gaps_remaining':'evidence_sufficient'};
  report.manualSources=(snap.run.tasks||[]).filter(t=>t.status==='blocked_manual').map(t=>t.task_key);
  await call({op:'ingest',
    jobs:ranked.map(item=>({
      canonicalKey:item.canonicalKey||item.canonical_key,
      title:item.title,company:item.company,location:item.location,salary:item.salary,
      requirements:item.requirements,benefits:item.benefits,employment:item.employment,
      decisionScore:item.decisionScore,objectiveScore:item.objectiveScore,dataQuality:item.dataQuality,
      riskFlags:item.riskFlags,fit:item.fitScore===null?null:{score:item.fitScore,signals:item.fitSignals},
      financial:item.financialProfile,career:item.careerProfile,decisionComponents:item.decisionComponents,
      opportunityCost:item.opportunityCost
    })),
    recommendation,report
  },{token});
  let current=(await call({op:'snapshot'},{token})).run;
  if(current.state==='extracting')current=(await call({op:'transition',target:'verifying'},{token})).run;
  if(current.state==='verifying')current=(await call({op:'transition',target:'scoring'},{token})).run;
  if(current.state==='scoring')current=(await call({op:'transition',target:'reporting'},{token})).run;
  if(current.state==='reporting')current=(await call({op:'transition',target:'completed'},{token})).run;
  return {run:current,continue:false,phase:'completed',evidenceScore,opportunityGroups:ranked.length,gaps};
}

function evaluateRunShell(run){return {id:run.id};}

module.exports=async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
  const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
  if(!token)return res.status(401).json({error:'UNAUTHORIZED'});
  try{
    let run=(await call({op:'get'},{token})).run;
    if(!run)return res.status(404).json({error:'NOT_FOUND'});
    if(['completed','cancelled','failed'].includes(run.state))return res.status(200).json({run,continue:false,phase:run.state});
    if(run.state==='paused')return res.status(409).json({error:'PAUSED_RUN'});
    if(run.state==='created')run=(await call({op:'transition',target:'planning'},{token})).run;
    if(run.state==='planning')run=(await call({op:'transition',target:'searching'},{token})).run;

    const pendingSearch=(run.tasks||[]).find(t=>t.status==='pending'&&(SEARCH_TYPES.has(t.task_type)||t.task_key==='search_web'||t.task_type==='search'));
    if(pendingSearch){
      const provider=providerFor(pendingSearch,run.plan?.domain||'jobs');
      if(!provider){
        await call({op:'task',taskKey:pendingSearch.task_key,status:'blocked_manual'},{token});
        return res.status(200).json({run:(await call({op:'snapshot'},{token})).run,continue:true,phase:'searching'});
      }
      await call({op:'task',taskKey:pendingSearch.task_key,status:'running',attempts:pendingSearch.attempts||0},{token});
      try{
        const result=provider==='duckduckgo'
          ?await searchWithProviders(pendingSearch.query,{location:run.plan?.intent?.location||'',maxResults:3})
          :await searchJobs(pendingSearch.query,{location:run.plan?.intent?.location||'',sourceIds:[provider]});
        await call({op:'ingest',sources:result.sources||[],documents:result.documents||[],jobs:(result.jobs||[]).map(j=>({...j,sourceKey:j.sourceId})),evidence:result.evidence||[]},{token});
        await call({op:'task',taskKey:pendingSearch.task_key,status:'completed'},{token});
      }catch(error){
        await call({op:'task',taskKey:pendingSearch.task_key,status:'failed',error:error.message},{token});
      }
      return res.status(200).json({run:(await call({op:'snapshot'},{token})).run,continue:true,phase:'searching'});
    }

    const snap=await call({op:'snapshot'},{token});
    run=snap.run;
    for(const task of run.tasks||[])if(task.task_type==='manual_research'&&task.status==='pending')await call({op:'task',taskKey:task.task_key,status:'blocked_manual'},{token});

    const expansion=dedupeGapsForExpansion(run,snap);
    const hasPendingExpansion=(run.tasks||[]).some(t=>t.status==='pending'&&/^expand_/.test(t.task_key));
    if(expansion.round&&expansion.queries.length&&!hasPendingExpansion){
      const round=expansion.round;
      const existing=(run.tasks||[]).filter(t=>/^expand_/.test(t.task_key)).length;
      const query=expansion.queries[existing%expansion.queries.length];
      const provider=existing%2===0?'wuzzuf':'forasna';
      const taskKey='expand_'+round+'_'+(existing+1)+'_'+provider;
      await call({op:'task',taskKey,status:'pending',createIfMissing:true,taskType:'search',query,attempts:0},{token});
      return res.status(200).json({run:(await call({op:'snapshot'},{token})).run,continue:true,phase:'expanding'});
    }

    if(run.state==='searching')run=(await call({op:'transition',target:'extracting'},{token})).run;
    if(run.state==='extracting'||run.state==='verifying'||run.state==='scoring'||run.state==='reporting')
      return res.status(200).json(await finalizeRun(run,token));

    return res.status(200).json({run,continue:true,phase:run.state});
  }catch(error){
    try{await call({op:'transition',target:'failed'},{token})}catch{}
    return res.status(error.status||500).json({error:error.code||'RESEARCH_EXECUTION_FAILED',message:error.message});
  }
};
