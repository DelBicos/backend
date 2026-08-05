# Chatbot com PLN determinístico

## Decisão técnica

O chatbot não utiliza IA generativa. A mensagem aberta é enviada a um serviço
Python interno que aplica, nesta ordem:

1. normalização, tokenização e stemming em português com NLTK;
2. transformação TF-IDF com unigramas/bigramas de palavras e n-gramas de caracteres;
3. classificação de intenção com `LinearSVC` do scikit-learn;
4. retorno de `FALLBACK` abaixo do limiar configurado, usando a margem de decisão da SVM.

O SVM apenas identifica a intenção. Extração de data, hora, ID de agendamento e
possível nome de serviço usa regras determinísticas no backend Node. As respostas
do bot, estados da conversa, consultas e alterações no banco também continuam
sendo regras de negócio.

## Frases de comando e interrupção de fluxo

Além do corpus de treinamento, o backend mantém regras explícitas para comandos
curtos e inequívocos. Elas tornam o chat previsível quando a pessoa usa frases
como `quero agendar`, `quero cancelar`, `trocar o horário`, `mostrar meus
agendamentos`, `reiniciar` ou `começar de novo`.

Essas regras não são IA generativa e não substituem o requisito de PLN: frases
abertas continuam sendo vetorizadas por TF-IDF e classificadas pela SVM. Para
comandos claros, a regra tem prioridade e permite trocar de intenção mesmo se a
sessão anterior estava aguardando a confirmação de outro agendamento.

O comando `reiniciar` encerra a sessão ativa e cria outra com estado e contexto
vazios. A API sinaliza `clear_history: true` para que o aplicativo apague as
bolhas exibidas antes de mostrar a mensagem inicial da nova conversa.

## Normalização de datas e horários

A classificação da intenção continua sendo feita por TF-IDF e SVM. Datas,
horários e períodos são entidades extraídas por regras determinísticas no
backend, pois dependem do calendário e das regras do agendamento.

O parser aceita, entre outras, as seguintes variações:

- dias da semana com ou sem hífen e com abreviações: `segunda-feira`, `segunda
  feira`, `segunda`, `seg`, `2ª feira`, `sexta que vem` e `sex`;
- datas relativas e abreviadas: `hoje`, `hj`, `amanhã`, `amnh`, `depois de
  amanhã` e `dps de amnh`;
- dia ou data por extenso: `dia 13`, `13 de agosto`, `treze do 09`, `13/08`,
  `13.08` e `13-08-2026`;
- horários exatos: `14:30`, `14h30`, `duas e meia da tarde`, `duas da tarde`,
  `quinze pras três`, `meio-dia` e `meia-noite`;
- períodos: `de manhã`, `pela manhã`, `de tarde`, `fim da tarde`, `de noite` e
  `horário noturno`.

Datas impossíveis, como `31/02`, são rejeitadas. Quando o ano não é informado,
o sistema escolhe a próxima ocorrência futura. `Dia 13` representa o próximo
dia 13 válido do calendário.

Para eliminar a ambiguidade entre semanas, um dia simples ou seguido de `que
vem` representa a ocorrência mais próxima: em uma quarta-feira, `sexta` e
`sexta que vem` apontam para a sexta da mesma semana. Já `próxima sexta`, `sexta
da próxima semana` e `semana que vem na sexta` apontam para a sexta da semana
seguinte.

Quando o bot acabou de apresentar datas alternativas, um dia da semana isolado
passa a ser uma seleção contextual. Se a lista contém `2 — Terça, 18/08`, as
mensagens `terça`, `terça-feira`, `na terça` ou `ter` selecionam `18/08`, mesmo
que exista outra terça-feira mais próxima fora da lista. Números continuam
selecionando a posição da opção. Expressões como `próxima terça` mantêm a regra
de próxima semana.

Um período sem hora exata não é transformado arbitrariamente em um horário. O
backend filtra as disponibilidades reais usando faixas locais fixas: manhã das
06:00 às 11:59, tarde das 12:00 às 17:59 e noite das 18:00 às 23:59. A escolha
final continua sendo confirmada com data e hora exatas.

O frontend já envia um identificador IANA em `timezone`. O backend valida esse
valor, usa-o para interpretar `hoje`, `amanhã` e a antecedência mínima, e mantém
`America/Sao_Paulo` como padrão quando o identificador estiver ausente ou for
inválido. Na criação do agendamento, a data/hora local é convertida para UTC
antes de ser gravada.

## Integração com o frontend existente

Nenhum componente visual é criado ou substituído. O frontend React Native em
`DelBicosV2` já possui o `ChatWindow`, bolhas, cartões de profissionais, quick
replies e confirmação de agendamento. Ele continua usando:

