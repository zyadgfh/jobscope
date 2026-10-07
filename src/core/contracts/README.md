# Contract-first boundary

هذه المجلدات تحتوي العقود canonical التي تربط طبقات JobScope.

القواعد:
- العقد يسبق التكامل.
- لا يعتمد frontend مباشرة على جداول أو تفاصيل infrastructure.
- كل schema قابل للإصدار versioning.
- Facts وEstimates وInferences حالات مختلفة ولا يجوز دمجها.
- Job Opportunity هو الكيان canonical، بينما Job Posting تمثيل مصدر.
- Evidence وProvenance مطلوبان قبل إصدار Recommendation عالية الثقة.
