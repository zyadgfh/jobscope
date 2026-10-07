function strip(v=''){return String(v).replace(/<[^>]*>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim()}
function collectLdJson(html=''){const out=[];const re=/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;let m;while((m=re.exec(html))){try{const v=JSON.parse(m[1]);if(Array.isArray(v))out.push(...v);else out.push(v)}catch{}}return out.flatMap(x=>Array.isArray(x?.['@graph'])?x['@graph']:[x]).filter(Boolean)}
function isJob(x){const t=x?.['@type'];return t==='JobPosting'||(Array.isArray(t)&&t.includes('JobPosting'))}
function textLocation(v){if(!v)return '';const a=v.address||v;return [a.addressLocality,a.addressRegion,a.addressCountry].filter(Boolean).join(', ')}
function salary(v){if(!v)return null;const x=v.value;return {currency:v.currency||v.currencyCode||null,amount:typeof x==='object'?{min:x.minValue,max:x.maxValue,value:x.value}:x}}
function extractJobPostings(html,url){const jobs=[];for(const x of collectLdJson(html).filter(isJob)){jobs.push({title:strip(x.title),company:strip(x.hiringOrganization?.name||x.hiringOrganization),location:textLocation(x.jobLocation),salary:salary(x.baseSalary),employment:{type:x.employmentType||null,datePosted:x.datePosted||null,validThrough:x.validThrough||null,directApply:x.directApply??null,workMode:x.jobLocationType==='TELECOMMUTE'?'remote':/remote/i.test(String(x.jobLocationType||''))?'remote':'onsite'},description:strip(x.description).slice(0,12000),url:x.url||url,rawData:x,confidence:.92,extraction:'json-ld'})}if(jobs.length)return jobs;const seen=new Set(),re=/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;let m;while((m=re.exec(html))&&jobs.length<50){const href=new URL(m[1],url).toString(),label=strip(m[2]);if(!label||label.length<5||label.length>180)continue;if(!/\/(job|jobs)\//i.test(href)||seen.has(href))continue;seen.add(href);jobs.push({title:label,company:'',location:'',salary:null,employment:{},description:'',url:href,rawData:{listingLabel:label},confidence:.55,extraction:'listing-link'})}return jobs}
module.exports={extractJobPostings,strip};
function parseTextSalary(text=''){
 const cleanText=strip(text).replace(/,/g,'');
 const m=cleanText.match(/(?:EGP|جنيه(?:s+مصري)?|LE)\s*(\d{4,6})(?:\s*(?:-|–|to|إلى)\s*(\d{4,6}))?|(?:\b)(\d{4,6})\s*(?:-|–|to|إلى)\s*(\d{4,6})\s*(?:EGP|جنيه|LE)\b/i);
 if(!m)return null;
 const min=Number(m[1]||m[3]),max=Number(m[2]||m[4]||min);if(!Number.isFinite(min)||!Number.isFinite(max))return null;
 return {currency:'EGP',amount:{min,max,value:min===max?min:null},source:'text_pattern',confidence:.55};
}
const _extractJobPostings=extractJobPostings;
function extractJobPostingsWithTextSalary(html,url){
 const jobs=_extractJobPostings(html,url);
 if(jobs.length)return jobs;
 const salaryValue=parseTextSalary(html);
 if(!salaryValue)return jobs;
 return jobs;
}
module.exports.parseTextSalary=parseTextSalary;
