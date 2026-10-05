# DelBicos backend architecture

> "The architecture should make the correct implementation the obvious
> implementation."

A developer, human or agent, should be able to find, understand and safely
change a piece of code without learning unrelated abstractions. This document
explains *why* each rule exists. The rules themselves, short and imperative,
live in `.agents/rules/` and are what coding agents read.

## Principles

1. **Discoverability.** Every piece of code has one obvious place and one
   obvious shape.
2. **Explicit responsibility.** Each layer exists for a reason you can name.
3. **Minimum necessary architecture.** A new layer needs a concrete
   responsibility no existing layer covers. No service, repository or use case
   "because the book says so".
4. **Composition before inheritance.** Inheritance only where a framework
   requires it: Sequelize models (`extends Model`) and error classes
   (`extends Error`).
5. **Libraries before home-made abstractions.** If the language or a library
   solves it, do not write a helper or wrapper.
6. **Abstract behavior, not appearance.** Unify only when intent and behavior
   are the same. The same logic twice is already a smell; the third copy is a
   strong signal to extract. DRY means one source of truth per behavior, not
   removing textual repetition.
7. **Consistency before local perfection.** A pull request follows the
   dominant pattern, even if something "more elegant" exists.
8. **Architecture changes are deliberate.** Proposal, discussion, agreement,
   migration plan, then implementation. Never inside a feature pull request.
9. **Visible exceptions.** A workaround stays evident and commented where it
   is applied, never disguised as an official abstraction.
10. **Reviewability.** Code must be easy for someone else to review.
11. **The backend protects the business.** The frontend is not a trusted
    boundary; the database is reached only from the backend.

## Layers

- **`server.ts`** sets up middlewares and registers one route group per
  domain (`app.use("/api/user", userRoutes)`), so the API surface reads in
  one place.
- **Routes** only bind an endpoint to middlewares and a controller
  (`router.post("/login", logInUser)`). Logic in a route file is invisible to
  anyone reading controllers.
- **Controllers** are exported functions, never classes: two paradigms for the
  same responsibility make the code harder to navigate. A controller may hold
  the full logic of its endpoint when that logic belongs only to it.
- **Business rules (decision D1).** A controller calls the model directly for
  plain CRUD. Business rules, transactions over more than one table, and logic
  reused by more than one endpoint go to `src/services/<domain>/`. Mandatory
  repository, use case or service layers stay rejected.
- **Services** exist for the business rules of a domain or for an external
  capability (storage, payment, e-mail, speech). A service that only forwards
  to a model is a layer without responsibility. Files end in `.service.ts`,
  `.rules.ts`, `.types.ts` or `.test.ts`, so the role of each file shows in
  its name.
- **Models** hold shape, types and field constraints, not the core business
  rules. Every schema change ships with a reversible migration.
- **Databases (decision D8).** PostgreSQL through Sequelize is the default.
  MongoDB through Mongoose holds only `ChatMessage` and `LoginLog`. A new
  collection is an architecture decision.
- **Closed folder list (decision D3).** Top-level folders in `src/`: assets,
  config, constants, controllers, docs (OpenAPI), errors, interfaces, jobs,
  middlewares, models, realtime, routes, services, templates (e-mail), types,
  utils and `__tests__`; the only loose file is `app.ts`. A new folder is a
  competing pattern without a team decision.

## Anti-patterns

| Anti-pattern | Why it hurts |
| --- | --- |
| Class controller among functional controllers | Two paradigms for one responsibility |
| Service that only forwards to a model | Layer without responsibility |
| Mandatory repository or use case | Extra architecture without need |
| Inheritance to share a little behavior | Implicit, hard-to-trace behavior |
| Helper for a trivial expression | Indirection for something obvious |
| Abstraction by syntactic similarity | Erases differences of intent |
| Generic workaround | A local exception disguised as an official abstraction |
| New folder category inside a pull request | Competing pattern without a decision |

