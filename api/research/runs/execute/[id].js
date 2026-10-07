const {call}=require('../../../src/infrastructure/research-control-client');
const {searchJobs}=require('../../../src/application/search-service');
const {scoreEvidence}=require('../../../src/domain/research/scoring');
const {buildRecommendation}=require('../../../src/domain/research/recommendation');
const {buildReport}=require('../../../src/domain/research/report');
const {resolveCandidates}=require('../../../src/domain/research/entity-resolution');
module.exports=async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
 const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();if(!token)return res.status(401).json({error:'UNAUTHORIZED'});
 try{
  let run=(await call({op:'get'},{token})).run;if(!run)return res.status(404).json({error:'NOT_FOUND'});
  if(run.state==='created')run=(await call({op:'transition',target:'planning'},{token})).run;
  if(run.state==='planning')run=(await call({op:'transition',target:'searching'},{token})).run;
  const all={documents:[],sources:[],jobs:[],evidence:[]};
  for(const task of run.tasks||[]){if(task.status!=='pending')continue;await call({op:'task',taskKey:task.task_key,status:'running',attempts:task.attempts||0},{token});try{const r=task.task_type==='search'?await searchJobs(task.query,{location:run.plan?.intent?.location||''}):{documents:[],sources:[],jobs:[],evidence:[]};Object.keys(all).forEach(k=>all[k].push(...r[k]));await call({op:'task',taskKey:task.task_key,status:'completed'},{token})}catch(e){await call({op:'task',taskKey:task.task_key,status:'failed',error:e.message},{token});throw e}}
  run=(await call({op:'transition',target:'extracting'},{token})).run;
  const groups=resolveCandidates(all.jobs),diversity=new Set(all.evidence.map(e=>e.sourceId).filter(Boolean)).size,evidenceScore=scoreEvidence({evidence:all.evidence,sourceDiversity:diversity});
  run=(await call({op:'transition',target:'verifying'},{token})).run;
  const recommendation=buildRecommendation({evidenceScore:evidenceScore.score}),baseReport=buildReport({run,evidence:all.evidence,recommendation}),report={...baseReport,opportunities:groups.length,evidenceScore};
  run=(await call({op:'transition',target:'scoring'},{token})).run;
  run=(await call({op:'ingest',sources:all.sources,documents:all.documents,jobs:all.jobs,evidence:all.evidence,recommendation,report},{token})).run;
  run=(await call({op:'transition',target:'reporting'},{token})).run;
  run=(await call({op:'transition',target:'completed'},{token})).run;
  return res.status(200).json({run,evidenceScore,opportunityGroups:groups.length});
 }catch(error){try{await call({op:'transition',target:'failed'},{token})}catch{}return res.status(error.status||500).json({error:error.code||'RESEARCH_EXECUTION_FAILED',message:error.message})}
};