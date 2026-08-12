# 9. Processamento de Linguagem Natural (PLN)

## Contextualização

Durante o desenvolvimento da funcionalidade de chatbot do DelBicos, foi
realizado um estudo sobre alternativas de Processamento de Linguagem Natural
aplicáveis ao contexto do projeto. Foram consideradas bibliotecas como NLTK,
spaCy, Scikit-learn, Transformers e Gensim.

Para os requisitos desta etapa, optou-se por uma solução clássica de PLN baseada
em regras e aprendizado supervisionado, sem uso de IA generativa. A abordagem
escolhida combina NLTK para pré-processamento, TF-IDF para representação de texto
e SVM para classificação de intenções. Essa escolha oferece comportamento
previsível, treinamento reprodutível, baixo custo computacional e facilidade de
explicar tecnicamente cada decisão tomada pelo sistema.

O chatbot foi integrado ao sistema existente, construído com backend Node.js e
frontend React Native para web e mobile. O serviço Python atua somente na
classificação da intenção; regras de negócio, respostas, agendamentos,
pagamentos e autorizações permanecem sob responsabilidade do backend.

## 9.1. Funcionalidades de PLN

### 9.1.1. Chatbot de atendimento e agendamento

A funcionalidade de PLN implementada é um chatbot transacional para auxiliar o
cliente durante o uso do DelBicos. O chatbot permite:

- iniciar uma conversa com saudações;
- solicitar um novo agendamento;
- informar o serviço desejado em linguagem natural;
- selecionar um profissional entre as opções encontradas;
- informar datas e horários de diferentes maneiras;
- consultar agendamentos existentes;
- cancelar um agendamento;
- solicitar alteração de data ou horário;
- reiniciar completamente a conversa;
- acompanhar o aceite ou a recusa do profissional;
- receber a informação de pagamento pendente;
- navegar para o checkout e acompanhar a confirmação do pagamento.

O objetivo do PLN não é manter uma conversa aberta sobre qualquer assunto. Ele
interpreta mensagens dentro do domínio de serviços e agendamentos do DelBicos e
encaminha cada solicitação para regras previamente definidas.

### 9.1.2. Classificação de intenções

O classificador identifica seis intenções:

| Intenção | Significado | Exemplos de utilização |
| --- | --- | --- |
| `SAUDACAO` | Início ou cumprimento | “olá”, “boa tarde”, “oi assistente” |
| `AGENDAR` | Solicitação de novo serviço | “quero marcar uma limpeza”, “preciso de um eletricista” |
| `CONSULTAR` | Consulta da agenda do cliente | “mostrar meus agendamentos”, “tenho horário marcado?” |
| `ALTERAR` | Mudança de data ou horário | “quero trocar o horário”, “preciso reagendar” |
| `CANCELAR` | Cancelamento ou desistência | “cancelar meu agendamento”, “quero desmarcar” |
| `FALLBACK` | Mensagem fora do domínio ou com baixa confiança | perguntas sem relação com os serviços disponíveis |

A intenção define qual fluxo da máquina de estados deverá tratar a mensagem. A
SVM não gera textos e não modifica diretamente o banco de dados.

### 9.1.3. Extração de entidades por regras

Além da intenção, o sistema precisa identificar dados presentes na frase. Essa
etapa utiliza regras determinísticas no backend Node.js, porque datas, horários
e identificadores dependem de validações exatas.

As entidades extraídas são:

- nome ou descrição do serviço;
- data;
- horário;
- período do dia;
- identificador do agendamento;
- seleção numérica de uma opção apresentada anteriormente.

Exemplos reconhecidos:

```text
sexta
sexta-feira
sexta que vem
próxima sexta
dia 13
13 de agosto
treze do 09
14:30
14h30
duas da tarde
de manhã
fim da tarde
à noite
```

Também existe interpretação contextual. Se o chatbot apresentar uma lista que
contém “Terça, 18/08” e o usuário responder apenas “terça”, o sistema seleciona
a terça-feira exibida na lista, em vez de calcular outra ocorrência fora do
contexto.

