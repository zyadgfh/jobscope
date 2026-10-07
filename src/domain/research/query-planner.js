function normalizeGoal(goal){return String(goal||'').trim().replace(/\s+/g,' ')}
function buildQueryPlan({goal,location='',domain='jobs'}){const g=normalizeGoal(goal),loc=normalizeGoal(location);if(!g)throw Object.assign(new Error('goal is required'),{code:'INVALID_GOAL'});if(domain!=='jobs'){const queries=[g,loc&&g+' '+loc,'official '+g+' '+loc,'research '+g+' '+loc,'statistics '+g+' '+loc].filter(Boolean);return {version:'1.2',domain,intent:{goal:g,location:loc},tasks:queries.map((query,i)=>({id:'research_'+(i+1),type:'search',provider:'generic',query,status:'pending',dependsOn:[]})),stopping:{criterion:'evidence_sufficiency',minIndependentSources:2}}}
const tasks=[
 {id:'search_wuzzuf',type:'search',provider:'wuzzuf',query:g+(loc?' '+loc:''),status:'pending',dependsOn:[]},
 {id:'search_forasna',type:'search',provider:'forasna',query:g+(loc?' '+loc:''),status:'pending',dependsOn:[]},
 {id:'search_linkedin',type:'manual_research',provider:'linkedin',query:g+(loc?' '+loc:''),status:'pending',dependsOn:[]},
 {id:'search_official',type:'manual_research',provider:'official_company',query:g+(loc?' '+loc:''),status:'pending',dependsOn:[]},
 {id:'verify_cross_source',type:'verification',provider:'core',query:g+(loc?' '+loc:''),status:'pending',dependsOn:['search_wuzzuf','search_forasna']}];
return {version:'1.2',domain,intent:{goal:g,location:loc},tasks,stopping:{criterion:'evidence_sufficiency',minIndependentSources:2}}}
module.exports={buildQueryPlan,normalizeGoal};