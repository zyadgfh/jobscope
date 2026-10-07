# JobScope Deep Research

واجهة بحث ثنائية اللغة للبحث الوظيفي العميق والبحث العام متعدد المصادر.

## الحالة الحالية

JobScope ينتقل تدريجيًا من نموذج UX أولي إلى منصة **Research Intelligence Core** قابلة للتوسع. الفرع `foundation/v0.2` يحتوي الآن على أول نواة تنفيذية لـ Research Run بدل الاعتماد على نتائج وهمية فقط.

### ما تم تفعيله

- Research Run داخل طبقة domain مع دورة حالات قابلة للتحقق.
- Goal Snapshot وTimeline وCheckpoints لكل تشغيل بحث.
- API أولي لإنشاء واسترجاع وإيقاف مؤقت واستئناف وإلغاء Research Run.
- In-memory repository كبداية صفرية التكلفة، مع قابلية الاستبدال لاحقًا بـ PostgreSQL.
- Security headers أساسية وpayload limit لطلبات JSON.
- اختبارات Node.js مبدئية للـ domain lifecycle.
- الحفاظ على الواجهة الحالية أثناء استبدال الـ mock pipeline تدريجيًا.

## التشغيل

```bash
npm start
```

ثم افتح `http://localhost:3000`.

## الاختبارات

```bash
npm test
```

## API

- `GET /health`
- `POST /api/research/runs` — body: `{"goal":"...","mode":"balanced"}`
- `GET /api/research/runs/:id`
- `POST /api/research/runs/:id/pause`
- `POST /api/research/runs/:id/resume`
- `POST /api/research/runs/:id/cancel`
- `GET /api/research/runs/:id/events` — SSE live timeline

## مبادئ التنفيذ

النسخة الحالية لا تدّعي أنها Deep Research حقيقي بعد: طبقات search/source adapters/extraction/evidence/verification/scoring ستُستبدل تدريجيًا بالـ implementations الحقيقية.

المصادر المحمية أو التي تتطلب تسجيل دخول لا يتم تجاوزها؛ تُستخدم APIs الرسمية أو الطرق المسموح بها، مع fallback/human-in-loop عند الحاجة.

طبقة Supabase وFirebase يمكن إضافتها بعد إنشاء الموارد وربط الأسرار في الخادم، دون تخزين بيانات شخصية في الواجهة.


### Research Intelligence layers now implemented

- deterministic research planning and evidence-sufficiency stopping
- evidence states and evidence-quality scoring
- governed source registry and SSRF-safe public source retrieval
- text normalization and job candidate canonicalization
- job entity-resolution primitives for multi-source postings
- evidence-gated recommendation and report generation

The system still refuses to invent market facts when source evidence is unavailable.
