const {buildQueryPlan}=require('../domain/research/query-planner');
const {scoreEvidence}=require('../domain/research/scoring');
class ResearchOrchestrator{
 constructor(service){this.service=service}
 plan(id,{location='',domain='jobs'}={}){const run=this.service.get(id);if(!run) return null;run.plan=buildQueryPlan({goal:run.goal,location,domain});this.service.store.save(run);return run}
 score(id,evidence=[],sourceDiversity=0){const run=this.service.get(id);if(!run)return null;const result=scoreEvidence({evidence,sourceDiversity});run.scores.push(result);this.service.store.save(run);return result}
}
module.exports={ResearchOrchestrator};
