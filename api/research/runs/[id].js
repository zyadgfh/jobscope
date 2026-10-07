const {call}=require('../../../src/infrastructure/research-control-client');
module.exports=async function handler(req,res){
 const token=String(req.headers.authorization||'').trim();if(!token)return res.status(401).json({error:'UNAUTHORIZED'});
 try{
  if(req.method==='GET')return res.status(200).json(await call({op:'get'},{token}));
  if(req.method==='POST'){
   const action=String(req.query.action||'');
   const target=action==='resume'?'resume':action;
   if(!['pause','resume','cancel'].includes(action))return res.status(400).json({error:'INVALID_ACTION'});
   return res.status(200).json(await call({op:'transition',target},{token}));
  }
  return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
 }catch(error){return res.status(error.status||400).json({error:error.code||'BAD_REQUEST',message:error.message})}
};