const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\"/g,'&quot;').replace(/'/g,'&#39;');

let lang='ar',timer;
const RUN_STORAGE_KEY='jobscope:lastRun';
const MAX_BATCHES=240;
const BATCH_DELAY_MS=650;
const BATCH_TIMEOUT_MS=25000;

const SOURCE_MAP=[
 {icon:'W',key:'wuzzuf',title:'Wuzzuf',ar:'مزوّد آلي',en:'Automated provider'},
 {icon:'F',key:'forasna',title:'Forasna',ar:'مزوّد آلي',en:'Automated provider'},
 {icon:'in',key:'linkedin',title:'LinkedIn',ar:'فتح يدوي عند الحاجة',en:'Manual open when needed'},
 {icon:'⌂',key:'official',title:'Official sites',ar:'تحقق يدوي/مزوّد رسمي',en:'Manual or official verification'}
];

const i18n={ar:{
 brandSub:'محرك بحث قابل للتدقيق',localMode:'وضع محلي آمن',eyebrow:'RESEARCH COMMAND CENTER',
 headline:'لا تبحث عن وظيفة فقط.<br><em>افهم قيمتها بالكامل.</em>',
 intro:'حوّل أي مسمى وظيفي أو موضوع إلى خريطة بحث متعددة المصادر، مع فصل المؤكد عن التقديري وتقرير واضح قابل للتصدير.',
 start:'ابدأ البحث',mode:'نوع البحث',jobsMode:'بحث وظيفي عميق',generalMode:'بحث عام متعدد المصادر',
 location:'النطاق الجغرافي',depth:'العمق',autoDepth:'تلقائي: سريع ثم توسعة',deepDepth:'شامل جدًا',
 trust1:'لا مفاتيح API في الواجهة',trust2:'تخطي آمن عند الحظر',trust3:'تصدير PDF',
 queryPlaceholder:'اكتب المسمى أو الموضوع...',areasPlaceholder:'Alexandria, Cairo',keywordsPlaceholder:'Excel, SQL',
 prefsHint:'التفضيلات اختيارية وتُحفظ مع جلسة البحث حتى انتهاء صلاحيتها.',
 liveResearch:'LIVE RESEARCH',researching:'جاري تفكيك',sourceMap:'خريطة المصادر',signals:'الإشارات الأولية',live:'مباشر',
 notice:'المصادر المحمية أو التي تتطلب دخولًا ستظهر كرابط فتح يدوي، ولن يحاول النظام تجاوز الحماية.',
 manualOpen:'فتح يدوي',noManualLinks:'لا حاجة إلى فتح يدوي في هذه الجولة.',
 reportEyebrow:'RESEARCH DOSSIER',reportTitle:'تقرير القرار',export:'تصدير PDF',copy:'نسخ الملخص',
 evidenceQuality:'جودة الأدلة',strong:'جاهز',verified:'أدلة تم تقييمها',objectiveOnly:'تحليل موضوعي فقط',
 researchOnly:'بحث موثق',insufficient:'الأدلة غير كافية',opportunities:'فرص مرشحة',confidence:'ثقة البيانات',
 recommendations:'التوصيات الأساسية',priority:'أولوية التقديم',nextSteps:'الخطوة التالية',queryFamilies:'عائلات البحث المستخدمة',
 minSalary:'الحد الأدنى للراتب',workModePref:'نمط العمل',anyMode:'أي نمط',onsiteMode:'من المقر',hybridMode:'هجين',remoteMode:'عن بُعد',
 targetAreas:'المناطق المفضلة',requiredKeywords:'مهارات مطلوبة',
 footer:'التفضيلات الاختيارية تُحفظ مع جلسة البحث حتى انتهاء صلاحيتها',footerRight:'مصمم للبحث المسؤول القابل للتحقق',
 phase:{created:'تهيئة',planning:'تخطيط',searching:'بحث',expanding:'توسعة',extracting:'استخراج',verifying:'تحقق',scoring:'تقييم',reporting:'إعداد التقرير',completed:'مكتمل',failed:'فشل',cancelled:'ملغى',paused:'متوقف'},
 task:{pending:'queued',running:'running',completed:'done',failed:'failed',blocked_manual:'manual'},
 gap:{no_opportunities:'لا توجد فرص مستخرجة',salary_coverage:'تغطية الرواتب ضعيفة',source_diversity:'تنوع المصادر أقل من المطلوب',evidence:'لا توجد أدلة مستخرجة',source_failure:'تعذّر الوصول إلى أحد المصادر'},
 stopping:{no_gaps:'لا فجوات متبقية',expansion_task_budget_exhausted:'استُنفد حد مهام التوسعة',expansion_rounds_exhausted:'استُنفدت جولات التوسعة',gaps_unchanged:'الفجوات لم تتغير بعد التوسعة',no_queries:'لا استعلامات توسعة مناسبة',ready:'جاهز'},
 decisionTag:'قرار',noVerified:'لا توجد فرصة موثقة في هذه الجولة بعد.',unknownCompany:'شركة غير معروفة',unknownLocation:'موقع غير معروف'
},en:{
 brandSub:'Auditable research engine',localMode:'Safe local mode',eyebrow:'RESEARCH COMMAND CENTER',
 headline:'Do not just find a role.<br><em>Understand its value.</em>',
 intro:'Turn any job title or topic into a multi-source research map, separating verified facts from estimates in an exportable report.',
 start:'Start research',mode:'Research mode',jobsMode:'Deep job research',generalMode:'General multi-source',
 location:'Geographic scope',depth:'Depth',autoDepth:'Auto: quick then expand',deepDepth:'Maximum depth',
 trust1:'No API keys in the UI',trust2:'Safe skip on blocked sources',trust3:'PDF export',
 queryPlaceholder:'Enter a title or topic...',areasPlaceholder:'Alexandria, Cairo',keywordsPlaceholder:'Excel, SQL',
 prefsHint:'Optional preferences are stored with the research session until expiry.',
 liveResearch:'LIVE RESEARCH',researching:'Dissecting',sourceMap:'Source map',signals:'Early signals',live:'LIVE',
 notice:'Protected or login-gated sources are offered as manual-open links; the system never attempts to bypass protection.',
 manualOpen:'Open manually',noManualLinks:'No manual open is required in this round.',
 reportEyebrow:'RESEARCH DOSSIER',reportTitle:'Decision report',export:'Export PDF',copy:'Copy summary',
 evidenceQuality:'Evidence quality',strong:'READY',verified:'Evidence assessed',objectiveOnly:'Objective-only analysis',
 researchOnly:'Documented research',insufficient:'Insufficient evidence',opportunities:'Candidate roles',confidence:'Data confidence',
 recommendations:'Core recommendations',priority:'Application priority',nextSteps:'Next steps',queryFamilies:'Query families used',
 minSalary:'Minimum salary',workModePref:'Work mode',anyMode:'Any mode',onsiteMode:'On-site',hybridMode:'Hybrid',remoteMode:'Remote',
 targetAreas:'Preferred areas',requiredKeywords:'Required skills',
 footer:'Optional preferences are stored with the research session until expiry',footerRight:'Built for responsible, auditable research',
 phase:{created:'created',planning:'planning',searching:'searching',expanding:'expanding',extracting:'extracting',verifying:'verifying',scoring:'scoring',reporting:'reporting',completed:'completed',failed:'failed',cancelled:'cancelled',paused:'paused'},
 task:{pending:'queued',running:'running',completed:'done',failed:'failed',blocked_manual:'manual'},
 gap:{no_opportunities:'No opportunities extracted',salary_coverage:'Weak salary coverage',source_diversity:'Not enough source diversity',evidence:'No extracted evidence',source_failure:'A provider could not be reached'},
 stopping:{no_gaps:'No remaining gaps',expansion_task_budget_exhausted:'Expansion task budget reached',expansion_rounds_exhausted:'Expansion rounds exhausted',gaps_unchanged:'Gaps unchanged after expansion',no_queries:'No usable expansion queries',ready:'ready'},
 decisionTag:'Decision',noVerified:'No verified opportunity was produced in this run.',unknownCompany:'Unknown company',unknownLocation:'Location unknown'
}};

