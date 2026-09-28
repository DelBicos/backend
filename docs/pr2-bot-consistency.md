# PR2 — consistência da agenda do chatbot

Branch: `codex/pr2-bot-consistency-backend`, baseada em `stag-facul` (`cd112ea`).
Compatível com `codex/pr2-bot-consistency-frontend`; nenhum arquivo do frontend foi alterado.

## Comportamento

- B02: horários da agenda, limites do dia, recorrências e bloqueios são interpretados em `America/Sao_Paulo`. Reservas são consultadas por interseção, inclusive quando começam no dia anterior. Bloqueios explícitos também são considerados.
- B03: o contexto validado determina o instante gravado. `selected_time`, inclusive o encaminhado por voz, precisa identificar exatamente o mesmo instante com offset explícito. ISO inválido, dia/horário divergente e data sem a antecedência de dois dias são rejeitados.
- B04: remarcação atualiza a reserva existente dentro de uma transação. Preserva ID, short ID, cliente, endereço, serviço, profissional, preço, duração e pagamento. Uma nova data retorna a `pending` para novo aceite. Repetir a mesma confirmação não cria reserva nem repete a notificação.
- A remarcação não permite trocar serviço/profissional. Uma mudança com outro preço precisa de fluxo financeiro próprio.
- Sugestões de data e horário excluem somente a reserva original e usam a duração contratada.
- A expiração de pendências passa a usar `updatedAt`: remarcação e atualização de pagamento renovam o prazo de 12 horas, preservando `createdAt`. O job revalida a situação dentro da transação antes de cancelar.
- B04 (ciclo posterior à remarcação): expiração e rejeição do profissional gravam o cancelamento e a solicitação de estorno integral na mesma transação. Se a gravação da fila falhar, o cancelamento também é desfeito. O pagamento continua vinculado à reserva para auditoria.
- Enquanto aguarda o novo aceite, o chatbot lê `appointmentPaid` do pagamento persistido, evitando oferecer novamente o pagamento de uma reserva já paga.

## Concorrência

O bloqueio da linha do profissional é adquirido antes de ler e alterar reservas, com isolamento `READ COMMITTED`. Assim, uma segunda requisição aguarda e consulta os dados confirmados pela primeira, inclusive quando o intervalo estava vazio.

O protocolo é compartilhado pela criação do bot, criação convencional, criação pelo pagamento, remarcação, cancelamento do bot, aceite/rejeição do profissional, expiração e alterações das disponibilidades/bloqueios existentes. O hook que gera short ID utiliza a mesma transação da criação.

Escritores novos da agenda devem usar os serviços de `appointmentSchedule.service.ts`; gravações diretas fora desse protocolo não recebem a garantia de exclusão. Bloqueios administrativos continuam podendo ser cadastrados sobre reservas já existentes, sem cancelá-las automaticamente.

## Estorno persistente e implantação

Aplicar as migrations `20260926120000-create-appointment-refund.js` e `20260926121000-allow-unlinked-appointment-refund.js`, nessa ordem, antes de iniciar a versão nova do backend. A primeira cria `appointment_refund`, com unicidade por PaymentIntent e índice para os itens pendentes. A segunda permite registrar compensações de pagamentos que não chegaram a gerar uma reserva. Não iniciam estornos retroativos. Não remover essa tabela enquanto houver itens pendentes; o downgrade da segunda migration é recusado se houver registros sem reserva associada.

O cron processa até 100 itens por execução, a cada 10 minutos, mesmo sem novas expirações. Cada item tem trava própria, contador de tentativas, próxima tentativa e último erro. Erros em uma notificação ou em outro item não impedem o processamento dos demais estornos. Uma rejeição pelo profissional agora informa que o estorno será processado, sem prometer conclusão antes do retorno do provedor.

