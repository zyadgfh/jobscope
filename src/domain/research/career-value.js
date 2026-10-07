const signals=[
 ['training',/training|تدريب|learning|تعلم|certification|شهادة/i],
 ['growth',/promotion|career growth|ترقية|تطور وظيفي/i],
 ['analytics',/analysis|analytics|تحليل|تقارير/i],
 ['erp',/erp|sap|oracle|odoo/i],
 ['ecommerce',/e-commerce|ecommerce|تجارة إلكترونية/i],
 ['leadership',/lead|supervis|management|قيادة|إشراف|إدارة/i],
 ['technology',/automation|database|sql|python|api|system|تقنية|نظام/i]
];
function careerProfile(job){const text=[job.title,job.description,(job.requirements||[]).join(' ')].filter(Boolean).join(' ');const hits=[];for(const [key,re] of signals)if(re.test(text))hits.push(key);const score=Math.min(100,30+hits.length*10+(job.requirements?.length?10:0));return {score,inferredSignals:hits,status:'inferred',confidence:Number(Math.min(.9,.45+hits.length*.07).toFixed(2))}}
module.exports={careerProfile};