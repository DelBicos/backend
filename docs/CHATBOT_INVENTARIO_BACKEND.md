# Chatbot DelBicos — inventário técnico do backend

## 1. Finalidade

Este documento registra os arquivos relacionados ao chatbot no repositório
`DelBicosBackend`, indicando se foram criados para a funcionalidade ou alterados
na adequação para PLN com TF-IDF e SVM.

A classificação foi obtida pelo histórico Git da branch `feature/chatbot`.
Arquivos de outras funcionalidades só aparecem quando participam diretamente da
integração com agendamento, pagamento ou atualização em tempo real.

## 2. Serviço Python criado para PLN

Todos os itens abaixo foram criados na adequação atual.

| Arquivo | Responsabilidade |
| --- | --- |
| `nlp-service/requirements.txt` | Declara FastAPI, Uvicorn, NLTK, scikit-learn, joblib e pytest, com intervalos de versão. |
| `nlp-service/Dockerfile` | Monta a imagem Python, instala dependências, treina o modelo, executa testes e inicia o Uvicorn. |
| `nlp-service/app/__init__.py` | Identifica `app` como pacote Python. |
| `nlp-service/app/preprocess.py` | Remove URLs e menções, normaliza texto e emojis, tokeniza e aplica stemming em português com NLTK. Não utiliza POS Tagging, NER ou lematização. |
| `nlp-service/app/train.py` | Lê o corpus, cria TF-IDF de palavras e caracteres, treina `LinearSVC`, calcula métricas e grava o artefato. |
| `nlp-service/app/model.py` | Carrega o artefato e executa a classificação, calculando confiança a partir da margem do SVM. |
| `nlp-service/app/main.py` | Expõe a API interna FastAPI: `GET /health` e `POST /classify`. |
| `nlp-service/data/intents.json` | Corpus versionado com frases de treino para `AGENDAR`, `ALTERAR`, `CANCELAR`, `CONSULTAR`, `SAUDACAO` e `FALLBACK`. |
| `nlp-service/artifacts/.gitkeep` | Mantém no Git a pasta onde o modelo e as métricas são gerados. |
| `nlp-service/tests/test_preprocess.py` | Testa acentos, espaços, emojis, URLs, menções, tokenização e preservação de comandos importantes. |
| `nlp-service/tests/test_model.py` | Testa treinamento, carregamento e classificação do modelo. |
| `seeders/20260812200000-demo-professional-availabilities.js` | Cria, sem duplicar, agendas semanais e disponibilidades de segunda a sábado para todos os serviços ativos dos oito profissionais demonstrativos. Localiza os registros por e-mail, sem depender de IDs fixos. |

### Artefatos gerados

Estes arquivos são gerados pelo treino e não devem ser editados manualmente:

```text
nlp-service/artifacts/intent_classifier.joblib
nlp-service/artifacts/metrics.json
```

O `joblib` contém o pipeline treinado. O JSON contém versão, hash do corpus,
quantidade de amostras, acurácia, F1 macro e relatório por classe.

## 3. Base Node.js criada originalmente para o chatbot

Estes arquivos constituem a base persistente e conversacional criada quando o
chatbot foi introduzido. Alguns foram alterados posteriormente.

| Arquivo | Responsabilidade atual |
| --- | --- |
| `src/controllers/botChat.controller.ts` | Controllers HTTP para enviar mensagens, recuperar sessão ativa/histórico e consultar status do agendamento. |
| `src/models/BotChatSession.ts` | Modelo Sequelize de sessão, estado, contexto, usuário e agendamento associado. |
| `src/models/BotChatMessage.ts` | Modelo Sequelize das mensagens, remetente, intenção e entidades extraídas. |
| `src/services/botConversation.service.ts` | Orquestra uma mensagem completa: sessão, reinício, NLU, roteamento, persistência e resposta. |
| `src/services/botAppointmentStatus.service.ts` | Criado para sincronizar mudanças do agendamento com o histórico do bot e os dispositivos conectados; foi ampliado na adequação atual. |
| `src/constants/botStates.ts` | Enumera os estados válidos da máquina de conversa. |
| `src/constants/botMessages.ts` | Catálogo inicial de textos padrão. Atualmente não possui importação ativa e pode ser consolidado futuramente com os textos dos estados. |
| `src/utils/nlp.util.ts` | Similaridade textual determinística para encontrar serviços/opções, incluindo normalização e distância de Levenshtein. |
| `src/routes/chat.routes.ts` | Registra rotas de chat humano e chatbot, JWT, rate limit, sessão e polling de agendamento. |

## 4. Máquina de estados modular criada para manutenção

