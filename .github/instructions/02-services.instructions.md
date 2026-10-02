---
applyTo: "src/services/**"
---
<!-- GENERATED from .agents/rules/02-services.md by scripts/rules/sync.mjs. Do not edit. -->

# Services
- A service exists for the business rules of a domain or for an external
  capability (storage, payment, e-mail, speech). A service that only forwards
  to a model is not allowed.
- Location: `src/services/<domain>/`. File suffixes:
  - `<name>.service.ts`: the domain service, called by controllers; does I/O.
  - `<name>.rules.ts`: business rules (policies, lifecycle, validations).
  - `<name>.types.ts`: types of the domain.
  - `<name>.test.ts`: tests, including `.service.test.ts` and `.rules.test.ts`.
- Notifications, helpers and in-memory stores of a domain are `.service.ts`.
  Policies and lifecycle are `.rules.ts`. No other suffix.
- Domain errors are `Error` subclasses exported by the service that throws
  them; the controller maps them to status codes.
