---
paths:
  - "src/utils/**"
---
<!-- GENERATED from .agents/rules/02-utils.md by scripts/rules/sync.mjs. Do not edit. -->

# Utils
- Small, generic helpers: dates, formatting, logging, retries, SSE plumbing.
- If a function needs to know what a domain field means, it is a business
  rule: it goes to `src/services/<domain>/<name>.rules.ts`.
- Do not wrap a trivial expression or a library call that is already clear.
- Logging goes through `src/utils/logger.ts`; do not add another logger.