O mesmo princípio é aplicado a horas ambíguas. Uma resposta como “seis horas”
é interpretada como `18:00` quando `06:00` não está na lista apresentada e
`18:00` está. Formatos explícitos e períodos informados pelo usuário são
preservados, evitando transformar “06:00” ou “seis da manhã” em um horário
noturno.

### 9.1.4. Máquina de estados e respostas controladas

O fluxo da conversa é controlado pelos seguintes estados:

```text
INICIO
COLETANDO_SERVICO
COLETANDO_DATA
COLETANDO_HORARIO
CONFIRMACAO
AGUARDANDO_CONFIRMACAO
AGUARDANDO_ID_AGENDAMENTO
FINALIZADO
```

Cada estado valida a entrada esperada e devolve uma resposta previamente
programada. Dessa forma, o chatbot não inventa informações, profissionais,
preços, horários ou agendamentos.

Respostas curtas também são interpretadas pelo estado e pelo contexto. Depois
de uma consulta sem resultados, o backend registra que aguarda a confirmação da
oferta “Deseja agendar um serviço?”. Nesse ponto, respostas afirmativas como
“sim”, “claro”, “quero” ou “vamos” iniciam a coleta do serviço; respostas
negativas limpam a oferta pendente e retornam ao menu.

### 9.1.5. Integração com o produto

O chatbot se integra ao produto nas seguintes etapas:

1. o frontend envia a mensagem, o token, a sessão e o fuso horário;
2. o backend carrega a sessão ativa do usuário;
3. regras separam comandos globais e dados estruturados do estado atual;
4. as demais mensagens textuais de intenção são classificadas pelo serviço Python;
5. regras explícitas validam ou corrigem comandos inequívocos após a classificação;
6. a máquina de estados executa a regra correspondente;
7. serviços e disponibilidades reais são consultados no banco;
8. a resposta, o estado e o contexto retornam ao frontend;
9. o React Native renderiza bolhas, cartões, opções e horários;
10. mudanças de aceite e pagamento são enviadas por Socket.IO;
11. polling autenticado funciona como contingência quando o socket falha.

O mesmo contrato é utilizado no navegador e no aplicativo mobile.

### 9.1.6. Limites funcionais

Não fazem parte desta implementação:

- reconhecimento ou síntese de voz;
- busca semântica com embeddings;
- geração automática de respostas;
- modelos de linguagem como GPT ou BERT;
- aprendizado automático com mensagens de produção;
- execução de ações sem validação das regras do backend.

## 9.2. Tecnologias e Modelos

### 9.2.1. Tecnologias principais de PLN

| Tecnologia | Utilização no projeto |
| --- | --- |
| Python 3.12 | Ambiente do serviço interno de classificação. |
| NLTK | Tokenização e stemming com `SnowballStemmer` para português. |
| Scikit-learn | Implementação de `TfidfVectorizer`, `FeatureUnion`, pipeline, métricas e `LinearSVC`. |
| TF-IDF | Conversão das frases em vetores numéricos ponderados pela importância dos termos. |
| SVM/`LinearSVC` | Classificação supervisionada das intenções. |
| Joblib | Serialização e carregamento do pipeline treinado. |
| FastAPI | API interna do classificador. |
| Uvicorn | Servidor HTTP do serviço FastAPI. |
| Pytest | Testes do pré-processamento e da classificação. |

### 9.2.2. Tecnologias de integração

| Tecnologia | Utilização |
| --- | --- |
| Node.js + TypeScript | Orquestração, regras, entidades e estados da conversa. |
| Express | Endpoints autenticados do chatbot. |
| Sequelize + PostgreSQL | Persistência de sessões, mensagens e agendamentos. |
| Socket.IO | Atualização de aceite e pagamento em tempo real. |
| React Native | Interface compartilhada entre web e mobile. |
| Zustand + AsyncStorage | Estado do chatbot e persistência mínima do `sessionId`. |
| Docker Compose | Execução local do backend, bancos e classificador Python. |