Objective signals (class controller, new folder, service file suffix) can
become CI checks. Subjective ones (forwarding service, utility with domain
logic, abstraction after one occurrence) stay as review suggestions.

## Not decided yet

These were never discussed with concrete examples and must not become rigid
rules yet: where validation lives (controller, middleware or model schema),
where each layer is tested, naming conventions, and concrete services for
retries, queues and other external clients.

## How the agent rules work

- **Single source.** `.agents/rules/*.md`, in English, with frontmatter
  (`description`, `trigger`, `globs`, `alwaysApply`):
  - `00-core.md`: stack, architecture, code rules, governance. Every tool
    loads it in every conversation, so it stays short (about 60 lines).
  - `01-overlay.md`: temporary initiatives and legacy exceptions, each with an
    owner and an expiry date.
  - `02-<layer>.md`, `03-tests.md`, `04-infra.md`: loaded only when the agent
    works on matching files.
- **Generated files.** `npm run rules:sync` (`scripts/rules/sync.mjs`) writes
  `AGENTS.md` (Codex, Cursor, Antigravity), `CLAUDE.md` (imports `AGENTS.md`),
  `.github/copilot-instructions.md`, `.claude/rules/`, `.cursor/rules/`,
  `.github/instructions/` and `.claude/settings.json`. Every tool receives the
  same text without relying on imports. Generated files are never edited by
  hand.
- **Edit lock.** `.claude/settings.json` denies Claude Code edits to the rules
  and their enforcement. Other tools only have the governance text in the
  core.
- **Local files.** Git hooks (`post-merge`, `post-checkout`, `post-rewrite`,
  installed by husky on `npm install`) run `sync.mjs --enforce`: they
  regenerate the outputs and move untracked instruction files (`CLAUDE.local.md`,
  `.cursorrules`, `AGENTS.md` in a subfolder, stray files in `.cursor/rules/`
  and similar) to `.git/rules-quarantine/<date>/`. Nothing is deleted.
- **CI.** The `Rules` workflow (job `Rules (sync + instruction files)`) fails
  when generated files differ from the source, and when a pull request adds
  instruction files outside the system, plan-like documents or logs.
- **CODEOWNERS.** Rules and enforcement files need approval from the rules
  owner. The governance text has an opening ("unless the user says the
  current task is rules maintenance"); CODEOWNERS closes it.
- **Gradual adjustment.** Existing code outside the rules is not refactored in
  bulk. It is listed in `01-overlay.md`; an agent that edits such a file fixes
  that file and only the direct imports the fix needs, and stops to ask if the
  fix grows beyond that. The rules win over existing code, so the wrong
  pattern is never copied just because it exists.

The rules never tell an agent to read this document: that would spend tokens in
every conversation.

## Maintenance

A new rule is born from a repeated agent mistake, never from "maybe one day".

1. **Change a rule:** edit only the `.md` in `.agents/rules/`, run
   `npm run rules:sync`, and commit source and generated files together in a
   pull request that changes only rules, titled `chore(rules): ...`. The
   description names the agent mistake that motivated it.
2. **New convention:** valid everywhere and one line long goes to the core;
   valid for one folder goes to that folder's layer. A new layer only when a
   folder has no coverage and agents fail there more than once.
3. **Temporary initiative:** a section in `01-overlay.md` with name, expiry
   date (up to 90 days) and owner. When it ends, delete the section; any
   permanent convention becomes one or two lines in a layer.
4. **Token budget:** core around 60 lines; layers with 3 to 10 bullets that do
   not repeat the core; never `alwaysApply: true` on a layer.
5. **Monthly review:** check in at least two tools that each one receives the
   core and the right layer. In Claude Code, `/doctor prompt-audit` flags
   contradictory instructions and references to missing files.
6. **Personal preferences** (reply language, tone, commit style) live in each
   person's tool settings, never in the repository.