function t(key){return (i18n[lang]&&i18n[lang][key])||i18n.ar[key]||key}
function tsub(group,key){const g=i18n[lang]&&i18n[lang][group];return (g&&g[key])||key}

function stateLabel(state){return tsub('phase',state)||state||''}
function taskLabel(status){return tsub('task',status)||status||''}

function applyLang(){
 document.documentElement.lang=lang;document.documentElement.dir=lang==='ar'?'rtl':'ltr';
 document.querySelectorAll('[data-i18n]').forEach(e=>{const value=i18n[lang][e.dataset.i18n];if(typeof value==='string')e.innerHTML=value});
 document.querySelectorAll('[data-placeholder]').forEach(e=>{const value=i18n[lang][e.dataset.placeholder];if(typeof value==='string')e.placeholder=value});
 $('#langBtn').textContent=lang==='ar'?'EN':'AR';
}

/* ---------- run state ---------- */
function persistRun(id,token){try{localStorage.setItem(RUN_STORAGE_KEY,JSON.stringify({id,token,savedAt:Date.now()}))}catch{}}
function loadRun(){
 try{
  const saved=JSON.parse(localStorage.getItem(RUN_STORAGE_KEY)||'null');
  if(!saved||!saved.id||!saved.token)return null;
  if(Date.now()-Number(saved.savedAt||0)>7*86400000){localStorage.removeItem(RUN_STORAGE_KEY);return null}
  return saved;
 }catch{return null}
}
function clearStoredRun(){try{localStorage.removeItem(RUN_STORAGE_KEY)}catch{}}

