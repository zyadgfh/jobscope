# النشر على Vercel — دليل كامل (Deployment)

هذا الدليل هو المسار الرسمي لنقل JobScope من التشغيل المحلي إلى الإنتاج. المشروع **جاهز للنشر**: لا تبعيات npm، لا خطوة build، كل الاختبارات خضراء، وإعدادات Vercel مضبوطة في `vercel.json`.

```
المتصفح ──► Vercel (index.html + app.js + styles.css)
                │
                └─► /api/**  (Vercel Functions, Node 22, maxDuration 60s, 1024MB, fra1)
                        │
                        └─► Supabase Edge Function: research-control
                                   │
                                   └─► Postgres (RLS, بلا صلاحيات anon)
```

## 0) المتطلبات

- حساب [Vercel](https://vercel.com) مرتبط بمستودع `zyadgfh/jobscope`.
- مشروع Supabase (ref المشروع الحالي: `mtziqpyvgebthoynalbq`).
- أدوات محلية: `node -v` → 22.x (نفس نسخة التشغيل المُتحقَّق منها) و`npm`.

فحص محلي قبل النشر:

```bash
npm test            # 99 اختبارًا
npm run check       # فحص نحوي لكل ملفات api/ src/ test/ scripts/
```

---

## 1) لوحة التحكم (Supabase) — قبل الواجهة

### 1.1 تطبيق الترحيلات

طبّق الترحيلين بالترتيب (من `supabase/migrations/`):

```bash
npx supabase link --project-ref mtziqpyvgebthoynalbq
npx supabase db push
```

أو نفّذهما يدويًا من SQL Editor:

1. `20261007173000_runtime_hardening.sql`
2. `20261008120000_run_scoped_retrieval.sql` — **إلزامي**: يضيف `run_id` للمستندات ويقصر `snapshot` على الجلسة صاحبة التوكن. بدونه يعمل النشر لكن قراءة `snapshot` غير محصورة بالـ run.

### 1.2 نشر Edge Function

```bash
npx supabase functions deploy research-control --no-verify-jwt
```

- `--no-verify-jwt` مطلوب: الهوية تُثبَت بالتوكن **opaque** داخل الدالة (SHA-256)، لا بـ Supabase JWT. بدونه تحصل على `401` من البوابة قبل وصول الطلب.
- عيّن داخل الدالة `SUPABASE_URL` و`SUPABASE_SERVICE_ROLE_KEY` (Supabase يوفّرهما تلقائيًا للدوال في المشروع).

### 1.3 التحقق من لوحة التحكم

```bash
RESEARCH_CONTROL_URL=https://mtziqpyvgebthoynalbq.supabase.co/functions/v1/research-control \
  npm run deploy:check
```

يقوم السكربت بدورة حقيقية `create → get → snapshot → revoke` ويتحقق من أن النسخة المنشورة تحمل:
- عقد الـ run بالإصدار `1.3`،
- `snapshot` محصور بالـ run (run جديد = صفر مستندات).

الناتج المطلوب: `Control plane is ready for production use.` أي `WARN` يعني أن الدالة أو الترحيل متأخّر.

---

## 2) Vercel

### 2.1 الاستيراد من GitHub

1. Vercel → **Add New → Project** → استورد `zyadgfh/jobscope`.
2. **Root Directory:** `.` (جذر المستودع).
3. **Framework Preset:** `Other`.
4. **Build Command:** اتركه فارغًا (لا build؛ الملفات ثابتة و`api/**` دوال جاهزة).
5. **Output Directory:** اتركه فارغًا (Vercel يخدم الجذر و`api/` مباشرة).
6. **Install Command:** `npm install` (لا تبعيات — يمر فورًا).
7. **Node.js Version:** `22.x` (مثبّت في `package.json` → `engines`).

### 2.2 متغيرات البيئة

أضِفها في **Project → Settings → Environment Variables** لنطاق Production وPreview:

| المتغير | مطلوب | القيمة | الغرض |
| --- | --- | --- | --- |
| `RESEARCH_CONTROL_URL` | موصى به | `https://mtziqpyvgebthoynalbq.supabase.co/functions/v1/research-control` | عنوان لوحة التحكم. عند غيابه يستخدم الكود القيمة المدمجة لنفس المشروع، لذا التصريح به يجعل النشر صريحًا ويسهل تغيير المشروع. |
| `JOBSCOPE_LOCAL_STORE` | ❌ | — | مسار ملف للتشغيل المحلي فقط. لا تستخدمه على Vercel (نظام الملفات للقراءة فقط ولا يضمن استمرارية الحالة). |
| `SUPABASE_URL` | ❌ على Vercel | `https://mtziqpyvgebthoynalbq.supabase.co` | تُقرأ **داخل** Edge Function فقط؛ لا تضعها في مشروع Vercel. |
| `SUPABASE_SERVICE_ROLE_KEY` | ❌ على Vercel | — | **سرّي جدًا.** يبقى في Supabase فقط ولا يُضاف إلى Vercel ولا إلى أصول المتصفح. |
| `VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID` | اختياري | — | أسرار GitHub Actions للنشر الآلي (القسم 4). لا تُضاف إلى Vercel نفسه. |

### 2.3 النشر

```bash
npm i -g vercel
vercel login
vercel link          # اربط المجلد بمشروع Vercel
vercel --prod        # نشر إنتاجي
```

أو استخدم زر **Deploy** في لوحة Vercel بعد الاستيراد (كل push إلى `main` ينشر تلقائيًا).

---

## 3) التحقق بعد النشر

```bash
BASE=https://<your-project>.vercel.app

curl -s $BASE/health                      # {"ok":true,"app":"jobscope",...,"runtime":"vercel"}
curl -sD - -o /dev/null $BASE/ | grep -i "content-security-policy\|x-frame-options\|strict-transport"
curl -sD - -o /dev/null $BASE/api/health | grep -i "cache-control"     # no-store
curl -s -o /dev/null -w '%{http_code}\n' $BASE/api/research/runs/does-not-exist   # 401

# دورة حقيقية: إنشاء ثم قراءة ثم تنفيذ دفعة
TOKEN=$(curl -s -X POST $BASE/api/research/runs -H 'content-type: application/json' \
  -d '{"goal":"Data Entry","location":"Alexandria","domain":"jobs","depth":"auto"}' \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).accessToken))')
curl -s $BASE/api/research/runs/<run-id> -H "authorization: Bearer $TOKEN"
curl -s -X POST $BASE/api/research/runs/execute/<run-id> -H "authorization: Bearer $TOKEN"
```

`/health` يعيد `{"ok":true,"runtime":"vercel","controlPlane":"supabase-edge-function"}`؛ وجود `controlPlane: in-process-local` في الإنتاج يعني أن `RESEARCH_CONTROL_URL` غير مضبوط.

كل الطلبات التي تحمل جسمًا يجب أن تُرسَل بترويسة `Content-Type: application/json` (منصة Vercel لا تُحلّل الجسم بدونها، والواجهة تفعل ذلك دائمًا).

معرّف الـ run في المسار (`/runs/:id`) **تجميلي**: الهوية تُثبت بالتوكن وحده (`Authorization: Bearer`)، فلا يمكن قراءة run آخر بتخمين المعرّف.

ملاحظات المتوقع:
- `POST /api/research/sources/fetch` يجب أن يعيد `401` بدون توكن.
- أي هدف شبكة خاصة (`http://127.0.0.1/`) يجب أن يعيد `SSRF_BLOCKED`.
- عند تعذّر الوصول إلى الويب من بيئة التشغيل، تظهر المهام `failed` مع سببها ويُسجَّل `source_failure` كـ gap — لا تُلفَّق نتائج.

سكربت التحقق كاملًا: `npm run deploy:check` (يتطلب `RESEARCH_CONTROL_URL`).

---

## 4) النشر الآلي عبر GitHub Actions (اختياري)

الـ workflow جاهز في `.github/workflows/deploy-vercel.yml` ويُشغَّل عند push إلى `main` أو يدويًا. أضِف هذه الأسرار في **GitHub → Settings → Secrets and variables → Actions**:

| السر | من أين |
| --- | --- |
| `VERCEL_TOKEN` | Vercel → Account Settings → Tokens |
| `VERCEL_ORG_ID` | `.vercel/project.json` بعد `vercel link` |
| `VERCEL_PROJECT_ID` | `.vercel/project.json` بعد `vercel link` |
| `RESEARCH_CONTROL_URL` | اختياري — لتشغيل `deploy:check` بعد النشر |

بدون `VERCEL_TOKEN` يتخطى الـ workflow خطوة النشر (يظهر notice) بدل أن يفشل.

---

## 5) حدود التشغيل على Vercel (مضبوطة ومُختبرة)

| الحد | القيمة | أين |
| --- | --- | --- |
| مدة الدالة | 60 ثانية | `vercel.json` → `functions["api/**/*.js"].maxDuration` |
| الذاكرة | 1024 MB | نفس الموضع |
| المنطقة | `fra1` | `vercel.json` → `regions`. بدائل: `dub1` (دبي، الأقرب لمصر) أو منطقة مشروع Supabase نفسها — تحقق من دعم خطتك للمنطقة قبل الاعتماد عليها، وإن رفضتها المنصة فاحذف المفتاح (تعود إلى الافتراضية `iad1`) |
| ميزانية بحث الدفعة الواحدة | 18 ثانية افتراضيًا، بحد أقصى 30 | `src/core/time/index.js` (`DEFAULT_SEARCH_BUDGET_MS` / `MAX_SEARCH_BUDGET_MS`) |
| حجم طلب API | 4.5 MB (حد المنصة) | Vercel؛ محليًا يفرض `src/api/node-adapter.js` سقف 512 KB |
| حجم ingest للوحة التحكم | 3 MB للطلب و2.5 MB لحمولة `ingest` | `supabase/functions/research-control/index.ts` (`MAX_BODY`) |

كل دفعة تنفيذ واحدة تستهلك ميزانية البحث ثم تتوقف وتعيد تسليم الحالة، لذلك يبقى الطلب داخل الـ 60 ثانية. لا يوجد أي مسار ينتظر الشبكة بلا سقف زمني.

---

## 6) استكشاف الأخطاء

| العرض | السبب المرجّح | الحل |
| --- | --- | --- |
| `401 UNAUTHORIZED` على كل طلب | الدالة منشورة بـ JWT verification | `npx supabase functions deploy research-control --no-verify-jwt` |
| `UNAUTHORIZED` بعد `revoke` أو على توكن قديم | انتهت صلاحية التوكن (7 أيام) أو أُبطل | أنشئ run جديدًا |
| `NETWORK_UNREACHABLE` من `deploy:check` | عنوان خاطئ/دالة غير منشورة/حجب شبكي | تحقق من الرابط ثم `curl -s $URL -X POST -d '{}'` |
| `WARN` عن `run version` | دالة قديمة منشورة | أعد النشر من الفرع الحالي |
| `WARN` عن snapshot غير فارغ | الترحيل `20261008120000` غير مطبّق | `npx supabase db push` ثم أعد النشر |
| المهام `failed` مع `source_failure` | الشبكة أو المصدر يحجب الجلب | متوقع لـ LinkedIn (فتح يدوي)؛ تحقق من المزودين الآخرين |
| `FUNCTION_INVOCATION_TIMEOUT` | مزود بحث أبطأ من الميزانية | خفّض `searchBudgetMs` في خطة الـ run أو ارفع `maxDuration` |

---

## 7) التراجع (Rollback)

- Vercel: **Deployments → ⋯ → Promote to Production** على أي نشر سابق (فوري).
- لوحة التحكم: `npx supabase functions deploy research-control` من الـ commit السابق.
- قاعدة البيانات: الترحيلات إضافية (`add column if not exists`) وقابلة للتراجع بدون فقدان بيانات الرُبط السابقة.
