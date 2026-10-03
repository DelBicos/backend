---
description: Models, migrations and seeders - data shape and schema changes
trigger: glob
globs: "src/models/**, migrations/**, seeders/**, src/config/database.ts"
alwaysApply: false
---

# Models and schema
- Sequelize models extend `Model` and declare shape, types and constraints.
  No business rules in models.
- Associations only in `src/models/associations.ts`.
- Every schema change ships with a reversible migration in `migrations/`
  (`YYYYMMDDHHMMSS-description.js`, with `up` and `down`). `sync({ alter: true })`
  is for local development only; stag and production change only by migration.
- Seeders hold demo or reference data, never real personal data or secrets.
- Mongoose models exist only for `ChatMessage` and `LoginLog`. Do not add
  another without a team decision.
