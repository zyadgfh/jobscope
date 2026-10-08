const {searchJobBoard}=require('./job-board-search');
const {normalizeJobCandidate}=require('../domain/research/normalizer');
const {canonicalKey}=require('../domain/research/entity-resolution');

const SOURCES={
  wuzzuf:{provider:'wuzzuf',domain:'wuzzuf.net'},
  forasna:{provider:'forasna',domain:'forasna.com'}
};

async function runProvider(query,{location='',provider,domain}) {
  let result;
  try {
    result=await searchJobBoard(query,{location,provider,domain});
  } catch(error) {
    // A failed provider is a failed task, never a fabricated source row.
    const failure=new Error(provider+' search failed: '+String(error.message||error));
    failure.code=error.code||'PROVIDER_FAILED';
    failure.provider=provider;
    throw failure;
  }
  return {
    documents:result.documents,
    sources:result.sources,
    jobs:result.jobs.map(raw=>{
      const job=normalizeJobCandidate(raw);
      return {...job,canonicalKey:canonicalKey(job),rawData:raw.rawData,retrievedAt:raw.retrievedAt,url:job.url};
    }),
    evidence:result.evidence
  };
}

async function searchJobs(query,{location='',sourceIds=['wuzzuf','forasna']}={}) {
  const wanted=[...new Set(sourceIds)].map(id=>SOURCES[id]).filter(Boolean);
  const results=await Promise.all(wanted.map(provider=>runProvider(query,{location,...provider})));
  return results.reduce((acc,item)=>({
    documents:acc.documents.concat(item.documents),
    sources:acc.sources.concat(item.sources),
    jobs:acc.jobs.concat(item.jobs),
    evidence:acc.evidence.concat(item.evidence)
  }),{documents:[],sources:[],jobs:[],evidence:[]});
}

module.exports={searchJobs};
