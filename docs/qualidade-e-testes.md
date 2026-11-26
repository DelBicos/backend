# Plano de testes — Backend

> API do DelBicos: Express + TypeScript, Sequelize/PostgreSQL, Mongoose (chat e logs de login), Socket.IO e Stripe.
> Versão de 26/11/2026, escrita sobre a `stag` daquele dia. O plano do app fica em `DelBicos/frontend`, no mesmo caminho.

## 1. Origem e o que mudou

Este plano reaproveita os documentos da disciplina de Qualidade e Testes de Software (set. e out. de 2026) e os confronta com o código atual:

| Documento antigo | O que foi reaproveitado | O que estava desatualizado |
| --- | --- | --- |
| TQS — Entrega 1 (plano e casos de teste) | Requisitos, escopo, níveis e tipos de teste, critérios de entrada e saída, papéis | Ciclo do agendamento sem foto nem aprovação do cliente; RNF-08 (código de 6 dígitos) e RF-12 (expiração em 12 h) seguem valendo |
| Testes unitários para o fluxo de agendamento | CT-UNIT-01 a 38 viraram as suítes de agendamento e pagamento | `amount` e `currency` não são mais validados: o valor é calculado no servidor; o workflow é o `tests.yml`, não `unit-tests.yml` |
| Casos de teste UML — Check-in/Check-out | Técnica de cobertura de estados, transições e caminhos | Os estados mudaram (ver seção 6) |
| Análise de valores limites — avatar | Casos de tipo de arquivo e de nome | Hoje são aceitos JPEG, PNG e WEBP (GIF não); não há limite de 5 MB no servidor (ver seção 7) |

## 2. Objetivo

- Garantir que as regras de negócio da API (agendamento, pagamento, check-in, chat, cadastro) se comportam como especificado.
- Impedir regressões: toda PR roda typecheck e testes unitários no CI.
- Atingir e manter **80% de cobertura de linhas** nos testes unitários (RNF-06).

## 3. Escopo

**Incluído:** autenticação e MFA, usuários e consentimento de localização, profissionais e raio de atuação, serviços e catálogo, busca semântica, agendamento (criação, cancelamento com política, não comparecimento, reagendamento, disputa, avaliação), deslocamento e check-in/check-out, pagamento Stripe (intenção, captura, estorno), chat (REST e Socket.IO), chatbot e comando de voz, notificações, disponibilidade e bloqueios, endereços e favoritos, admin, tickets de suporte, upload para Azure Blob, jobs (expiração de pedidos e aviso de serviços próximos), segurança (Helmet, rate limit, sanitização, CORS).

**Excluído:** carga e performance; testes contra Stripe, Azure ou Cosmos reais no CI; o `nlp-service` em Python, que tem suíte própria (`pytest`).

## 4. Requisitos cobertos

Atualizados a partir da Entrega 1.

| ID | Requisito | Prioridade | Onde é testado |
| --- | --- | --- | --- |
| RF-01 | Cadastro com confirmação de e-mail | Alta | `services/auth`, `auth.controller` |
| RF-02 | Login (com MFA opcional) | Alta | `services/auth`, `user.controller`, `admin.controller` |
| RF-03 | Busca de profissionais e serviços | Alta | `catalog`, `professional.search`, `semanticSearch`, `caixa-preta-busca.md` |
| RF-04 | Agendamento | Alta | `appointment.controller`, `services/appointment`, `caixa-preta-agendamento.md` |
| RF-05 | Pagamento via Stripe | Alta | `payment.service`, `payment.capture`, `payment.controller` |
| RF-06 | Chat entre cliente e profissional | Alta | `chat.service`, `chat.controller` (socket: lacuna, seção 9) |
| RF-07 | Profissional confirma ou recusa | Alta | `services/appointment` |
| RF-08 | Validação do código no início e no fim do serviço | Crítica | `checkin.rules`, `checkin.service` |
| RF-11 | Profissional marca "a caminho" e "chegou" | Alta | `checkin.rules` (chegada a até 300 m) |
| RF-12 | Pedido pendente expira em 12 h | Média | `jobs/appointmentCron` |
| RF-13 | Cancelamento com política de retenção | Alta | `cancellation.rules`, `lifecycle.rules` |
| RF-14 | Avaliação após conclusão (nota 1–5, até 500 caracteres) | Média | `appointment.controller` (AG-L-10 a 15) |
| RF-15 | Admin: estatísticas, disputas, verificações | Alta | `admin.controller`, `stats.service`, `dispute.service` |
| RNF-01 | JWT nas rotas protegidas | Segurança | `auth.middleware`, `admin.middleware`, `app.test` |
| RNF-02 | Rate limit | Segurança | `app.test` (configuração); comportamento: manual |
| RNF-03 | Sanitização de entradas | Segurança | `app.test`, validações em `middlewares` |
| RNF-06 | Cobertura ≥ 80% | Qualidade | `npm run test:coverage` |
| RNF-08 | Código de 6 dígitos | Segurança | `checkin.rules` |

