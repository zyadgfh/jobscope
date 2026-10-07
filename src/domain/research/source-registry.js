const SOURCES=[
 {id:'wuzzuf',name:'Wuzzuf',kind:'job_board',domains:['wuzzuf.net'],access:'public_page_or_official_api',reliability:.75},
 {id:'forasna',name:'Forasna',kind:'job_board',domains:['forasna.com'],access:'public_page_or_official_api',reliability:.7},
 {id:'linkedin',name:'LinkedIn Jobs',kind:'job_board',domains:['linkedin.com'],access:'official_api_or_permitted_public_access',reliability:.85},
 {id:'official_company',name:'Official company careers',kind:'official',domains:[],access:'public_page_or_official_api',reliability:.95}
];
function listSources(){return SOURCES.map(x=>({...x,domains:[...x.domains]}))}
function findSource(url){try{const host=new URL(url).hostname.toLowerCase();return SOURCES.find(s=>s.domains.some(d=>host===d||host.endsWith('.'+d)))||null}catch{return null}}
module.exports={SOURCES,listSources,findSource};
