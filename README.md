# JobScope Deep Research

واجهة بحث ثنائية اللغة للبحث الوظيفي العميق والبحث العام متعدد المصادر، مبنية حول Research Intelligence Core.

## الحالة الحالية — v0.9

JobScope نواة تنفيذية **تعمل فعليًا من طرف إلى طرف**: واجهة → API → Research Run قابل للتنفيذ والاستئناف عبر دفعات checkpointed → تقرير قرار.

تشمل الحالة:
- تخطيط بحث deterministic (عائلات استعلامات + معيار توقف) و توسعة **محدودة ومُنهية** بحد أقصى للجولات والمهام، مع تسجيل سبب التوقف (`stopping.reason`).
- بحث متعدد المصادر (Wuzzuf وForasna آليًا، LinkedIn والصفحات الرسمية كفتح يدوي)، مع DuckDuckGo HTML كمحرك كشف مُسجَّل.
- استخراج JSON-LD وتطبيع، entity resolution محافظ، Evidence Graph بحالات صريحة، وتحقق cross-source.
- قرار: Objective Score (غير شخصي) + Personal Fit عند إدخال التفضيلات، مع مكوّنات قرار مرئية.
- تقرير قابل للتصدير (JSON من `/api/research/runs/:id/export` وطباعة/PDF من الواجهة).
- تخزين durable عبر Supabase control plane في الإنتاج، أو control plane مدمج في الذاكرة للتطوير المحلي.

## التشغيل محليًا

    npm install
    npm start          # http://localhost:3000
    npm test           # مجموعة اختبارات كاملة (وحدة + تكامل عبر control plane مدمج)
    npm run check      # فحص نحوي لكل ملفات api/ وsrc/ وtest/

لا يحتاج التشغيل المحلي إلى أي مفاتيح: `server.js` يستخدم control plane مدمجًا (`RESEARCH_CONTROL_URL=local`) ويحفظ حالته في ملف JSON مؤقت. للإنتاج، عيّن `RESEARCH_CONTROL_URL` إلى دالة Supabase Edge (انظر `.env.example`).

## النشر على Vercel

المشروع **جاهز للنشر**: بلا تبعيات npm وبلا خطوة build، وإعدادات المنصة مضبوطة في `vercel.json` (رؤوس أمان + CSP، `no-store` لمسارات `/api`، حد 60 ثانية و1024 MB لدوال `api/**`، وإعادة توجيه `/health`).

    npm i -g vercel
    vercel login
    vercel link          # اربط المجلد بمشروع Vercel (Framework: Other، Build Command: فارغ)
    vercel --prod

قبل النشر (مرة واحدة، على Supabase):

    npx supabase db push                                   # يطبّق الترحيلين، ومنهما run-scoped retrieval
    npx supabase functions deploy research-control --no-verify-jwt

وبعد النشر:

    RESEARCH_CONTROL_URL=https://YOUR_PROJECT.supabase.co/functions/v1/research-control npm run deploy:check
    BASE=https://YOUR_PROJECT.vercel.app npm run verify:deploy     # فحص شامل للموقع والـ API

متغيرات البيئة المطلوبة ومصفوفتها كاملة، وخطوات الاستيراد من GitHub، والتحقق بعد النشر، واستكشاف الأخطاء، والتراجع: `docs/DEPLOYMENT.md`.
نشر آلي جاهز في `.github/workflows/deploy-vercel.yml` (يُفعَّل بإضافة أسرار `VERCEL_TOKEN` و`VERCEL_ORG_ID` و`VERCEL_PROJECT_ID`).

## API

- `GET  /api/health` و `GET /health`
- `POST /api/research/runs` → `{ run, accessToken }`
- `GET  /api/research/runs/:id` (يتطلب `Authorization: Bearer <accessToken>`)
- `POST /api/research/runs/:id?action=pause|resume|cancel|fork|replay|retry|compare`
- `POST /api/research/runs/execute/:id` (دفعة تنفيذ واحدة؛ تُستدعى في حلقة من الواجهة)
- `POST /api/research/runs/:id/evidence` (أدلة يدوية فقط، بلا تصعيد إلى verified_fact)
- `GET  /api/research/runs/:id/export` (تصدير JSON)
- `POST /api/research/sources/fetch` (يتطلب توكن الجلسة؛ جلب عام مُقيَّد بفهرس المصادر)

## الأمان

- لا يتم تجاوز CAPTCHA أو تسجيل الدخول أو حماية المواقع؛ المصادر المحمية تظهر كروابط فتح يدوي.
- لا أسرار ولا service-role في أصول المتصفح؛ جداول Supabase محمية بـ RLS وبلا صلاحيات anon.
- رموز الوصول **opaque** (32 بايت عشوائي) تُخزَّن كـ SHA-256 فقط، تنتهي بعد 7 أيام ويمكن إبطالها بـ `revoke`.
- الجلب العام للمصادر: منع الشبكات الخاصة (بما فيها `0.0.0.0/8` و`::ffff:` المُغلَّف)، منع أسماء حرفية رقمية، منع بيانات الاعتماد داخل URL، إعادة حل DNS مع تثبيت العنوان المتحقَّق منه، رفض الـ redirects، وحدود النوع والحجم والمهلة.
- قراءات `snapshot` **محصورة بالـ run**: كل مستند ومصدر مرتبط بالجلسة صاحبة التوكن فقط.

## العقود

عقود JSON Schema قابلة للتنفيذ في `src/core/contracts/` (run، evidence، job-opportunity، report) مع مُحقِّق بلا تبعيات، ويتم التحقق منها في الاختبارات على مخرجات حقيقية.

## الحدود المعروفة

- `LinkedIn` يُعامل كـ manual_research (فتح يدوي) ولا يُجلب آليًا.
- الاعتماد على DuckDuckGo HTML للكشف هشّ بطبيعته ومُعزول في `src/application/duckduckgo-search.js` ليُستبدَل بمزوّد آخر.
- على Vercel (دوال بلا حالة، بحد 60 ثانية للطلب) كل تنفيذ يمر بدفعة واحدة مقيّدة بميزانية بحث (`DEFAULT_SEARCH_BUDGET_MS` = 18 ثانية، بحد أقصى 30) ثم يعيد تسليم الحالة؛ لهذا تُستدعى `POST /api/research/runs/execute/:id` في حلقة من الواجهة.
- أي إصدار إنتاجي يحتاج تعيين متغيرات البيئة على منصة النشر (انظر `.env.example` و`docs/DEPLOYMENT.md`).