| Arquivo | Responsabilidade |
| --- | --- |
| `src/services/bot/BotStateNode.ts` | Contrato comum que todos os estados implementam. Define resposta, próximo estado, contexto e finalização. |
| `src/services/bot/BotMessageRouter.ts` | Mapeia o estado atual para o handler correto e executa transições encadeadas. |
| `src/services/bot/BotSessionManager.ts` | Cria, carrega, expira, reinicia e salva sessões e mensagens. Monta o histórico para o frontend. |
| `src/services/bot/states/InicioState.ts` | Trata saudação e decide entre agendar, consultar, cancelar ou alterar. |
| `src/services/bot/states/ColetandoServicoState.ts` | Pesquisa serviços/profissionais, faz correspondência textual e prepara opções completas. |
| `src/services/bot/states/ColetandoDataState.ts` | Valida datas, interpreta sugestões e controla seleção contextual de dia da semana. |
| `src/services/bot/states/ColetandoHorarioState.ts` | Valida horários/períodos, consulta disponibilidade e sugere slots alternativos. |
| `src/services/bot/states/ConfirmacaoState.ts` | Processa `sim/não` e executa criação, cancelamento ou reagendamento. |
| `src/services/bot/states/AguardandoIdAgendamentoState.ts` | Recebe/resolve o ID quando a ação depende de um agendamento existente. |
| `src/services/bot/states/AguardandoConfirmacaoState.ts` | Acompanha a resposta do profissional e diferencia pendente, recusado, confirmado sem pagamento e pago. |
| `src/services/bot/states/appointmentActions.ts` | Executa as operações de banco para criar, cancelar e reagendar, além de sala e notificações. |
| `src/services/bot/states/stateHelpers.ts` | Monta resumos e respostas reutilizáveis de confirmação. |

Essa divisão foi feita para evitar um único serviço muito grande e permitir que
cada fase seja testada e modificada isoladamente.

## 5. Arquivos criados na adequação atual do backend Node

| Arquivo | Motivo da criação |
| --- | --- |
| `src/services/botAppointmentStatus.helpers.ts` | Centraliza regras puras de pagamento e mensagens por status sem abrir conexão com banco; também facilita testes unitários. |
| `src/services/__tests__/botAppointmentStatus.service.test.ts` | Verifica `not_available`, `pending`, `paid` e os textos de confirmação. |
| `src/services/__tests__/nlu.service.test.ts` | Verifica a chamada obrigatória ao SVM para mensagens textuais, override e contingência por regras, fallback e extração de entidades. |
| `src/utils/__tests__/date.util.test.ts` | Testa datas relativas, dias da semana, datas por extenso, períodos, horários e fusos. |
| `docs/CHATBOT_PLN.md` | Registra decisão técnica, PLN, regras, operação e atualização de aceite/pagamento. |
| `docs/DOCUMENTACAO_TECNICA_PLN_CHATBOT.md` | Documentação acadêmica da feature nas seções 9.1, 9.2 e 9.3, incluindo dataset e métricas reais. |
| `docs/CHATBOT_FLUXO_COMPLETO.md` | Explica o fluxo completo entre usuário, frontend, Node, Python, banco, socket e Stripe. |
| `docs/CHATBOT_INVENTARIO_BACKEND.md` | Este inventário de arquivos. |

## 6. Arquivos alterados na adequação atual

### 6.1 PLN, sessão e fluxo

| Arquivo alterado | O que foi alterado |
| --- | --- |
| `src/services/nlu.service.ts` | Remove dependência de IA generativa, classifica mensagens textuais pelo TF-IDF/SVM, aplica override ou contingência controlada por regras e extrai entidades determinísticas. |
| `src/services/botConversation.service.ts` | Passa fuso, reconhece reinício global, cria nova sessão limpa e permite interrupção do fluxo por nova intenção. |
| `src/services/bot/BotSessionManager.ts` | Adiciona TTL, encerramento por expiração, reinício real, recuperação apenas de sessão ativa e dados de pagamento no histórico. |
| `src/models/BotChatSession.ts` | Amplia o contexto JSON com fuso, período, status e pagamento. Como são campos dentro de JSON, não exigem nova coluna. |
| `src/controllers/botChat.controller.ts` | Recebe `timezone`, devolve `clear_history` e amplia o polling com mensagem e situação de pagamento. |
| `src/services/bot/states/InicioState.ts` | Ajusta saudação e transições de intenção. |
| `src/services/bot/states/ColetandoServicoState.ts` | Evita tratar o verbo “agendar” como nome de serviço e melhora opções. |
| `src/services/bot/states/ColetandoDataState.ts` | Integra parser expandido e seleção de datas sugeridas por dia da semana. |
| `src/services/bot/states/ColetandoHorarioState.ts` | Integra horários naturais, períodos e fuso. |
| `src/services/bot/states/ConfirmacaoState.ts` | Mantém o novo agendamento ativo no estado de espera e inicia `appointmentPaid` como falso. |
| `src/services/bot/states/AguardandoConfirmacaoState.ts` | Informa automaticamente aceite, recusa e pagamento pendente/pago. |
| `src/services/bot/states/appointmentActions.ts` | Usa data/hora normalizadas ao criar e reagendar. |
| `src/utils/date.util.ts` | Adiciona português informal, datas relativas, abreviações, números por extenso, semana seguinte, períodos, timezone e resolução contextual de horas ambíguas como `seis horas` (`06:00`/`18:00`). |

