const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'zyadgamal796@gmail.com').toLowerCase();
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mtziqpyvgebthoynalbq.supabase.co';
const ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
function token(req){return String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim()}
async function owner(req){const t=token(req);if(!t||!ANON_KEY)return null;const r=await fetch(SUPABASE_URL+'/auth/v1/user',{headers:{apikey:ANON_KEY,authorization:'Bearer '+t}});if(!r.ok)return null;const u=await r.json();return String(u.email||'').toLowerCase()===OWNER_EMAIL?u:null}
async function rest(path,opts={},t=''){const r=await fetch(SUPABASE_URL+'/rest/v1/'+path,{...opts,headers:{apikey:ANON_KEY,authorization:'Bearer '+t,'content-type':'application/json',...(opts.headers||{})}});const text=await r.text();let data;try{data=JSON.parse(text)}catch{data=text}if(!r.ok)throw new Error(data?.message||'database request failed');return data}
module.exports=async function handler(req,res){
  const u=await owner(req);if(!u)return res.status(401).json({error:'OWNER_AUTH_REQUIRED'});
  try{
    if(req.method==='GET'){
      const t=token(req), [providers,alerts,usage]=await Promise.all([
        rest('jobscope_provider_settings?select=provider,enabled,priority,fallback_mode,secret_ref,updated_at&owner_id=eq.'+u.id+'&order=priority.asc',{},t),
        rest('jobscope_alert_settings?select=enabled,updated_at&owner_id=eq.'+u.id+'&limit=1',{},t),
        rest('jobscope_usage_daily?select=usage_date,searches,provider_requests,cv_analyses,errors&owner_id=eq.'+u.id+'&order=usage_date.desc&limit=30',{},t)
      ]);
      return res.status(200).json({providers,alerts:alerts[0]||{enabled:false},usage});
    }
    if(req.method==='POST'){
      const body=req.body||{};
      if(body.kind==='provider'){
        const provider=['duckduckgo','brave','tavily'].includes(body.provider)?body.provider:null;if(!provider)return res.status(400).json({error:'INVALID_PROVIDER'});
        const t=token(req),row=(await rest('jobscope_provider_settings?select=*&owner_id=eq.'+u.id+'&provider=eq.'+provider+'&limit=1',{},t))[0];
        const payload={owner_id:u.id,provider,enabled:body.enabled!==false,priority:Number.isFinite(Number(body.priority))?Number(body.priority):100,fallback_mode:['fallback','stop','manual'].includes(body.fallback_mode)?body.fallback_mode:'fallback',secret_ref:row?.secret_ref||null,updated_at:new Date().toISOString()};
        const data=await rest(row?'jobscope_provider_settings?id=eq.'+row.id:'jobscope_provider_settings',{method:row?'PATCH':'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(payload)},t);return res.status(200).json({provider:data[0]||payload});
      }
      if(body.kind==='alert'){
        const payload={owner_id:u.id,enabled:body.enabled===true,updated_at:new Date().toISOString()};
        const t=token(req),existing=(await rest('jobscope_alert_settings?select=owner_id&owner_id=eq.'+u.id+'&limit=1',{},t))[0];
        const data=await rest(existing?'jobscope_alert_settings?owner_id=eq.'+u.id:'jobscope_alert_settings',{method:existing?'PATCH':'POST',headers:{Prefer:'return=representation'},body:JSON.stringify(payload)},t);return res.status(200).json({alerts:data[0]||payload,secretStorage:'Configure webhook secret outside the database/Vault before enabling.'});
      }
    }
    return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
  }catch(error){return res.status(500).json({error:'ADMIN_SETTINGS_FAILED',message:error.message})}
};
