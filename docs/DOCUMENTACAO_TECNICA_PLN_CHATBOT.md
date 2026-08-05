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

### 9.1.5. Integração com o produto

O chatbot se integra ao produto nas seguintes etapas:

1. o frontend envia a mensagem, o token, a sessão e o fuso horário;
2. o backend carrega a sessão ativa do usuário;
3. regras identificam comandos inequívocos e dados estruturados;
4. mensagens abertas são classificadas pelo serviço Python;
5. a máquina de estados executa a regra correspondente;
6. serviços e disponibilidades reais são consultados no banco;
7. a resposta, o estado e o contexto retornam ao frontend;
8. o React Native renderiza bolhas, cartões, opções e horários;
9. mudanças de aceite e pagamento são enviadas por Socket.IO;
10. polling autenticado funciona como contingência quando o socket falha.

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
  "model_version": "tfidf-word-char-linear-svm-92ebfca4a93f"
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

O conjunto atual possui 270 frases e está balanceado:

| Intenção | Quantidade | Percentual |
| --- | ---: | ---: |
| `SAUDACAO` | 45 | 16,67% |
| `AGENDAR` | 45 | 16,67% |
| `CONSULTAR` | 45 | 16,67% |
| `ALTERAR` | 45 | 16,67% |
| `CANCELAR` | 45 | 16,67% |
| `FALLBACK` | 45 | 16,67% |
| **Total** | **270** | **100%** |

O balanceamento reduz a tendência de o classificador favorecer uma intenção
apenas por ela possuir mais exemplos.

### 9.3.3. Pré-processamento

Cada frase passa pelas seguintes etapas:

1. conversão para letras minúsculas;
2. normalização Unicode NFD;
3. remoção de acentos;
4. remoção de pontuação e caracteres que não sejam letras, números ou espaços;
5. normalização de espaços repetidos;
6. tokenização com `wordpunct_tokenize`;
7. stemming em português com `SnowballStemmer`;
8. preservação de palavras críticas, como `não`, `sim`, `cancelar`, `alterar`,
   `reagendar` e `agendar`.

A preservação desses termos evita que ações distintas fiquem excessivamente
parecidas após o stemming.

### 9.3.4. Separação dos dados

Para avaliação, foi utilizado `train_test_split` com:

```text
test_size = 0.20
random_state = 42
stratify = labels
```

Assim, a avaliação utilizou:

- 216 frases para treinamento da avaliação;
- 54 frases para teste;
- 9 exemplos de teste para cada intenção.

Após calcular as métricas no conjunto separado, o pipeline utilizado pela
aplicação é treinado novamente com as 270 frases. Dessa forma, nenhum exemplo
versionado fica fora do modelo disponibilizado, mas as métricas continuam sendo
calculadas apenas com as 54 frases que não participaram do treino de avaliação.

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
tfidf-word-char-linear-svm-92ebfca4a93f
```

Resultados gerais:

| Métrica | Resultado |
| --- | ---: |
| Acurácia | 0,9074 — 90,74% |
| F1 macro | 0,9062 — 90,62% |
| Amostras de teste | 54 |

Resultados por intenção:

| Intenção | Precisão | Recall | F1-score | Suporte |
| --- | ---: | ---: | ---: | ---: |
| `AGENDAR` | 0,9000 | 1,0000 | 0,9474 | 9 |
| `ALTERAR` | 1,0000 | 0,8889 | 0,9412 | 9 |
| `CANCELAR` | 1,0000 | 1,0000 | 1,0000 | 9 |
| `CONSULTAR` | 0,9000 | 1,0000 | 0,9474 | 9 |
| `FALLBACK` | 0,7778 | 0,7778 | 0,7778 | 9 |
| `SAUDACAO` | 0,8750 | 0,7778 | 0,8235 | 9 |

Os resultados mostram desempenho elevado para ações transacionais. As classes
`FALLBACK` e `SAUDACAO` apresentam maior possibilidade de confusão e devem ser
priorizadas na expansão futura do corpus.

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

Portanto, a acurácia de 90,74% é uma medida do conjunto de teste atual e não uma
garantia de desempenho idêntico em qualquer mensagem futura.

### 9.3.10. Estratégia de evolução

Para evoluir o modelo, recomenda-se:

1. registrar casos de `FALLBACK` sem armazenar dados pessoais;
2. anonimizar qualquer frase originada de uso real;
3. revisar manualmente o rótulo antes de inserir no corpus;
4. manter o mesmo número de exemplos entre as intenções;
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
