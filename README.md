<p align="center">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="./src/assets/DelBicos_git.png">
      <source media="(prefers-color-scheme: light)" srcset="./src/assets/DelBicos_LogoH.png">
      <img alt="Shows a black logo in light color mode and a white one in dark color mode." src="./src/assets/DelBicos_git.png">
    </picture>
</p>

<p align="center">

[Sobre](#-delbicos-backend) | [Arquitetura](#-arquitetura) | [Tecnologias](#️-tecnologies) | [Time](#-time) | [Estrutura](#-estrutura) | [Instalação](#️-instalação) | [Execução](#-execução) | [Testes](#-testes) | [App](https://github.com/DelBicos/frontend) | [Docs](https://github.com/DelBicos/docs)

</p>

# 💻 DelBicos Backend

API do DelBicos em TypeScript e Express. O app ([DelBicos/frontend](https://github.com/DelBicos/frontend)) não é fronteira de segurança: a regra de negócio fica aqui.

Postgres (Sequelize) guarda usuários, profissionais, serviços, agenda, pagamentos e o restante do negócio. MongoDB guarda só o chat e o log de login. Stripe cobra. Azure Blob Storage guarda imagem pública e documento privado. Um serviço Python (`nlp-service`) classifica a intenção do chatbot (TF-IDF + SVM) e faz a busca semântica. Não é um modelo generativo.

## 🏗️ Arquitetura

`server.ts` sobe o processo: ambiente, os dois bancos, os crons de agendamento e o HTTP na porta `3000` (ou `PORT`). O Socket.io do chat usa esse mesmo servidor. Com `IS_SERVERLESS=true` o processo não escuta porta.

`src/app.ts` monta o Express: Helmet, limite de corpo, rate limit, CORS, sanitização, o Swagger em `/docs` e um grupo de rotas por domínio.

| Camada | Responsabilidade |
| --- | --- |
| Rotas | Ligam o endpoint aos middlewares e a uma função de controller. Sem regra de negócio no arquivo de rota. |
| Controllers | Funções exportadas, não classes. CRUD simples fala com o model direto. |
| Services | Regra de negócio, transação em mais de uma tabela, ou integração externa (pagamento, e-mail, storage, voz, NLP). Arquivo em `.service.ts`. |
| Models | Forma, tipo e restrição de campo. Mudança de schema sai com migration reversível. |
| Jobs | Cron de agendamento e aviso de uma hora antes do atendimento. |
| Realtime | Socket.io do chat e do rastreamento de localização em tempo real. |

Um service que só repassa a chamada para o model não tem função. Repositório ou caso de uso obrigatório não fazem parte desta API. O porquê de cada regra está em [docs/architecture.md](docs/architecture.md).

Grupos montados em `src/app.ts`:

| Prefixo | Domínio |
| --- | --- |
| `/api/user` | Conta e login de usuário |
| `/auth` | Cadastro e verificação, com limite próprio de taxa |
| `/api/admin` | Login e operações de administrador |
| `/api/professionals` | Perfil e busca de profissionais |
| `/api/services` | Serviços oferecidos |
| `/api/categories` · `/api/subcategories` | Catálogo |
| `/api/appointments` | Agendamentos |
| `/api/availabilities` · `/api/availability-locks` | Agenda e bloqueio de horário |
| `/api/payments` | Stripe |
| `/api/chat` | Conversa entre cliente e profissional |
| `/api/voice` | Transcrição e comando de voz |
| `/api/address` | Endereços |
| `/api/notifications` | Notificações |
| `/api/favorites` | Favoritos |
| `/api/dashboard` | Painel |
| `/api/tickets` | Central de chamados |
| `/api/verification` | Verificação de identidade |
| `/api/avatar` · `/api/uploads` · `/api/proxy-upload` | Arquivos |
| `/api/utilities` | E-mail |

A referência campo a campo é o Swagger em `/docs`, gerado a partir de `src/docs`.

## 🛠️ Tecnologies

Node 20 ou superior (o CI usa 20; o `.nvmrc` pede 24.10.0). TypeScript, Express, Sequelize, PostgreSQL, Mongoose, Socket.io, Stripe, Azure Blob Storage, Jest e Docker. O classificador fica em Python.

![TypeScript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white) ![Node](https://img.shields.io/badge/Node%20js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white) ![Express](https://img.shields.io/badge/Express%20js-000000?style=for-the-badge&logo=express&logoColor=white) ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white) ![MongoDB](https://img.shields.io/badge/MongoDB-4EA94B?style=for-the-badge&logo=mongodb&logoColor=white) ![Socket.io](https://img.shields.io/badge/Socket.io-010101?style=for-the-badge&logo=socketdotio&logoColor=white) ![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white) ![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)

<br>

## 👥 Team

|                        Nome                        | Função                                 |
| :------------------------------------------------: | -------------------------------------- |
|  [Fernando Chibli](https://github.com/fershibli)   | _CTO e Desenvolvedor FullStack_        |
| [Douglas Wenzel](https://github.com/douglaswenzel) | _Scrum Master e Desenvolvedor FullStack_ |
|   [Isabel Maito](https://github.com/isabelmaito)   | _Designer e Desenvolvedora FullStack_  |

## 📝 Estrutura

```
DelBicosBackend
├── server.ts                 # Ambiente, bancos, crons e HTTP + Socket.io
├── src
│  ├── app.ts                 # Express, middlewares e grupos de rota
│  ├── assets                 # Logos do README
│  ├── routes                 # Um arquivo por domínio
│  ├── controllers            # Funções de endpoint
│  ├── services               # Regra de negócio e integração externa
│  ├── models                 # Sequelize e associações
│  ├── middlewares            # Auth, validação, segurança, erro
│  ├── jobs                   # Crons de agendamento
│  ├── realtime               # Socket.io: chat e rastreamento de localização
│  ├── config                 # Banco, ambiente, Stripe, Swagger, e-mail
│  ├── docs                   # Comentários OpenAPI
│  ├── constants
│  ├── errors
│  ├── interfaces
│  ├── templates              # Corpo de e-mail
│  ├── types
│  └── utils
├── migrations                # Sequelize. Toda mudança de schema
├── seeders
├── nlp-service               # Classificador Python
├── docker-compose.yml        # Postgres, Mongo, NLP e a API
├── docker-compose.test.yml   # Postgres descartável dos testes
├── docs                      # Arquitetura e requisitos
└── .env.example
```

As pastas de `src/` acima são a lista fechada. Pasta nova é decisão de arquitetura, não de uma feature.

## ⚙️ Instalação

Node 20 ou superior e npm. O lockfile é o `package-lock.json`.

```bash
git clone https://github.com/DelBicos/backend.git
cd backend
npm install
cp .env.example .env
```

O servidor não sobe sem `SECRET_KEY` (32 caracteres ou mais; `openssl rand -hex 32`). Trocar a chave desloga todo mundo. O `.env.example` agrupa o restante: SMTP, Stripe, Postgres, Mongo do chat, Azure Blob, o classificador (`NLU_SERVICE_URL` e `NLU_SERVICE_API_KEY`) e a transcrição de voz. Não commite o `.env`.

Postgres local, se for rodar fora do Docker: banco `delbicos`, usuário `delbicos`, porta `5432`. Esses são os valores padrão do `docker-compose.yml` e do exemplo.

```bash
npm run migrate:db:create   # cria o banco, se o papel do Postgres puder
npm run migrate             # aplica as migrations
npm run seed                # dados iniciais
```

| Script | O que faz |
| --- | --- |
| `npm run migrate:new -- nome` | Gera uma migration |
| `npm run migrate:undo` | Desfaz a última |
| `npm run migrate:undo:all` | Desfaz todas |
| `npm run migrate:reset` | Desfaz todas e aplica de novo |
| `npm run seed:undo` | Desfaz o último seed |
| `npm run seed:reset` | Desfaz os seeds e roda de novo |
| `npm run audit:catalog` | Confere o catálogo de serviços |

## Execução

### Na máquina

Com Postgres e Mongo no ar, e o `.env` apontando para eles:

```bash
npm run dev
```

Isso roda `ts-node-dev` em `server.ts`, com reload. A API escuta a porta `3000`, ou o valor de `PORT`. Swagger em [http://localhost:3000/docs](http://localhost:3000/docs).

Para o processo compilado:

```bash
npm run build
npm start
```

`npm run build` gera `dist/` com `tsc`. `npm start` executa `node dist/server.js`.

### Docker

O Compose usa a rede externa `delbicos-shared-network`, a mesma do app. Crie uma vez:

```bash
npm run docker:network
```

Sobe Postgres, Mongo, o classificador Python e a API. Dentro do container o host do Postgres é `postgres` e o do Mongo é `mongo`, independente do que estiver no `.env` da máquina. O NLP local fica em `http://nlu-service:8000`.

```bash
npm run docker:up
npm run docker:migrate
npm run docker:seed
```

`npm run docker:dev` sobe os serviços e acompanha o log da API.

| Script | O que faz |
| --- | --- |
| `npm run docker:build` | Monta as imagens |
| `npm run docker:up` | Sobe em segundo plano |
| `npm run docker:dev` | Sobe e segue o log de `delbicos-server` |
| `npm run docker:logs` | Logs de todos os serviços |
| `npm run docker:exec` | Shell no container da API |
| `npm run docker:restart` | Reinicia os serviços |
| `npm run docker:restart:postgres` | Reinicia só o Postgres |
| `npm run docker:down` | Derruba os containers |
| `npm run docker:migrate` | `npm run migrate` dentro da API |
| `npm run docker:seed` | `npm run seed` dentro da API |
| `npm run docker:copy:env` | Copia o `.env` para o container |
| `npm run docker:rebuild` | Derruba, monta sem cache e sobe |
| `npm run docker:clean` | Derruba e apaga volumes |
| `npm run docker:clean:images` | Derruba e poda imagens soltas |
| `npm run docker:clean:all` | Derruba, apaga volumes e poda imagens e volumes do Docker |

O Azurite (emulador do Blob Storage) não sobe no `docker:up`. Para usá-lo: `docker compose --profile storage up -d azurite` e `AZURE_STORAGE_CONNECTION_STRING=UseDevelopmentStorage=true`.

## Testes

`npm run lint` é o `tsc --noEmit`. Não há um script separado de ESLint.

| Script | O que faz |
| --- | --- |
| `npm test` | Jest |
| `npm run test:unit` | Só o projeto `unit`, sem cobertura |
| `npm run test:integration` | Só o projeto `integration`. Precisa do Postgres de teste |
| `npm run test:all` | Os dois projetos, sem cobertura |
| `npm run test:coverage` | Jest com cobertura |
| `npm run test:db:up` | Sobe o Postgres descartável na porta `5433` |
| `npm run test:db:migrate` | Aplica as migrations nesse banco |
| `npm run test:db:logs` | Log do Postgres de teste |
| `npm run test:db:down` | Derruba e apaga o volume de teste |

Integração:

```bash
npm run test:db:up
npm run test:db:migrate
npm run test:integration
npm run test:db:down
```

O banco de teste usa `PR2_TEST_DATABASE_URL` (`postgresql://delbicos_test:test123@localhost:5433/pr2_test`), o mesmo usuário e senha do `docker-compose.test.yml`.

## Documentação

| Documento | Assunto |
| --- | --- |
| [docs/architecture.md](docs/architecture.md) | Por que cada camada existe |
| [docs/README.md](docs/README.md) | Índice: chatbot, NLP, voz, RF03, RF04 |
| [App](https://github.com/DelBicos/frontend) | Cliente Expo |
| [Docs do produto](https://github.com/DelBicos/docs) | Entregas por semestre |