RF-09 (foto do serviço) e RF-10 (aprovação do cliente) da Entrega 1 não foram implementados e ficam fora até existirem.

## 5. Estratégia

| Nível | Foco | Ferramenta | Onde |
| --- | --- | --- | --- |
| Unitário | Regras, services, controllers, middlewares, utils, jobs | Jest + ts-jest, com modelos, Stripe, Mongo e logger mockados | `src/**/__tests__/*.test.ts` |
| Integração | Services contra um PostgreSQL descartável | Jest + `docker-compose.test.yml` | `src/**/__tests__/integration/` |
| Caixa-preta | Partição de equivalência e valores limite nas rotas públicas | Jest (unitário) + documento | `docs/caixa-preta-*.md` |
| Sistema (E2E) | Fluxos completos no Azure de homologação | Manual, com as contas de teste | Roteiro na seção 8 |
| Aceitação | Demonstração para professores e banca | Manual | — |

Convenções (de `.agents/rules/03-tests.md`):
- Teste ao lado do código, em `__tests__/`, terminando em `.test.ts`.
- Unitário nunca abre banco nem rede: `jest.mock` de `config/database` por arquivo, com o mock de `src/config/__mocks__/database.ts`.
- Controllers com `asyncHandler` são testados pelo `errorHandler`, com `settled()`, `mockReq()` e `mockRes()` de `src/controllers/__tests__/handlerTestUtils.ts`.
- Nenhum `any` novo; títulos de teste em português.
- Nunca apagar, pular ou afrouxar um teste para uma mudança passar.

## 6. Ciclo do agendamento (estados e transições)

O diagrama da Entrega 1 foi atualizado para o modelo atual (`APPOINTMENT_STATUSES`).

| # | Origem | Destino | Gatilho | Rota / código | Testado |
| --- | --- | --- | --- | --- | --- |
| T1 | — | `pending` | Cliente agenda ou paga | `POST /api/appointments`, `POST /payments/confirm` | Sim |
| T2 | `pending` | `confirmed` | Profissional aceita | `POST /:id/confirm` | Sim |
| T3 | `pending` | `canceled` | Cliente cancela ou profissional recusa | `POST /:id/cancel` | Sim |
| T4 | `pending` | `canceled` | 12 h sem resposta (`canceled_by = system`) | `jobs/appointmentCron` | Sim |
| T5 | `confirmed` | `in_transit` | Profissional sai | `POST /:id/in-transit` | Sim |
| T6 | `in_transit` | `arrived` | Profissional chega (até 300 m) | `POST /:id/arrived` | Sim |
| T7 | `arrived` | `in_progress` | Profissional informa o código do cliente | `POST /:id/start-service` | Sim |
| T8 | `in_progress` | `completed` | Profissional informa o código de novo | `POST /:id/complete-service` | Sim |
| T9 | `confirmed` | `no_show` | Não comparecimento | `POST /:id/no-show` | Sim |
| T10 | `confirmed` | `canceled` | Cancelamento com retenção conforme a antecedência | `POST /:id/cancel` | Sim |
| T11 | `pending`, `confirmed` | mesmo status | Reagendamento pedido e aceito | `POST /:id/reschedule[/respond]` | Sim |

Diferenças para a Entrega 1: não há estado "Check-out" nem aprovação do cliente; o serviço vai de `in_progress` direto a `completed`. Também não há cancelamento depois que o profissional sai (`in_transit` em diante): a Entrega 1 previa cancelamento de emergência no trajeto e durante a execução; hoje esses casos não têm saída no sistema. A disputa (`POST /:id/dispute`) só pode ser aberta pelo cliente em `confirmed`, `no_show` ou `completed`. Os campos de data são `arrived_at`, `completed_at` e os do audit trail (`/:id/audit-trail`).

**Caminhos a manter cobertos:** feliz completo (T1→T2→T5→T6→T7→T8), cancelamento antes do aceite (T1→T3), expiração (T1→T4), cancelamento após aceite (T1→T2→T10), não comparecimento (T1→T2→T9) código errado em T7 e T8 (status não muda) e tentativa de cancelar em `in_transit` (recusada).

