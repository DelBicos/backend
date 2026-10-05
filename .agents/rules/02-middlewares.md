---
description: Middlewares - auth, security, logging and request validation
trigger: glob
globs: "src/middlewares/**"
alwaysApply: false
---

# Middlewares
- Cross-cutting concerns only: auth, admin checks, CORS, security headers,
  logging and request validation.
- Names: `<concern>.middleware.ts`, or `<domain>.validation.ts` for request
  validation of one domain.
- A validation middleware answers 400 with a message in Portuguese and calls
  `next()` otherwise. Business decisions stay in the controller or the domain
  service.
- Authenticated handlers type the request as `AuthenticatedRequest` from
  `src/interfaces/authentication.interface.ts`.