### Técnicas linguísticas não utilizadas

O classificador atual **não utiliza POS Tagging**, pois a classe gramatical de
cada token não é necessária para distinguir as intenções previstas. Também
**não utiliza NER estatístico**: serviço, profissional, data, horário e ID são
extraídos por expressões regulares, parsers e regras do domínio no backend
Node.js. Essa extração determinística de entidades não deve ser descrita como
NER.

O projeto **não utiliza lematização**. A redução morfológica adotada é o stemming
em português com `SnowballStemmer`, que produz radicais e não necessariamente
lemas existentes no dicionário. Também não ocorre remoção geral de stopwords;
isso preserva palavras relevantes em mensagens curtas, especialmente negações,
enquanto o TF-IDF reduz naturalmente o peso dos termos muito frequentes.

### 9.2.3. Representação com TF-IDF

O pipeline utiliza duas representações complementares:

1. **TF-IDF de palavras:** unigramas e bigramas (`ngram_range=(1, 2)`),
   processados pelo tokenizador NLTK;
2. **TF-IDF de caracteres:** n-gramas de 3 a 5 caracteres com
   `analyzer="char_wb"`.

Os dois vetores são combinados com `FeatureUnion`.

Os n-gramas de palavras capturam expressões como “quero cancelar” ou “meus
agendamentos”. Os n-gramas de caracteres aumentam a tolerância a flexões,
abreviações e pequenas variações de digitação, como “cancelo/cancelar”.

Ambos utilizam `sublinear_tf=True`, reduzindo o impacto de repetições muito
frequentes de um termo.

### 9.2.4. Modelo SVM

O classificador utilizado é uma SVM linear:

```text
LinearSVC(
    C=1.0,
    class_weight="balanced",
    random_state=42
)
```

A escolha do `LinearSVC` foi adequada porque:

- textos vetorizados com TF-IDF produzem matrizes esparsas;
- o conjunto possui poucas classes bem definidas;
- o treinamento e a inferência são rápidos;
- o modelo possui baixo custo computacional;
- as decisões podem ser avaliadas pela margem entre as classes.

Não foi utilizado modelo pré-treinado. O modelo é treinado especificamente com o
corpus do domínio DelBicos.

### 9.2.5. Confiança e fallback

O `LinearSVC` não retorna probabilidades diretamente. O sistema calcula a
diferença entre o score da classe vencedora e o score da segunda colocada. Essa
margem é normalizada para o intervalo de 0 a 1 com uma função sigmoide.

```text
confiança = 1 / (1 + exp(-margem))
```

Se a confiança for inferior a `0,65`, o resultado é alterado para `FALLBACK`.
Esse valor pode ser configurado por `NLU_CONFIDENCE_THRESHOLD`.

Essa confiança representa uma normalização da margem da SVM, e não uma
probabilidade estatística calibrada.

### 9.2.6. API do classificador

O serviço Python disponibiliza apenas a rede interna do Docker:

```http
GET /health
POST /classify
```

Entrada:

```json
{ "text": "quero contratar alguém para pintar minha casa" }
```

Saída:

```json
{
  "intent": "AGENDAR",
  "confidence": 0.91,
  "model_version": "tfidf-word-char-linear-svm-3a39e63a5f3f"
}
```

O serviço não recebe JWT, não acessa banco e não executa agendamentos.

## 9.3. Dataset e Treinamento

### 9.3.1. Origem do dataset

Foi criado um corpus próprio e versionado para o domínio do DelBicos, localizado
em:

```text
nlp-service/data/intents.json
```

As frases foram elaboradas manualmente a partir das formas esperadas de
comunicação entre clientes e a plataforma. Foram incluídas frases completas,
comandos curtos, variações coloquiais e diferentes construções em português.

O corpus não foi extraído de conversas privadas e não contém nomes, documentos,
endereços, telefones ou outros dados pessoais reais.

### 9.3.2. Tamanho e distribuição

