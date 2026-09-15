# MVP — Comando de voz e busca semântica (back-end)

## Objetivo

Permitir que a pessoa descubra serviços e profissionais por significado e use
voz para iniciar os mesmos fluxos já disponíveis no chatbot: agendamento,
consulta, cancelamento e reagendamento.

O back-end não executa ações diretamente pelo áudio. A fala vira texto e passa
pela mesma máquina de estados do chatbot, que mantém todas as confirmações.

## Componentes

```text
Web ou mobile -> POST /api/voice/transcriptions -> texto
texto -> POST /api/chat/bot/message -> intenção + fluxo de agendamento
Web ou mobile -> POST /api/voice/commands -> transcrição + fluxo em uma chamada
consulta de catálogo -> GET /api/services/search/semantic?q=... -> serviços ordenados
```

### Busca semântica

O `nlp-service` continua usando TF-IDF + SVM exclusivamente para classificar a
intenção. A busca de serviços usa o modelo multilíngue de embeddings
`paraphrase-multilingual-MiniLM-L12-v2`:

1. O Node consulta serviços ativos e aplica os filtros de categoria,
   subcategoria e disponibilidade no banco.
2. Envia somente `id` e um documento público de cada serviço ao endpoint interno
   `POST /semantic-search`.
3. O Python calcula similaridade de cosseno e devolve IDs/score ordenados.
4. O Node busca os registros completos no banco e devolve serviço, profissional,
   localização, categoria e disponibilidade.

O serviço Python não acessa o banco. Assim filtros, autorização e dados expostos
continuam sob responsabilidade da API principal.

Exemplo: a consulta `preciso aparar meu cabelo` pode retornar `corte de cabelo`
mesmo que as palavras não coincidam exatamente.

## Rotas

### `GET /api/services/search/semantic`

Consulta pública de catálogo.

Parâmetros:

| Parâmetro | Obrigatório | Descrição |
| --- | --- | --- |
| `q` | Sim | Texto entre 2 e 500 caracteres. |
| `page`, `limit` | Não | Paginação; limite máximo de 50. |
| `category_id`, `subcategory_id` | Não | Filtros do catálogo. |
| `day` | Não | Dia de disponibilidade, de 0 (domingo) a 6 (sábado). |

Resposta: `{ total, candidate_total, page, limit, has_more, results_limited, data }`.
`total` é a quantidade de resultados semanticamente relevantes dentro da janela
de melhores resultados configurada; `candidate_total` informa quantos serviços
passaram pelos filtros antes do ranking. Se `results_limited` for `true`, há
mais candidatos do que a janela de ranking permite avaliar/paginar nesta
consulta. Cada item inclui o serviço,
`relevance_score`, profissional, usuário público, endereço, categoria,
subcategoria e disponibilidades.

Se o modelo interno não estiver disponível, responde `503`; a interface deve
manter a listagem normal de `GET /api/services` e oferecer nova tentativa.

### `POST /api/voice/transcriptions`

Rota autenticada e limitada a 30 requisições a cada 15 minutos em produção.

- Corpo: bytes brutos de um único áudio, até 10 MB.
- `Content-Type`: `audio/webm`, `audio/mp4`, `audio/m4a`, `audio/x-m4a`,
  `audio/mpeg`, `audio/ogg`, `audio/wav`, `audio/x-wav`, `audio/aac`,
  `audio/3gpp` ou `audio/3gpp2`.
- Cabeçalho opcional: `X-Voice-Language: pt-BR`.
- Resposta: `{ text, language }`.

O front web pode enviar um `Blob` de `MediaRecorder`; o mobile deve enviar o
arquivo gravado como corpo bruto. Ambos usam exatamente o mesmo contrato.

O áudio não é armazenado em disco, banco ou logs. O buffer só existe durante a
requisição e é limpo depois da chamada ao provedor.

O aplicativo deve limitar a gravação a uma duração curta (por exemplo, 60
segundos), além do limite de 10 MB do servidor. Teste o `Content-Type` emitido
em cada plataforma real antes de publicar.

## Configuração

Copie as variáveis da seção de voz de `.env.example` e configure um endpoint de
transcrição compatível com `multipart/form-data` de `/audio/transcriptions`:

```env
VOICE_TRANSCRIPTION_URL=https://seu-provedor.example/v1/audio/transcriptions
VOICE_TRANSCRIPTION_API_KEY=segredo_apenas_no_backend
VOICE_TRANSCRIPTION_MODEL=whisper-1
VOICE_TRANSCRIPTION_TIMEOUT_MS=20000
VOICE_COMMAND_IDEMPOTENCY_TTL_MS=600000
```

Sem essa configuração, a rota retorna `503` deliberadamente; a chave nunca deve
ficar no aplicativo web ou mobile.

### `POST /api/voice/commands`

Usa o mesmo corpo e os mesmos cabeçalhos de `POST /api/voice/transcriptions`,
mas entrega a transcrição diretamente ao chatbot. Para não colocar contexto de
agendamento nos logs de URL, os metadados opcionais seguem em cabeçalhos:

- `X-Voice-Session-Id`: sessão existente do chatbot.
- `X-Voice-Channel`: origem, por exemplo `voice-web` ou `voice-mobile`.
- `X-Voice-Selected-Time`: horário selecionado no calendário, se houver.
- `X-Voice-Timezone`: fuso do dispositivo, por exemplo `America/Sao_Paulo`.
- `Idempotency-Key`: identificador único por tentativa de comando, de 8 a 128
  caracteres. Repetir a mesma chave para o mesmo usuário devolve a resposta
  anterior sem repetir o fluxo de agendamento; a resposta repetida inclui
  `Idempotency-Replayed: true`.

No MVP, esse reuso é mantido em memória por instância durante 10 minutos. Se a
API for executada com mais de uma réplica, substitua-o por um armazenamento
compartilhado antes de depender da garantia entre instâncias.

Resposta: `{ transcript, session_id, message, state, context, clear_history }`.
É a rota recomendada para o botão de microfone: o aplicativo apenas renderiza a
transcrição e a resposta do chatbot retornadas pelo servidor.

Para o Docker, reconstrua a imagem do `nlp-service` após a primeira inclusão do
modelo de embeddings, pois ele é baixado durante o build e fica em cache na
imagem.

## Ajuste e desempenho semântico

- `SEMANTIC_MIN_SCORE` controla a similaridade mínima (padrão `0.35`) para o
  catálogo e o chatbot.
- `SEMANTIC_SEARCH_RESULT_LIMIT` controla quantos melhores resultados podem ser
  paginados pela rota pública (padrão `200`, máximo `500`).
- `SEMANTIC_EMBEDDING_CACHE_SIZE` mantém embeddings de documentos em memória no
  `nlp-service` (padrão `5000`). Alterar um texto de serviço cria naturalmente
  outra chave de cache.

## Testes de aceite

1. Buscar `montar um guarda-roupa` e validar que serviços de montagem aparecem
   antes de resultados não relacionados.
2. Enviar uma gravação web `audio/webm` e receber o texto transcrito.
3. Enviar o texto retornado ao chatbot e validar o fluxo de agendamento.
4. Falar `cancelar o agendamento 42` e confirmar antes de efetivar o cancelamento.
5. Sem permissão de microfone ou sem transcrição, usar normalmente a entrada de
   texto.
