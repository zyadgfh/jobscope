const STATUS=['verified_fact','reported','estimated','inferred','unknown','conflicting'];
function createEvidence({id,claim,sourceId,retrievedAt=new Date().toISOString(),status='unknown',confidence=0,provenance={}}){
 if(!claim)throw new Error('claim is required'); if(!STATUS.includes(status))throw new Error('invalid evidence status');
 if(confidence<0||confidence>1)throw new Error('confidence must be 0..1');
 return {id,claimId:id,claim,sourceId,retrievedAt,status,confidence,provenance};
}
function aggregateConfidence(items){if(!items.length)return 0;return items.reduce((s,x)=>s+x.confidence,0)/items.length}
module.exports={STATUS,createEvidence,aggregateConfidence};