O conjunto atual possui 285 frases. A intenção `CONSULTAR` recebeu 15 exemplos
adicionais para representar perguntas naturais que antes podiam cair em
`FALLBACK`, como “como vejo os horários que marquei”:

| Intenção | Quantidade | Percentual |
| --- | ---: | ---: |
| `SAUDACAO` | 45 | 15,79% |
| `AGENDAR` | 45 | 15,79% |
| `CONSULTAR` | 60 | 21,05% |
| `ALTERAR` | 45 | 15,79% |
| `CANCELAR` | 45 | 15,79% |
| `FALLBACK` | 45 | 15,79% |
| **Total** | **285** | **100%** |

A diferença é moderada e o `LinearSVC` utiliza `class_weight="balanced"` para
compensar o número de exemplos por classe durante o treinamento. A expansão foi
mantida porque representa variações reais e relevantes da intenção de consulta.

### 9.3.3. Pré-processamento

Cada frase passa pelas seguintes etapas:

1. remoção integral de URLs iniciadas por `http://`, `https://` ou `www.`;
2. remoção integral de menções no formato `@usuario`;
3. conversão para letras minúsculas;
4. normalização Unicode NFD;
5. remoção de acentos;
6. remoção de emojis, pontuação e demais caracteres que não sejam letras,
   números ou espaços;
7. normalização de espaços repetidos;
8. tokenização com `wordpunct_tokenize`;
9. stemming em português com `SnowballStemmer`;
10. preservação de palavras críticas, como `não`, `sim`, `cancelar`, `alterar`,
   `reagendar` e `agendar`.

A preservação desses termos evita que ações distintas fiquem excessivamente
parecidas após o stemming. Os testes automatizados cobrem acentos, espaços
excedentes, emojis, URLs com protocolo, URLs iniciadas por `www.`, menções
simples e menções com sublinhado.

### 9.3.4. Separação dos dados

Para avaliação, foi utilizado `train_test_split` com:

```text
test_size = 0.20
random_state = 42
stratify = labels
```

Assim, a avaliação utilizou:

- 228 frases para treinamento da avaliação;
- 57 frases para teste;
- 12 exemplos de teste para `CONSULTAR` e 9 para cada uma das demais intenções.

Após calcular as métricas no conjunto separado, o pipeline utilizado pela
aplicação é treinado novamente com as 285 frases. Dessa forma, nenhum exemplo
versionado fica fora do modelo disponibilizado, mas as métricas continuam sendo
calculadas apenas com as 57 frases que não participaram do treino de avaliação.

### 9.3.5. Estratégia de treinamento

O treinamento executa:

1. validação da estrutura do JSON;
2. verificação de pelo menos duas classes e seis frases por classe;
3. divisão estratificada;
4. criação dos dois vetorizadores TF-IDF;
5. união dos vetores;
6. treinamento do `LinearSVC` no conjunto de treino;
7. predição do conjunto de teste;
8. cálculo de acurácia, precisão, recall e F1-score;
9. novo treinamento com todo o corpus;
10. gravação do modelo e das métricas.

O hash SHA-256 do corpus faz parte da versão do modelo. Uma alteração nas frases
gera outra identificação, permitindo rastrear qual corpus produziu o artefato.

### 9.3.6. Métricas utilizadas

As principais métricas são:

- **Acurácia:** proporção total de classificações corretas;
- **Precisão:** entre as mensagens atribuídas a uma intenção, quantas estavam
  corretas;
- **Recall:** entre as mensagens reais de uma intenção, quantas foram
  encontradas;
- **F1-score:** média harmônica entre precisão e recall;
- **F1 macro:** média do F1 de todas as classes com o mesmo peso.

O F1 macro foi selecionado como métrica principal junto com a acurácia, porque
permite acompanhar o comportamento de todas as intenções sem favorecer uma
classe específica.

### 9.3.7. Resultado da avaliação atual

Modelo avaliado:

```text
tfidf-word-char-linear-svm-3a39e63a5f3f
```

Resultados gerais:

| Métrica | Resultado |
| --- | ---: |
| Acurácia | 0,9825 — 98,25% |
| F1 macro | 0,9835 — 98,35% |
| Amostras de teste | 57 |

Resultados por intenção:

| Intenção | Precisão | Recall | F1-score | Suporte |
| --- | ---: | ---: | ---: | ---: |
| `AGENDAR` | 1,0000 | 1,0000 | 1,0000 | 9 |
| `ALTERAR` | 1,0000 | 0,8889 | 0,9412 | 9 |
| `CANCELAR` | 1,0000 | 1,0000 | 1,0000 | 9 |
| `CONSULTAR` | 0,9231 | 1,0000 | 0,9600 | 12 |
| `FALLBACK` | 1,0000 | 1,0000 | 1,0000 | 9 |
| `SAUDACAO` | 1,0000 | 1,0000 | 1,0000 | 9 |

Os resultados mostram desempenho elevado no conjunto de teste atual. A única
confusão registrada envolveu uma frase atribuída a `CONSULTAR`; por isso, novas
variações devem continuar sendo avaliadas com mensagens que não estejam no
corpus de treinamento.

### 9.3.8. Reprodutibilidade

O treinamento é executado durante a construção da imagem:

```bash
python -m app.train \
  --data /app/data/intents.json \
  --artifact-dir /app/artifacts
```

São produzidos:

```text
intent_classifier.joblib
metrics.json
```

Depois do treinamento, `pytest` é executado. A imagem só é concluída se treino e
testes terminarem corretamente.

### 9.3.9. Limitações da avaliação

O resultado deve ser interpretado considerando que:

- o corpus é pequeno e específico do domínio;
- as frases foram elaboradas pelo próprio grupo;
- foi utilizado um único holdout estratificado com seed fixa;
- as métricas ainda não representam usuários reais em produção;
- não foi aplicada validação cruzada nesta versão;
- linguagem regional, novos erros de digitação e gírias podem exigir expansão.

Portanto, a acurácia de 98,25% é uma medida do conjunto de teste atual e não uma
garantia de desempenho idêntico em qualquer mensagem futura.

### 9.3.10. Estratégia de evolução

Para evoluir o modelo, recomenda-se:

1. registrar casos de `FALLBACK` sem armazenar dados pessoais;
2. anonimizar qualquer frase originada de uso real;
3. revisar manualmente o rótulo antes de inserir no corpus;
4. monitorar a distribuição das classes e compensar eventuais diferenças;
5. separar um conjunto de teste que não seja usado na criação das frases;
6. aplicar validação cruzada estratificada;
7. acompanhar matriz de confusão e F1 por classe;
8. executar testes de regressão para comandos críticos;
9. versionar corpus e métricas junto com o código;
10. ajustar o limiar somente com base em avaliação controlada.

## Conclusão da seção

A solução atende ao requisito de implementar um chatbot baseado em regras com
classificação de intenções por TF-IDF e SVM. O serviço Python é pequeno,
reprodutível e isolado, enquanto o backend mantém controle das regras e o
frontend reutiliza os componentes React Native existentes.

Essa separação reduz o risco de respostas não autorizadas, facilita testes e
permite explicar de maneira objetiva como uma mensagem é transformada em uma
intenção e, posteriormente, em uma ação válida no DelBicos.

## Arquivos de referência

- `nlp-service/data/intents.json` — dataset;
- `nlp-service/app/preprocess.py` — normalização e tokenização;
- `nlp-service/app/train.py` — TF-IDF, SVM e avaliação;
- `nlp-service/app/model.py` — inferência e confiança;
- `nlp-service/app/main.py` — API interna;
- `src/services/nlu.service.ts` — integração e extração de entidades;
- `src/services/bot/` — máquina de estados;
- `docs/CHATBOT_FLUXO_COMPLETO.md` — fluxo ponta a ponta;
- `docs/CHATBOT_INVENTARIO_BACKEND.md` — inventário do backend;
- `DelBicosV2/docs/CHATBOT_INVENTARIO_FRONTEND.md` — inventário do frontend.
