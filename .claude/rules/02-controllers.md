---
paths:
  - "src/controllers/**"
---
<!-- GENERATED from .agents/rules/02-controllers.md by scripts/rules/sync.mjs. Do not edit. -->

# Controllers
- One exported async function per endpoint:
  `export const getFavorites = async (req: Request, res: Response) => { ... }`.
- Parse and validate input, take user, client and professional ids from the
  authenticated request (`req.user`, never ownership ids sent by the client),
  then call the model (plain CRUD) or the domain service, and map errors to
  status codes.
- The full logic of an endpoint may live here when it belongs only to that
  endpoint and has no business rule. Anything reused or rule-based goes to
  `src/services/<domain>/`.
- Status codes: 400 invalid input, 401 unauthenticated, 403 forbidden,
  404 not found, 409 conflict, 429 rate limited, 500 unexpected.
- API messages in Portuguese. Never return passwords, tokens or other secrets.
