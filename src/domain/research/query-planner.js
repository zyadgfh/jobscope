function normalizeGoal(goal){return String(goal||'').trim().replace(/\s+/g,' ')}
function buildQueryPlan({goal,location='',domain='jobs'}){
 const g=normalizeGoal(goal), loc=normalizeGoal(location);
 if(!g) throw Object.assign(new Error('goal is required'),{code:'INVALID_GOAL'});
 const queries=[g,loc&&`${g} ${loc}`,`site:linkedin.com/jobs ${g} ${loc}`,`site:wuzzuf.net ${g} ${loc}`,`site:forasna.com ${g} ${loc}`].filter(Boolean);
 return {version:'1.0',domain,intent:{goal:g,location:loc},tasks:queries.map((query,i)=>({id:`search_${i+1}`,type:'search',query,status:'pending',dependsOn:[]})),stopping:{criterion:'evidence_sufficiency',minIndependentSources:2}};
}
module.exports={buildQueryPlan,normalizeGoal};