async function readJson(response){
 let data={};try{data=await response.json()}catch{}
 if(!response.ok)throw Object.assign(new Error(data.message||data.error||'Request failed'),{code:data.error||'REQUEST_FAILED',status:response.status});
 return data;
}
async function fetchRun(id,token){
 const response=await fetch('/api/research/runs/'+encodeURIComponent(id),{headers:{authorization:'Bearer '+token}});
 return (await readJson(response)).run;
}
async function executeBatch(id,token){
 const controller=new AbortController();
 const timerId=setTimeout(()=>controller.abort(),BATCH_TIMEOUT_MS);
 try{
  const response=await fetch('/api/research/runs/execute/'+encodeURIComponent(id),{method:'POST',headers:{authorization:'Bearer '+token},signal:controller.signal});
  return await readJson(response);
 }finally{clearTimeout(timerId)}
}

/* ---------- rendering ---------- */
function sourceState(run,key){
 const tasks=(run&&run.tasks)||[];
 const relevant=tasks.filter(task=>{
  const taskKey=String(task.task_key||'');
  if(key==='wuzzuf')return taskKey==='search_wuzzuf'||/_wuzzuf$/.test(taskKey);
  if(key==='forasna')return taskKey==='search_forasna'||/_forasna$/.test(taskKey);
  if(key==='linkedin')return taskKey==='search_linkedin';
  return taskKey==='search_official';
 });
 if(!relevant.length)return 'pending';
 if(relevant.some(task=>task.status==='running'))return 'running';
 if(relevant.some(task=>task.status==='failed'))return 'failed';
 if(relevant.some(task=>task.status==='blocked_manual'))return 'blocked_manual';
 if(relevant.some(task=>task.status==='pending'))return 'pending';
 return 'completed';
}
function renderSources(run){
 const used=SOURCE_MAP.filter(source=>sourceState(run,source.key)==='completed').length;
 $('#sourceList').innerHTML=SOURCE_MAP.map(source=>{
  const state=sourceState(run,source.key);
  const stateClass=state==='completed'||state==='blocked_manual'?'source-state done':'source-state';
  return '<div class="source" id="src-'+esc(source.key)+'"><div class="source-icon">'+esc(source.icon)+'</div><div class="source-info"><b>'+esc(source.title)+'</b><small>'+esc(lang==='ar'?source.ar:source.en)+'</small></div><span class="'+stateClass+'">'+esc(taskLabel(state))+'</span></div>';
 }).join('');
 $('#sourceCount').textContent=String(used);
}
function renderSignals(run){
 const summary=(run&&run.evidenceSummary)||{};
 const rows=[];
 rows.push({label:lang==='ar'?'أدلة مجمّعة':'Collected evidence',value:String(summary.total||0)});
 rows.push({label:lang==='ar'?'مصادر مستقلة':'Independent sources',value:String(summary.sourceCount||0)});
 const blocked=((run&&run.tasks)||[]).filter(task=>task.status==='blocked_manual');
 rows.push({label:lang==='ar'?'بنود تحتاج فتحًا يدويًا':'Items needing manual open',value:String(blocked.length)});
 $('#signalList').innerHTML=rows.map(row=>'<div class="signal"><b>'+esc(row.label)+'</b><span>'+esc(row.value)+'</span></div>').join('');
}
function renderManualLinks(run){
 const tasks=(run&&run.tasks)||[];
 const goal=encodeURIComponent((run&&run.goal)||'');
 const location=(run&&run.plan&&run.plan.intent&&run.plan.intent.location)||'';
 const links=[];
 if(tasks.some(task=>task.task_key==='search_linkedin'&&task.status==='blocked_manual')){
  links.push({label:'LinkedIn · '+t('manualOpen'),href:'https://www.linkedin.com/jobs/search/?keywords='+goal+(location?'&location='+encodeURIComponent(location):'')});
 }
 if(tasks.some(task=>task.task_key==='search_official'&&task.status==='blocked_manual')){
  links.push({label:'DuckDuckGo · '+t('manualOpen'),href:'https://duckduckgo.com/?q='+goal+'+careers'+(location?'+'+encodeURIComponent(location):'')});
 }
 $('#manualLinks').innerHTML=links.length
  ?links.map(link=>'<a href="'+esc(link.href)+'" target="_blank" rel="noopener noreferrer">'+esc(link.label)+'</a>').join('')
  :'<span class="prefs-hint">'+esc(t('noManualLinks'))+'</span>';
}
function progressFor(run){
 const order=['created','planning','searching','expanding','extracting','verifying','scoring','reporting','completed'];
 const state=(run&&run.state)||'created';
 if(['failed','cancelled'].includes(state))return '100%';
 const index=order.indexOf(state);
 if(index<0)return '8%';
 return Math.max(8,Math.round(((index+1)/order.length)*100))+'%';
}
function renderRun(run){
 if(!run)return;
 $('#workspace').classList.remove('hidden');
 $('#queryLabel').textContent=run.goal||'';
 $('#phase').textContent=stateLabel(run.state);
 $('#progressBar').style.width=progressFor(run);
 renderSources(run);
 renderSignals(run);
 renderManualLinks(run);
}

