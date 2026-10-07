const {call}=require('../../../../src/infrastructure/research-control-client');
module.exports=async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
 const token=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();if(!token)return res.status(401).json({error:'UNAUTHORIZED'});
 const body=req.body||{};
 const evidence=Array.isArray(body.evidence)?body.evidence.map(e=>({...e,status:e.status==='verified_fact'?'reported':(e.status||'reported'),provenance:{...(e.provenance||{}),retrievalMethod:'manual_user_supplied'}})): [];
 try{return res.status(200).json(await call({op:'ingest',evidence,jobs:Array.isArray(body.jobs)?body.jobs:[],sources:Array.isArray(body.sources)?body.sources:[]},{token}))}
 catch(error){return res.status(error.status||400).json({error:error.code||'BAD_REQUEST',message:error.message})}
};