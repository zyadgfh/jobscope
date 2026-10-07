const {call}=require('../../../src/infrastructure/research-control-client');
const {buildQueryPlan}=require('../../../src/domain/research/query-planner');
module.exports=async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
 const body=req.body||{};
 try{
  const plan=buildQueryPlan({goal:body.goal,location:body.location||'',domain:body.domain||'jobs'});plan.execution={depth:body.depth==='deep'?'deep':'auto',maxExpansionRounds:body.depth==='deep'?2:1};
  const result=await call({op:'create',goal:body.goal,mode:body.depth==='deep'?'quality':(body.mode||'balanced'),preferences:body.preferences||{},plan});
  return res.status(201).json(result);
 }catch(error){return res.status(error.status||400).json({error:error.code||'BAD_REQUEST',message:error.message})}
};