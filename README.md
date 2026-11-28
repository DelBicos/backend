<p align="center">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="./src/assets/DelBicos_git.png">
      <source media="(prefers-color-scheme: light)" srcset="./src/assets/DelBicos_LogoH.png">
      <img alt="Shows a black logo in light color mode and a white one in dark color mode." src="./src/assets/DelBicos_git.png">
    </picture>
</p>

<p align="center">

[Sobre](#-delbicos-backend) | [Tecnologias](#️-tecnologies) | [Time](#-team) | [Estrutura](#-estrutura) | [Endpoints](#endpoints-usage) | [App](https://github.com/DelBicos/frontend) | [Docs](https://github.com/DelBicos/docs)

</p>

# 💻 DelBicos Backend

API do DelBicos em TypeScript e Express. O app ([DelBicos/frontend](https://github.com/DelBicos/frontend)) não é fronteira de segurança: a regra de negócio fica aqui.

Postgres (Sequelize) guarda usuários, profissionais, serviços, agenda, pagamentos e o restante do negócio. MongoDB guarda só o chat e o log de login. Stripe cobra. Azure Blob Storage guarda imagem pública e documento privado. Um serviço Python (`nlp-service`) classifica a intenção do chatbot (TF-IDF + SVM) e faz a busca semântica. Não é um modelo generativo.

## 🛠️ Tecnologies

![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white) ![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white) ![Javascript](https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black) ![Git](https://img.shields.io/badge/GIT-E44C30?style=for-the-badge&logo=git&logoColor=white) ![Typescript](https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white) ![Swift](https://img.shields.io/badge/swift-F54A2A?style=for-the-badge&logo=swift&logoColor=white) ![Objective-C](https://img.shields.io/badge/OBJECTIVE--C-%233A95E3.svg?style=for-the-badge&logo=apple&logoColor=white) ![Java](https://img.shields.io/badge/java-%23ED8B00.svg?style=for-the-badge&logo=openjdk&logoColor=white) ![Kotlin](https://img.shields.io/badge/Kotlin-0095D5?&style=for-the-badge&logo=kotlin&logoColor=white) ![Express](https://img.shields.io/badge/Express%20js-000000?style=for-the-badge&logo=express&logoColor=white) ![MaterialUI](https://img.shields.io/badge/Material%20UI-007FFF?style=for-the-badge&logo=mui&logoColor=white) ![Node](https://img.shields.io/badge/Node%20js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white) ![Vercel](https://img.shields.io/badge/Vercel-000000?style=for-the-badge&logo=vercel&logoColor=white) ![Postman](https://img.shields.io/badge/Postman-FF6C37?style=for-the-badge&logo=Postman&logoColor=white) ![React](https://img.shields.io/badge/React-20232A?style=for-the-badge&logo=react&logoColor=61DAFB) ![React Native](https://img.shields.io/badge/React_Native-20232A?style=for-the-badge&logo=react&logoColor=61DAFB) ![Zustand](https://img.shields.io/badge/Zustand-007ACC?style=for-the-badge&logo=React&logoColor=white) ![MongoDB](https://img.shields.io/badge/MongoDB-4EA94B?style=for-the-badge&logo=mongodb&logoColor=white) ![Figma](https://img.shields.io/badge/Figma-F24E1E?style=for-the-badge&logo=figma&logoColor=white) ![Penpot](https://img.shields.io/badge/Penpot-000000?style=for-the-badge&logo=penpot&logoColor=white) ![Gimp](https://img.shields.io/badge/gimp-5C5543?style=for-the-badge&logo=gimp&logoColor=white) ![Inkscape](https://img.shields.io/badge/Inkscape-000000?style=for-the-badge&logo=Inkscape&logoColor=white) ![Vscode](https://img.shields.io/badge/Vscode-007ACC?style=for-the-badge&logo=visual-studio-code&logoColor=white) ![Android](https://img.shields.io/badge/Android-3DDC84?style=for-the-badge&logo=android&logoColor=white) ![iOS](https://img.shields.io/badge/iOS-000000?style=for-the-badge&logo=ios&logoColor=white) ![PostgreSQL](https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white) ![Socket.io](https://img.shields.io/badge/Socket.io-010101?style=for-the-badge&logo=socketdotio&logoColor=white) ![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white) ![Python](https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white)

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

## Endpoints Usage

### User Management

#### 1. Log in

- **Endpoint**: `/api/user/login`
- **Method**: `POST`
- **Request Body**:

```json
{
  "email": "johndoe@example.com",
  "password": "password123"
}
```

- **Response**:

```json
{
  "message": "Login realizado com sucesso",
  "token": "<jwt>",
  "user": {
    "id": 1,
    "name": "John Doe",
    "email": "johndoe@example.com",
    "phone": "15999999999",
    "admin": false,
    "professional_id": null
  }
}
```

### User Management

#### 2. Get the logged user

- **Endpoint**: `/api/user/me`
- **Method**: `GET`
- **Header**: `Authorization: Bearer <jwt>`
- **Response**:

```json
{
  "user": {
    "id": 1,
    "name": "John Doe",
    "email": "johndoe@example.com",
    "phone": "15999999999",
    "avatar_uri": null,
    "admin": false,
    "professional_id": null
  }
}
```

### User Management

#### 3. Get a user by ID

- **Endpoint**: `/api/user/:id`
- **Method**: `GET`
- **Header**: `Authorization: Bearer <jwt>`
- **Response**:

```json
{
  "id": 2,
  "name": "Jane Doe",
  "avatar_uri": null
}
```

### User Management

#### 4. Update the logged user

- **Endpoint**: `/api/user/me`
- **Method**: `PUT`
- **Header**: `Authorization: Bearer <jwt>`
- **Request Body**:

```json
{
  "name": "John Smith",
  "phone": "15988888888"
}
```

- **Response**:

```json
{
  "id": 1,
  "name": "John Smith",
  "email": "johndoe@example.com",
  "phone": "15988888888"
}
```