```text
POST /api/chat/bot/message
{ message, session_id?, channel, timezone, utc_offset_minutes, selected_time? }
```

O backend preserva a resposta consumida por `useChatSession`:

```text
{ session_id, message, state, context }
```

Em especial, `state`, `context.serviceOptionsData`, `context.suggestedSlots` e
`selected_time` não são alterados. Portanto cartões, chips e o fluxo web/mobile
permanecem iguais; somente a origem de `intent` muda de LLM para SVM.

## Confirmação do profissional e pagamento

O agendamento criado pelo chatbot permanece com status `pending` até a ação
do profissional. Quando o profissional clica em **Aceitar** na agenda, o fluxo
executa as seguintes etapas:

1. o backend valida que o usuário autenticado é o profissional responsável;
2. o agendamento muda de `pending` para `confirmed` no banco relacional;
3. uma notificação persistente é criada para o cliente;
4. o evento autenticado `appointment:status` é enviado por Socket.IO aos
   dispositivos conectados do cliente e do profissional;
5. a agenda do cliente é recarregada e apresenta **Pagamento pendente**;
6. o chatbot grava e exibe a mensagem de confirmação com a orientação para
   pagar, além de disponibilizar o botão **Pagar**.

O evento não substitui a persistência. Se o navegador ou aplicativo estiver
fechado no momento do aceite, a mensagem é gravada na sessão ativa do bot e
será restaurada na próxima abertura. Se a conexão Socket.IO cair, o frontend usa
como contingência:

```text
GET /api/chat/bot/appointments/:id/status
```

A resposta inclui `status`, `message`, `payment_status`, `payment_pending`,
`paid` e `poll_after_ms`. Enquanto o profissional ainda não respondeu, a
consulta ocorre a cada 5 segundos. Depois do aceite e antes do pagamento, ocorre
a cada 10 segundos. O polling é encerrado quando não existe mais uma mudança
pendente a acompanhar.

Após o checkout confirmar o `PaymentIntent`, o identificador do pagamento é
gravado no agendamento. O mesmo evento é emitido novamente com
`payment_status: paid`, fazendo a agenda e o chatbot mudarem para o estado pago
e confirmado. Uma falha apenas no envio do evento não reverte o pagamento: o
status persistido continua sendo obtido pelo polling.

O comando **Reiniciar** encerra a sessão ativa do chatbot. Atualizações futuras
do agendamento continuam existindo na agenda e nas notificações, mas não
reativam nem repovoam a conversa que o cliente decidiu limpar.

## Componentes

| Local | Responsabilidade |
| --- | --- |
| `nlp-service/data/intents.json` | Corpus versionado das seis intenções. |
| `nlp-service/app/preprocess.py` | NLTK: normalização, tokenização e stemming. |
| `nlp-service/app/train.py` | Treino, avaliação e geração do artefato SVM. |
| `nlp-service/app/main.py` | API interna `POST /classify` e `GET /health`. |
| `src/services/nlu.service.ts` | Cliente do classificador e extração local por regras. |
| `src/services/botAppointmentStatus.service.ts` | Sincroniza sessão, histórico e evento de status do agendamento. |
| `src/realtime/chatSocket.ts` | Entrega eventos autenticados por usuário. |
| Estados em `src/services/bot/states/` | Respostas e transições determinísticas. |

## Operação

O `docker-compose.yml` adiciona `nlu-service` sem publicar a porta 8000. Apenas
o backend Node o acessa em `http://nlu-service:8000`. O build treina o modelo a
partir do corpus e grava `intent_classifier.joblib` dentro da imagem.

Variáveis relevantes:

```env
NLU_SERVICE_URL=http://nlu-service:8000
NLU_CLASSIFIER_TIMEOUT_MS=1000
NLU_CONFIDENCE_THRESHOLD=0.65
BOT_SESSION_TTL_HOURS=24
```

Se o classificador não responder dentro do prazo, o backend retorna `FALLBACK`;
ele não faz nenhuma chamada de contingência a OpenAI, Gemini ou outro modelo
generativo.

Sessões ativas com mais de `BOT_SESSION_TTL_HOURS` são encerradas e não são
restauradas automaticamente. Sessões encerradas continuam disponíveis somente
pelo histórico consultado por ID; a abertura do chat recupera apenas uma sessão
ativa e recente.

## Evolução do corpus

Antes de alterar o corpus, remover ou anonimizar identificadores pessoais. Para
cada nova intenção, incluir ao menos 30 exemplos variados e equilibrar as classes.
O treinamento grava `metrics.json` com acurácia, F1 macro e relatório por classe.
Revisar a matriz de confusão antes de subir uma imagem nova.
