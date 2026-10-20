# Growth progress (can-run pages + release playbook)
- 2026-10-19 23:05 MDT: start. Existing can-run generator in tools/generate_extra_pages.js (cap 20, measured-only). 143 measured single-GPU pairs available. Plan: raise cap to ~70 with priority scoring, dedupe same-device targets, add alternatives/depth summary/FAQ, small set of clearly-labelled estimated Mac pages, model-page links, tests.
- 23:08: can-run expanded to 72 pages (64 measured, 8 labelled Mac/unified estimates), alternatives+depth summary+FAQ, model-page links, tests updated; all tests pass. Next: publish.
- 23:09: published 9997cfc (72 can-run pages). Next: release playbook + helper.
- 23:10: release fast path done: tools/add_release.js (model|gpu|apple|unified|pairs), tools/release_hot.json support in generator (CAP_REL 8, 45-day expiry), release-playbook.md. Sandbox-tested gpu + apple paths end-to-end (copy deleted).
