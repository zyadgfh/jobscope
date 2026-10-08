const STATES = Object.freeze(['created','planning','searching','extracting','verifying','scoring','reporting','completed','paused','cancelled','failed']);
// The allowed edges are mirrored verbatim by the Supabase Edge Function and the
// local control plane, so a run cannot drift between environments.
const TRANSITIONS = Object.freeze({
 created:['planning','cancelled'],
 planning:['searching','paused','cancelled','failed'],
 searching:['extracting','paused','cancelled','failed'],
 extracting:['verifying','paused','cancelled','failed'],
 verifying:['scoring','paused','cancelled','failed'],
 scoring:['reporting','paused','cancelled','failed'],
 reporting:['completed','paused','cancelled','failed'],
 paused:['planning','searching','extracting','verifying','scoring','reporting','cancelled','failed'],
 completed:[],
 cancelled:[],
 failed:['planning','cancelled']
});
function canTransition(from,to){if(from===to)return true;return (TRANSITIONS[from]||[]).includes(to)}
function createResearchRun({id,goal,mode='balanced',actorId='guest'}){if(!goal||typeof goal!=='string'||!goal.trim())throw new Error('goal is required');const now=new Date().toISOString();return {id,type:'research_run',version:1,goal:goal.trim(),goalSnapshot:goal.trim(),mode,actorId,state:'created',createdAt:now,updatedAt:now,tasks:[],queries:[],sources:[],evidence:[],scores:[],recommendation:null,report:null,timeline:[{state:'created',at:now}],checkpoints:[]}}
module.exports={STATES,TRANSITIONS,canTransition,createResearchRun};