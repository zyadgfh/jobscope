const {fetchPublicSource}=require('../../../src/application/source-fetcher');
const buckets=new Map();
module.exports=async function handler(req,res){
 if(req.method!=='POST')return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
 const ip=String(req.headers['x-forwarded-for']||'unknown').split(',')[0].trim();
 const now=Date.now(),bucket=buckets.get(ip)||{at:now,count:0};
 if(now-bucket.at>60000){bucket.at=now;bucket.count=0}
 bucket.count++;buckets.set(ip,bucket);
 if(bucket.count>10)return res.status(429).json({error:'RATE_LIMITED'});
 try{const body=req.body||{};const doc=await fetchPublicSource(String(body.url||''));return res.status(200).json({document:doc})}
 catch(error){const status=error.message.includes('private')||error.message.includes('credentials')?400:error.message.includes('not registered')?403:502;return res.status(status).json({error:error.code||'SOURCE_FETCH_FAILED',message:error.message})}
};