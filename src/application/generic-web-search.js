const {fetchPublicSource}=require('./source-fetcher');
const {strip}=require('../domain/research/jobposting-extractor');

function extractResultLinks(html,base='https://html.duckduckgo.com/'){
 const out=[],seen=new Set(),re=/<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
 let m;
 while((m=re.exec(html))&&out.length<8){
  let href;try{href=new URL(m[1],base);const uddg=href.searchParams.get('uddg');if(uddg)href=new URL(uddg)}catch{continue}
  if(!['http:','https:'].includes(href.protocol)||/duckduckgo\.com$/i.test(href.hostname)||seen.has(href.toString()))continue;
  seen.add(href.toString());out.push({url:href.toString(),title:strip(m[2])});
 }
 return out;
}
function extractGeneralClaims(html,url){
 const claims=[],title=(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)||[])[1],description=(html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)||[])[1];
 if(title)claims.push({claim:'Page title states: '+strip(title).slice(0,500),status:'reported',confidence:.7,provenance:{url,extraction:'html-title',evidenceKey:'title:'+url}});
 if(description)claims.push({claim:'Page description states: '+strip(description).slice(0,1000),status:'reported',confidence:.65,provenance:{url,extraction:'meta-description',evidenceKey:'description:'+url}});
 return claims;
}
async function searchWeb(query,{location='',maxResults=3}={}){
 const q=encodeURIComponent([query,location].filter(Boolean).join(' '));
 const discoveryUrl='https://html.duckduckgo.com/html/?q='+q;
 const discovery=await fetchPublicSource(discoveryUrl,{timeoutMs:9000,maxBytes:1000000});
 const links=extractResultLinks(discovery.content,discoveryUrl).slice(0,maxResults);
 const sources=[{sourceKey:'ddg',canonical_url:discoveryUrl,source_type:'search_engine',reliability:.6,metadata:{provider:'duckduckgo',query,location}}];
 const documents=[{...discovery,content:discovery.content.slice(0,200000),metadata:{storedContentTruncated:discovery.content.length>200000}}],evidence=[];
 const pages=await Promise.all(links.map(async link=>{
  try{
   const doc=await fetchPublicSource(link.url,{timeoutMs:8000,maxBytes:1000000,allowUnregistered:true});
   const sourceKey='page:'+link.url;
   sources.push({sourceKey,canonical_url:link.url,source_type:'web',reliability:.5,metadata:{provider:'web_public',discoveredBy:'duckduckgo',query,location,title:link.title}});
   documents.push({...doc,content:doc.content.slice(0,200000),metadata:{...(doc.metadata||{}),storedContentTruncated:doc.content.length>200000}});
   return extractGeneralClaims(doc.content,link.url).map(x=>({...x,sourceId:sourceKey}));
  }catch{return []}
 }));
 for(const list of pages)evidence.push(...list);
 return {sources,documents,evidence,links};
}
module.exports={searchWeb,extractResultLinks,extractGeneralClaims};