/* ---------- execution ---------- */
async function pumpRun(id,token,query,location){
 clearInterval(timer);
 for(let batch=0;batch<MAX_BATCHES;batch++){
  const data=await executeBatch(id,token);
  persistRun(id,token);
  renderRun(data.run);
  const state=data.run&&data.run.state;
  if(['completed','failed','cancelled'].includes(state)){
   if(state==='completed')clearStoredRun();
   renderReport(query,location,data.run);
   return data;
  }
  await new Promise(resolve=>setTimeout(resolve,BATCH_DELAY_MS));
 }
 throw Object.assign(new Error(lang==='ar'?'تجاوز التنفيذ الحد الأقصى للدفعات':'Execution exceeded the maximum number of batches'),{code:'BATCH_LIMIT'});
}
function collectPreferences(){
 const areas=$('#targetAreas'),keywords=$('#requiredKeywords'),salary=$('#minSalary'),workMode=$('#workModePref');
 const split=value=>String(value||'').split(',').map(part=>part.trim()).filter(Boolean);
 const minSalary=Number(salary&&salary.value);
 return {
  minSalary:Number.isFinite(minSalary)&&minSalary>0?minSalary:null,
  workMode:(workMode&&workMode.value)||'any',
  targetLocations:split(areas&&areas.value),
  requiredKeywords:split(keywords&&keywords.value)
 };
}
async function start(){
 clearInterval(timer);
 const query=$('#query').value.trim()||'Data Entry';
 const location=$('#location').value.trim();
 const domain=$('#mode').value==='jobs'?'jobs':'general';
 const depth=$('#depth').value;
 $('#workspace').classList.remove('hidden');
 $('#report').classList.add('hidden');
 $('#queryLabel').textContent=query;
 $('#progressBar').style.width='3%';
 $('#phase').textContent=stateLabel('created');
 renderSources({tasks:[]});
 renderSignals({});
 $('#manualLinks').innerHTML='';
 try{
  const response=await fetch('/api/research/runs',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({goal:query,location,domain,depth,preferences:collectPreferences()})});
  const result=await readJson(response);
  const token=result.accessToken,id=result.run&&result.run.id;
  if(!token||!id)throw Object.assign(new Error('Research Run did not return an access token'),{code:'MISSING_TOKEN'});
  persistRun(id,token);
  renderRun(result.run);
  await pumpRun(id,token,query,location);
 }catch(error){
  if(['UNAUTHORIZED','NOT_FOUND','INVALID_ACCESS_TOKEN'].includes(error.code))clearStoredRun();
  $('#phase').textContent=stateLabel('failed');
  $('#signalList').insertAdjacentHTML('beforeend','<div class="signal"><b>'+esc(error.message)+'</b><span>failed</span></div>');
 }
}
async function resumeStoredRun(){
 const saved=loadRun();
 if(!saved)return;
 try{
  const run=await fetchRun(saved.id,saved.token);
  $('#workspace').classList.remove('hidden');
  renderRun(run);
  if(['completed','failed','cancelled'].includes(run.state)){
   if(run.state==='completed')clearStoredRun();
   renderReport(run.goal,(run.plan&&run.plan.intent&&run.plan.intent.location)||'',run);
   return;
  }
  await pumpRun(saved.id,saved.token,run.goal,(run.plan&&run.plan.intent&&run.plan.intent.location)||'');
 }catch(error){
  if(['UNAUTHORIZED','NOT_FOUND','TOKEN_EXPIRED'].includes(error.code))clearStoredRun();
 }
}

