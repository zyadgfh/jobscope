const { InMemoryResearchRunStore } = require('./research-store');
const { ResearchService } = require('../application/research-service');

const globalKey = '__jobscope_research_service__';
if (!globalThis[globalKey]) {
  globalThis[globalKey] = new ResearchService(new InMemoryResearchRunStore());
}
module.exports = globalThis[globalKey];