Antes de reenviar, o worker reconcilia os estornos no Stripe e usa chave idempotente estável. Estornos `pending`/`requires_action` continuam acompanhados; somente o valor integral confirmado como `succeeded` conclui o item. Após um timeout ou falha de commit, a próxima execução reconcilia novamente. Falhas terminais no provedor permitem uma nova tentativa; falhas persistentes ficam registradas para acompanhamento operacional. Documentação: [estornos](https://docs.stripe.com/api/refunds) e [idempotência](https://docs.stripe.com/api/idempotent_requests).

## Confirmação financeira

- A vinculação do pagamento usa a mesma transação e trava da agenda que a expiração. Se o pagamento vencer a corrida, renova o prazo de aceite. Se a expiração vencer, a reserva permanece cancelada e o pagamento tardio entra na fila de estorno, sem ser vinculado a ela.
- Repetir a confirmação de um PaymentIntent já vinculado retorna a mesma reserva, sem consultar o preço atual do catálogo, renovar `updatedAt` ou repetir notificações. Verifica a propriedade do pagamento antes desse retorno. Isso preserva pagamentos após remarcação ou mudança de preço.
- No primeiro pagamento, usa o preço contratado da reserva quando disponível; caso contrário, valida o preço do serviço no backend. Pagamento excedente, valor divergente e conflito de horário recebem compensação persistida. Um PaymentIntent em compensação não pode ser reutilizado para criar ou pagar outra reserva.
- Chat, notificações e sincronização do bot são executados após o commit, isoladamente. Suas falhas não reembolsam uma reserva persistida nem transformam a confirmação em erro HTTP.
- Erros inesperados de banco ou confirmação de commit não disparam estorno às cegas. O cliente pode repetir a confirmação com o mesmo PaymentIntent: o backend verifica o vínculo ou a compensação persistida. Se o banco estiver indisponível, a confirmação continua retornando erro até que possa ser persistida; esse caso não deve ser interpretado como autorização para pagar novamente.

## Verificação reproduzível

```powershell
npm run lint
npm run build
npm run test:unit -- --runInBand

# Banco temporário, sem volume e sem vínculo com o banco do aplicativo.
docker run --detach --rm --name delbicos-pr2-test-postgres --publish 127.0.0.1:55432:5432 --env POSTGRES_USER=pr2_test --env POSTGRES_PASSWORD=pr2_test --env POSTGRES_DB=pr2_test postgres
$env:PR2_TEST_DATABASE_URL = 'postgres://pr2_test:pr2_test@127.0.0.1:55432/pr2_test'
npm run test:integration -- --runInBand
docker stop delbicos-pr2-test-postgres

node scripts/check-pr2-frontend-contract.js C:/DelBicosV2
```

O teste de integração aceita apenas PostgreSQL local com banco chamado `pr2_test`. Ele recria tabelas de teste nesse banco. Os models de teste têm schema mínimo; as consultas, transações e travas são reais. MongoDB, notificações e sala de chat são isolados. Isso não substitui uma validação completa de migrations ou um teste visual do aplicativo.

Cobertura: timezone e equivalência de ISO, recorrências, bloqueios, virada de dia, exclusão da reserva original, criação/remarcação simultâneas, espera real por lock observada no PostgreSQL, rollback depois do UPDATE, preservação financeira, confirmação repetida e expiração. O script de contrato executa o helper real do frontend e compara com o parser do backend, incluindo remarcação e virada do dia.

Resultado da revisão B04 financeira: 49 testes de integração aprovados em PostgreSQL. Typecheck e build aprovados. Os testes cobrem `up`/`down` das migrations reais, rollback da outbox, expiração e workers concorrentes, falha do provedor, retomada após falha na persistência, efeitos posteriores ao commit, repetição após mudança de catálogo e as duas ordens da corrida pagamento/expiração. Após a correção da NLU, a suíte unitária completa passou: 387 testes em 24 suítes, sem falhas. O Stripe foi simulado; não houve estorno real. Na etapa anterior, o contrato frontend/backend passou em 4 cenários sob `UTC`, `America/Sao_Paulo` e `Asia/Tokyo`.

## Extração de datas na NLU

A falha preexistente em `não interpreta uma resposta de data como nome de serviço` foi corrigida. Após remover o prefixo de intenção (por exemplo, `quero`), o extrator agora descarta candidatos que sejam integralmente uma expressão de data, usando a regra ancorada já existente. Assim, `quero segunda` fornece a data sem inventar um serviço; nomes como `segunda via` e `segunda opinião` continuam preservados. A suíte de NLU passa em 119 cenários, incluindo as regressões adicionadas. Não foi necessário alterar ou retreinar o classificador SVM.

Os mocks de sincronização do chatbot nos testes de pagamento/listagem foram isolados, e as fixtures da listagem foram adequadas ao contrato existente de `id` público e `numeric_id`.

Antes do merge, validar visualmente criação e remarcação (texto e voz) com a branch PR2 do frontend. Não houve chamada real ao Stripe nem alteração do banco do aplicativo durante os testes.
