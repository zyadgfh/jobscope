const {call}=require('../../../src/infrastructure/research-control-client');
const {searchJobs}=require('../../../src/application/search-service');
const {scoreEvidence}=require('../../../src/domain/research/scoring');
const {buildRecommendation}=require('../../../src/domain/research/recommendation');
const {buildReport}=require('../../../src/domain/research/report');
const {resolveCandidates}=require('../../../src/domain/research/entity-resolution');

module.exports=async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
 const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
 if(!token)return res.status(401).json({error:'UNAUTHORIZED'});
 try{
   let current=(await call({op:'get'},{token})).run;
   if(!current)return res.status(404).json({error:'NOT_FOUND'});
   if(['completed','cancelled'].includes(current.state))return res.status(200).json({run:current});
   if(current.state==='created')current=(await call({op:'transition',target:'planning'},{token})).run;
   if(current.state==='planning')current=(await call({op:'transition',target:'searching'},{token})).run;
   const all={documents:[],sources:[],jobs:[],evidence:[]};
   for(const task of current.tasks||[]){
     if(task.status!=='pending')continue;
     await call({op:'task',taskKey:task.task_key,status:'running',attempts:task.attempts||0},{token});
     try{
       const r=task.task_type==='search'?await searchJobs(task.query,{location:current.plan?.intent?.location||''}):{documents:[],sources:[],jobs:[],evidence:[]};
       all.documents.push(...r.documents);all.sources.push(...r.sources);all.jobs.push(...r.jobs);all.evidence.push(...r.evidence);
       await call({op:'task',taskKey:task.task_key,status:'completed'},{token});
     }catch(error){await call({op:'task',taskKey:task.task_key,status:'failed',error:error.message},{token});throw error}
   }
   current=(await call({op:'transition',target:'extracting'},{token})).run;
   const grouped=resolveCandidates(all.jobs);
   const sourceDiversity=new Set(all.evidence.map(e=>e.sourceId).filter(Boolean)).size;
   const evidenceScore=scoreEvidence({evidence:all.evidence,sourceDiversity});
   current=(await call({op:'transition',target:'verifying'},{token})).run;
   const recommendation=buildRecommendation({evidenceScore:evidenceScore.score});
   const report=buildReport({run:current,evidence:all.evidence,recommendation});
   current=(await call({op:'transition',target:'scoring'},{token})).run;
   current=(await call({op:'ingest',sources:all.sources,documents:all.documents,jobs:all.jobs,evidence:all.evidence,recommendation,report:{...report,opportunities:grouped.length,evidenceScore}},{token})).run;
   current=(await call({op:'transition',target:'reporting'},{token})).run;
   current=(await call({op:'transition',target:'completed'},{token})).run;
   return res.status(200).json({run:current,evidenceScore,opportunityGroups:grouped.length});
 }catch(error){
   try{await call({op:'transition',target:'failed'},{token})}catch{}
   const status=error.status||500;return res.status(status>=400&&status<600?status:500).json({error:error.code||'RESEARCH_EXECUTION_FAILED',message:error.message});
 }
};