### 6.2 Aceite, tempo real e pagamento

| Arquivo alterado | O que foi alterado |
| --- | --- |
| `src/services/botAppointmentStatus.service.ts` | Atualiza contexto e histórico da sessão ativa e emite o evento ao cliente/profissional. Não reativa sessão reiniciada. |
| `src/realtime/chatSocket.ts` | Adiciona campos `payment_status`, `payment_pending` e `paid` e utiliza sala autenticada por usuário. |
| `src/services/payment.service.ts` | Após Stripe `succeeded`, grava pagamento e sincroniza chatbot/agenda. Falha no push não desfaz o pagamento. |
| `src/controllers/appointment.controller.ts` | Fluxo de aceite/recusa chama a sincronização de status após a alteração persistida. |

### 6.3 Infraestrutura

| Arquivo alterado | O que foi alterado |
| --- | --- |
| `docker-compose.yml` | Adiciona `nlu-service`, healthcheck, rede interna e variáveis usadas pelo Node. |
| `.env.example` | Documenta URL interna, timeout, limiar de confiança e TTL da sessão. |
| `.gitignore` | Ignora artefatos Python gerados, caches e arquivos locais relacionados. |

### 6.4 Serviços e agendas para demonstração

| Arquivo alterado | O que foi alterado |
| --- | --- |
| `seeders/007-initial-reformas-services.js` | Passa a localizar os sete profissionais iniciais por e-mail e cada serviço por e-mail + título. A execução e o `down` deixam de depender da ordem dos IDs e não removem serviços alheios ao seeder. |
| `seeders/010-demo-professional-services.js` | Evita duplicar os 28 serviços demonstrativos pela chave profissional + título e restringe o `down` aos títulos e profissionais conhecidos. |
| `seeders/012-initial-availabilities.js` | Amplia a agenda geral de um para os sete profissionais iniciais, com regras semanais idempotentes e horários coerentes com seus serviços. |
| `seeders/20260527200000-initial-service-availabilities.js` | Substitui a seleção frágil dos “primeiros 7 serviços” pela chave e-mail + título e insere apenas horários ainda inexistentes. |

## 7. Migrações criadas para a base do chatbot

| Migração | Função |
| --- | --- |
| `migrations/20260702100000-create-bot-chat-session.js` | Cria a tabela de sessões. |
| `migrations/20260702100001-create-bot-chat-message.js` | Cria a tabela de mensagens. |
| `migrations/20260716103000-add-auth-session-to-bot-chat-session.js` | Adiciona vínculo com a sessão autenticada. |
| `migrations/20260717120000-scope-bot-chat-session-by-user.js` | Garante escopo/índice de sessão por usuário. |
| `migrations/20260723100000-enforce-auth-session-not-null.js` | Torna o identificador de autenticação obrigatório. |
| `migrations/20260723100001-add-appointment-service-rating-index.js` | Adiciona índice usado nas consultas de avaliações por serviço exibidas nas opções do chatbot. |

A adequação de agosto não criou nova coluna: `timeZone`, `timePeriod` e
`appointmentPaid` ficam no campo JSON `context`. Em uma instalação vazia, as
migrações históricas continuam necessárias para criar as tabelas do chatbot.

## 8. Rotas atendidas

| Método e rota | Responsabilidade |
| --- | --- |
| `POST /api/chat/bot/message` | Processa mensagem e devolve resposta, estado e contexto. |
| `GET /api/chat/bot/session/active` | Recupera somente a sessão ativa do usuário. |
| `GET /api/chat/bot/session/:id` | Recupera histórico autorizado por ID. |
| `GET /api/chat/bot/appointments/:id/status` | Polling seguro de aceite e pagamento. |
| `PUT /api/appointments/:id` | Aceite/recusa pelo profissional responsável. |
| `POST /api/payments/confirm` | Confirma Stripe e atualiza o agendamento existente. |

## 9. Dependências e limites

- PostgreSQL: sessão, mensagens, agenda, notificações e pagamento;
- MongoDB: conversa humana já existente, não o estado do bot;
- Python: somente classificação de intenção;
- Socket.IO: entrega imediata, não fonte definitiva de verdade;
- Stripe: pagamento;
- frontend: apresentação, entrada e navegação.

GPS, raio de atuação e demais funcionalidades não foram alterados pelo motor de
PLN. O chatbot apenas utiliza serviços, profissionais, endereços,
disponibilidades e agendamentos através das regras existentes.
