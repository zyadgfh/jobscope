function clamp(n){return Math.max(0,Math.min(100,n))}
function scoreEvidence({evidence=[],sourceDiversity=0}={}){
 const verified=evidence.filter(e=>e.status==='verified_fact').length;
 const conflicting=evidence.filter(e=>e.status==='conflicting').length;
 const coverage=Math.min(1,evidence.length/10);
 const verification=Math.min(1,verified/5);
 const diversity=Math.min(1,sourceDiversity/3);
 const contradictionPenalty=Math.min(.35,conflicting*.08);
 const score=clamp((coverage*.35+verification*.4+diversity*.25-contradictionPenalty)*100);
 return {score:Number(score.toFixed(2)),components:{coverage,verification,diversity,contradictionPenalty},explanation:'Evidence quality only; not a job-fit score.'};
}
module.exports={scoreEvidence};
