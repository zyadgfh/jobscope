# JobScope Deep Research

واجهة بحث ثنائية اللغة للبحث الوظيفي العميق والبحث العام متعدد المصادر، مبنية حول Research Intelligence Core.

## الحالة الحالية — v1.0 foundation على فرع التطوير

JobScope يحتوي على Research Run قابل للتنفيذ والاستئناف عبر checkpointed batches، مع تخطيط بحث deterministic، query expansion وgap detection، بحث متعدد المصادر، استخراج وتطبيع فرص العمل، entity resolution محافظ، Evidence Graph وحالات evidence صريحة، تحقق cross-source، decision scoring، recommendation/reporting، وحفظ durable عبر Supabase control plane.

تشمل الحماية SSRF-safe public retrieval، allowlist للمصادر، منع الشبكات الخاصة والـ credentials، إعادة تحقق من redirects، حدود MIME والحجم والمهلة، security headers، bounded payloads، واختبارات Node.js.

واجهة المستخدم تستأنف آخر Research Run نشط تلقائيًا ولا تختلق نتائج أو درجات عند غياب الأدلة. أضيفت طبقة مالك واحدة عبر Supabase Email/Password، إعدادات مزودي البحث server-side، retention لمدة 30 يومًا للبيانات الوسيطة، ومسارات إعداد الإدارة وتحليل CV المحافظ.

قبل اعتماد Production يجب ضبط `SUPABASE_ANON_KEY` و`SUPABASE_SERVICE_ROLE_KEY` وتهيئة حساب المالك في Supabase Auth، ثم إضافة مفاتيح Brave/Tavily في Vault/Secret Store. لا تُحفظ مفاتيح API في ملفات الواجهة.

## التشغيل محليًا

    npm install
    npm start
    npm test

## API الأساسي

- GET /api/health
- POST /api/research/runs
- POST /api/research/runs/:id/execute
- GET /api/research/runs/:id
- GET /api/research/runs/:id/events
- POST /api/research/runs/:id/pause
- POST /api/research/runs/:id/resume
- POST /api/research/runs/:id/cancel

## الأمان

لا يتم تجاوز CAPTCHA أو تسجيل الدخول أو حماية المواقع. لا يتم وضع service-role أو الأسرار في browser assets. جداول التطبيق في Supabase محمية بـ RLS ولا توجد صلاحيات anonymous مباشرة عليها. مزودو البحث والـ model providers قابلون للاستبدال، مع تفضيل الحلول المجانية/local/BYOK وعدم فرض مزود مدفوع.

الإصدار الحالي نواة تنفيذية حقيقية، وليس بعد منصة عامة مكتملة بكل مزودي البحث التجاريين وتكاملات الوكلاء.
