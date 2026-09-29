# DelBicos — backend (Express / TypeScript / Sequelize)

API do site e app. O frontend fica em `../frontend` (mesma branch: `refactor/estrutura-seguranca`).

**Leia primeiro:** `../frontend/docs/CONTINUAR_DESENVOLVIMENTO.md` (estado do refactor, próximo passo e pendências) e o `README.md`.

## Regras do projeto
- Só faça commit/push quando o usuário pedir.
- Sem `any` e sem `console.*` (o teste `src/__tests__/codeQuality.test.ts` falha). Logs: `utils/logger`. Erros desconhecidos: `utils/errors.util` (`errorMessage`). Corpo de requisição: `utils/requestBody.util`.
- Controllers finos; regra de negócio em `src/services`. Erros de domínio: `HttpError`.
- Arquivos abaixo de 600 linhas. A documentação OpenAPI fica em `src/docs`, não nas rotas.
- Dinheiro: pagamento é autorizado (`capture_method: manual`) e capturado só quando o profissional aceita; acertos em `services/payment/settlement.ts`.
- Horários da agenda são "relógio de parede" guardados como UTC; o servidor valida que o horário está na agenda (`assertSlotInAgenda`) e respeita 12 h de antecedência (`constants/booking.ts`).
- Mudou o banco? Crie migration em `migrations/`. No dev local o `sync({ alter: true })` já aplica; em stag/produção só migration.
- Documentos de identidade: sempre no container privado (`getPrivateStorageAdapter`), nunca no ImgBB.

## Checagens antes de entregar
`npx tsc --noEmit && npx jest`

## Ambiente
`npm run docker:dev` (API :3000, Swagger em /docs). Segredos só no `.env` (nunca commitar).