## 7. Upload de imagens (valores limite)

Atualizado a partir da análise de valores limites do avatar. O app envia direto para o Azure Blob com uma URL SAS; o backend só gera a URL e salva o endereço final.

| ID | Caso | Esperado hoje | Testado |
| --- | --- | --- | --- |
| UP-01 | `image/jpeg`, `image/png`, `image/webp` | URL gerada; chave `avatars/<userId>/<uuid>.<ext>` | Sim (`uploadPolicy`, `upload.controllers`) |
| UP-02 | GIF, PDF, executáveis | 400 | Sim |
| UP-03 | Nome com `../` ou caracteres especiais | Ignorado: a chave é gerada no servidor | Sim |
| UP-04 | Sem usuário | 401 | Sim |
| UP-05 | `avatar_uri` sem https | 400 | Sim (`avatar.controller`) |
| UP-06 | Arquivo acima de 5 MB | **Sem limite no servidor** | Não — lacuna (seção 9) |
| UP-07 | Conteúdo que não é imagem com extensão de imagem | **Não verificado** | Não — lacuna |

## 8. Roteiro manual (sistema)

Em `https://azure.delbicos.com.br`, com `fernando@delbicos.com.br` (cliente) e `isabel@delbicos.com.br` (profissional):

1. Cliente busca um serviço, agenda e paga com cartão de teste do Stripe.
2. Profissional confirma; os dois abrem o chat e trocam mensagens; o histórico aparece ao reabrir.
3. Profissional marca "a caminho", "cheguei", inicia e conclui com o código do cliente.
4. Cliente avalia.
5. Repetir com cancelamento antes e depois do aceite e conferir o estorno.

## 9. Lacunas conhecidas

| Área | Situação | Ação |
| --- | --- | --- |
| Socket do chat (`realtime/chatSocket.ts`, 25%) | Testado só manualmente | Testes com `socket.io-client` contra um servidor em memória |
| Chatbot (`appointmentActions`, `BotSessionManager`, `botChat.controller`) | 12–23% | Ampliar as suítes de estados |
| `appointmentSchedule.service`, notificações de agendamento, `checkUpcomingServicesJob` | Abaixo de 40% | Testes unitários |
| Upload (UP-06, UP-07) | Sem limite de tamanho nem checagem de conteúdo | Decidir a regra antes de testar |
| Rate limit | Só a configuração é testada | Teste com Supertest |

## 10. Critérios de entrada e saída

**Entrada:** `npm ci` sem erro; `npm run lint` limpo; variáveis de teste definidas (o CI já define `ENVIRONMENT=test` e chaves fictícias); para integração, PostgreSQL de `docker-compose.test.yml` no ar.

**Saída de uma PR:** typecheck e testes unitários verdes no CI; nenhum teste removido ou pulado; teste novo para regra nova ou bug corrigido.

**Saída de uma entrega:** cobertura de linhas ≥ 80%; 100% dos casos críticos (RF-08, pagamento, check-in) automatizados e verdes; roteiro manual executado no Azure; 0 defeitos bloqueantes abertos.

## 11. Como rodar

```bash
npm run test:unit            # unitários (o mesmo do CI)
npm run test:coverage        # com relatório de cobertura em coverage/
npm run test:db:up && PR2_TEST_DATABASE_URL=... npm run test:integration
cd nlp-service && pytest     # serviço de NLP
```

## 12. Cobertura

| Data | Linhas | Ramos | Funções | Observação |
| --- | --- | --- | --- | --- |
| 26/11/2026 | 72,4% | 78,7% | 75,8% | `stag` após a #172; `src/docs` (só comentários OpenAPI) e `src/interfaces` (só tipos) entram na conta com 0% |

Meta: 80% de linhas. Ao atingir, travar o mínimo em `coverageThreshold` no `jest.config.js` para o CI barrar quedas.

## 13. Papéis

| Papel | Responsabilidade | Responsável |
| --- | --- | --- |
| Analista de testes | Manter este plano, os casos e o relatório | Douglas |
| QA / testador | Executar o roteiro manual e registrar defeitos | Gustavo |
| Desenvolvedores backend | Escrever os testes junto com o código e corrigir defeitos | Eduardo, Iago, Lucas |
| Analista de requisitos | Validar regras de negócio | Fernando L. |
| Product owner | Priorizar e aceitar as entregas | Isabel |
| Orientação | Acompanhar e aprovar | Prof. Cassio, Profª Maria Janaina |
