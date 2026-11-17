<p align="center">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="./src/assets/DelBicos_git.png">
      <source media="(prefers-color-scheme: light)" srcset="./src/assets/DelBicos_LogoH.png">
      <img alt="Shows a black logo in light color mode and a white one in dark color mode." src="./src/assets/DelBicos_git.png">
    </picture>
</p>

<p align="center">

[Sobre](#-delbicos-backend) | [Arquitetura](#-arquitetura) | [Tecnologias](#️-tecnologies) | [Time](#-time) | [Estrutura](#-estrutura) | [App](https://github.com/fershibli/DelBicosV2) | [Docs](https://github.com/DelBicos/docs)

</p>

# 💻 DelBicos Backend

API do DelBicos em TypeScript e Express. O app ([DelBicosV2](https://github.com/fershibli/DelBicosV2)) não é fronteira de segurança: a regra de negócio fica aqui.

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
| Realtime | Socket.io do chat. |

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
│  ├── routes                 # Um arquivo por domínio
│  ├── controllers            # Funções de endpoint
│  ├── services               # Regra de negócio e integração externa
│  ├── models                 # Sequelize e associações
│  ├── middlewares            # Auth, validação, segurança, erro
│  ├── jobs                   # Crons de agendamento
│  ├── realtime               # Socket.io do chat
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