/* ---------- report ---------- */
function renderReport(query,location,run){
 $('#report').classList.remove('hidden');
 const report=(run&&run.report)||{};
 const score=report.evidenceScore&&typeof report.evidenceScore.score==='number'?report.evidenceScore.score:null;
 const summary=(run&&run.evidenceSummary)||{};
 const opportunities=Array.isArray(run&&run.opportunities)?run.opportunities:[];
 const reportOpportunities=Array.isArray(report.opportunities)?report.opportunities.length:0;
 const stopping=report.stopping&&report.stopping.reason?report.stopping.reason:null;

 $('#reportMeta').textContent='Research Run: '+(run.id||'')+' · '+(location||'')+' · '+stateLabel(run.state)+(stopping?' · '+tsub('stopping',stopping):'');
 $('#score').textContent=score===null?'—':score;
 $('#verified').textContent=String((report.executive&&report.executive.evidenceCount)??summary.total??0);
 $('#opportunities').textContent=String(reportOpportunities||opportunities.length||0);
 $('#confidence').textContent=score===null?'—':score+'%';

 const recommendation=(run&&run.recommendation)||{status:'insufficient_evidence',decision:'unknown'};
 const pill=$('#verdictPill');
 pill.textContent=String(recommendation.status||'PENDING').toUpperCase();
 pill.className='pill '+(recommendation.status==='ready'?'green':recommendation.status==='insufficient_evidence'?'orange':'blue');
 $('#verdictTitle').textContent=recommendation.decision==='recommended'?t('strong')
  :recommendation.decision==='consider'?(lang==='ar'?'تستحق الدراسة':'Consider')
  :recommendation.decision==='objective_only'?t('objectiveOnly')
  :recommendation.decision==='research_only'?t('researchOnly')
  :t('insufficient');
 $('#verdictText').textContent=lang==='ar'
  ?'الدرجة المعروضة هي جودة الأدلة فقط. لا توجد درجة ملاءمة شخصية حتى تُبنى تفضيلات المستخدم والبيانات اللازمة.'
  :'The displayed score is evidence quality only. Personal fit is not scored until user preferences and required data are available.';

 if((report.gaps||[]).length){
  $('#signalList').insertAdjacentHTML('beforeend','<div class="signal"><b>'+esc(lang==='ar'?'فجوات مفتوحة':'Open gaps')+'</b><span>'+esc(String(report.gaps.length))+'</span></div>');
 }

 if((run.plan&&run.plan.domain)==='jobs'){
  $('#jobs').innerHTML=opportunities.length
   ?opportunities.slice(0,12).map(function(job,index){
     const decision=Number(job.decision_score??job.decisionScore);
     const tag=Number.isFinite(decision)?t('decisionTag')+' '+decision+'/100':(job.salary?'salary':'evidence');
     return '<div class="job"><span class="job-rank">'+String(index+1).padStart(2,'0')+'</span><div><h4>'+esc(job.title||'Untitled opportunity')+'</h4><p>'+esc(job.company||t('unknownCompany'))+' · '+esc(job.location||t('unknownLocation'))+'</p></div><span class="tag">'+esc(tag)+'</span></div>';
    }).join('')
   :'<div class="notice"><span>✦</span><p>'+esc(t('noVerified'))+'</p></div>';
 }else{
  const claims=Array.isArray(report.claims)?report.claims:[];
  $('#jobs').innerHTML=claims.length
   ?claims.slice(0,12).map(function(claim,index){
     return '<div class="job"><span class="job-rank">'+String(index+1).padStart(2,'0')+'</span><div><h4>'+esc(claim.claim)+'</h4><p>'+esc(claim.status)+' · '+esc((claim.provenance&&claim.provenance.url)||'source unavailable')+'</p></div><span class="tag">'+esc(Math.round((claim.confidence||0)*100)+'/100')+'</span></div>';
    }).join('')
   :'<div class="notice"><span>✦</span><p>'+esc(t('insufficient'))+'</p></div>';
 }

 const steps=(report.gaps||[]).map(gap=>tsub('gap',gap.type)||gap.type);
 if(!steps.length)steps.push(lang==='ar'?'لم تُرصد فجوات مفتوحة في هذه الجولة.':'No open gaps were detected in this round.');
 steps.push(lang==='ar'?'التحقق المتقاطع لا يعتمد إلا على مصادر مستقلة':'Cross-source verification only uses independent sources');
 steps.push(lang==='ar'?'الملاءمة الشخصية تُحسب فقط عند إدخال التفضيلات':'Personal fit is only scored when preferences are provided');
 $('#nextSteps').innerHTML=steps.map(step=>'<div><i>✓</i><span>'+esc(step)+'</span></div>').join('');

 const queryChips=((run.plan&&run.plan.tasks)||[]).map(task=>task.query);
 $('#queryChips').innerHTML=queryChips.map(item=>'<span class="chip">'+esc(item)+'</span>').join('');
 $('#progressBar').style.width='100%';
 $('#report').scrollIntoView({behavior:'smooth',block:'start'});
}

$('#searchBtn').onclick=start;
$('#langBtn').onclick=()=>{lang=lang==='ar'?'en':'ar';applyLang()};
$('#printBtn').onclick=()=>window.print();
$('#copyBtn').onclick=()=>{const text=$('#verdictTitle').textContent+' — '+$('#verdictText').textContent;if(navigator.clipboard)navigator.clipboard.writeText(text).catch(()=>{})};
applyLang();
resumeStoredRun();
