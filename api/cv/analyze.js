const OWNER_EMAIL = (process.env.OWNER_EMAIL || 'zyadgamal796@gmail.com').toLowerCase();
const ANON_KEY = process.env.SUPABASE_ANON_KEY || '';
const ALLOWED = new Set(['application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','text/plain','application/rtf','text/rtf','application/vnd.oasis.opendocument.text']);
const SKILLS = ['javascript','typescript','python','sql','postgresql','mysql','excel','power bi','tableau','react','node.js','node','aws','azure','docker','kubernetes','git','api','rest','graphql','project management','data analysis','research','communication','arabic','english'];
function bearer(req){return String(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim()}
async function userFromToken(token){const url=process.env.SUPABASE_URL||'https://mtziqpyvgebthoynalbq.supabase.co';if(!ANON_KEY||!token)return null;const r=await fetch(url+'/auth/v1/user',{headers:{apikey:ANON_KEY,authorization:'Bearer '+token}});if(!r.ok)return null;return r.json()}
module.exports=async function handler(req,res){
  if(req.method!=='POST')return res.status(405).json({error:'METHOD_NOT_ALLOWED'});
  const user=await userFromToken(bearer(req));
  if(!user||String(user.email||'').toLowerCase()!==OWNER_EMAIL)return res.status(401).json({error:'OWNER_AUTH_REQUIRED'});
  const body=req.body||{};
  if(body.consent!==true)return res.status(400).json({error:'CV_CONSENT_REQUIRED'});
  const size=Number(body.size||0),type=String(body.type||'').toLowerCase();
  if(size>20*1024*1024)return res.status(413).json({error:'CV_TOO_LARGE',message:'Maximum CV size is 20 MB'});
  if(!ALLOWED.has(type))return res.status(415).json({error:'CV_FORMAT_UNSUPPORTED',message:'Supported formats: PDF, DOCX, TXT, RTF and ODT'});
  const text=String(body.text||'').replace(/\s+/g,' ').trim().slice(0,400000);
  if(!text)return res.status(422).json({error:'CV_TEXT_REQUIRED',message:'Extract text locally before sending it for analysis'});
  const lower=text.toLowerCase();
  const skills=[...new Set(SKILLS.filter(skill=>lower.includes(skill)))];
  return res.status(200).json({skills,provider:'local-edge-deterministic',stored:false,deletedAfterAnalysis:true,sourceFormat:type,notice:'The original CV is not stored. OCR is not included in this release.'});
};
