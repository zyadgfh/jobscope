const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const exec=fs.readFileSync(path.join(__dirname,'..','api','research','runs','execute','[id].js'),'utf8');
const app=fs.readFileSync(path.join(__dirname,'..','app.js'),'utf8');
test('batch executor is checkpointed and does not contain one-shot polling timer logic',()=>{assert.match(exec,/continue:true/);assert.match(exec,/task_status|taskKey/);assert.doesNotMatch(exec,/setInterval\(/)});
test('frontend stores run identity and pumps discrete batches',()=>{assert.match(app,/localStorage\.setItem\(RUN_STORAGE_KEY/);assert.match(app,/executeBatch\(/);assert.match(app,/resumeStoredRun\(\)/)});
