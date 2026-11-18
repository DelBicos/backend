📋 Relatório Completo — DelBicos V2 (Back-End)
Projeto acadêmico — Delivery de "bicos" (serviços temporários) | Versão: 5.4.0 | Framework: Express.js + TypeScript

## 1. Visão Geral
O DelBicos é um backend RESTful de marketplace de serviços temporários. Gerencia autenticação de usuários, perfis de profissionais, agendamentos, pagamentos, notificações e análises de dashboard.

| Aspecto | Detalhe |
|---------|---------|
| **Plataforma** | API REST / Vercel Serverless |
| **Linguagem** | TypeScript (strict mode) |
| **Framework** | Express.js 4.21 |
| **ORM** | Sequelize 6.6 + Mongoose 8.14 |
| **Banco de Dados Relacional** | PostgreSQL / MySQL |
| **Banco de Dados NoSQL** | MongoDB (notificações) |
| **Autenticação** | JWT (jsonwebtoken) |
| **Pagamentos** | Stripe (stripe v19.1) |
| **Email** | SendGrid (@sendgrid/mail 8.1) |
| **Notificações Push** | Expo (expo-server-sdk 4.0) |
| **Logging** | Winston 3.18 + Logtail |
| **Documentação API** | Swagger/OpenAPI (swagger-jsdoc 6.2) |
| **Deploy** | Docker + Vercel Serverless |
| **Testing** | Jest 30.2 + Supertest |
| **CI/DevOps** | Docker Compose, Node.js 18+ |

---

## 2. Estrutura de Pastas

```
DelBicosBackend/
├── src/
│   ├── config/                # Configurações
│   │   ├── database.ts        # Conexão Sequelize (PostgreSQL/MySQL)
│   │   ├── sendgrid.ts        # Configuração SendGrid
│   │   └── swagger.ts         # Configuração OpenAPI/Swagger
│   │
│   ├── controllers/           # Controladores (Lógica de requisição/resposta)
│   │   ├── address.controller.ts
│   │   ├── admin.controller.ts
│   │   ├── appointment.controller.ts
│   │   ├── auth.controller.ts
│   │   ├── avatar.controller.ts
│   │   ├── category.controller.ts
│   │   ├── dashboard.controller.ts
│   │   ├── favorite.controller.ts
│   │   ├── notification.controller.ts
│   │   ├── payment.controller.ts
│   │   ├── professional.controller.ts
│   │   ├── subCategory.controller.ts
│   │   └── user.controller.ts
│   │
│   ├── services/              # Serviços (Lógica de negócio)
│   │   ├── email.service.ts   # Envio de e-mails transacionais
│   │   ├── payment.service.ts # Processamento de pagamentos
│   │   └── __tests__/
│   │
│   ├── models/                # Modelos de dados (Sequelize)
│   │   ├── User.ts
│   │   ├── Client.ts
│   │   ├── Professional.ts
│   │   ├── Address.ts
│   │   ├── Category.ts
│   │   ├── Subcategory.ts
│   │   ├── Service.ts
│   │   ├── Appointment.ts
│   │   ├── ProfessionalAvailability.ts
│   │   ├── ProfessionalAvailabilityLock.ts
│   │   ├── ProfessionalGallery.ts
│   │   ├── ProfessionalAmenities.ts
│   │   ├── Amenities.ts
│   │   ├── Favorite.ts
│   │   ├── Admin.ts
│   │   ├── AdminServiceOrder.ts
│   │   ├── Notification.ts
│   │   ├── UserToken.ts
│   │   ├── associations.ts    # Relacionamentos entre modelos
│   │   └── index.js
│   │
│   ├── routes/                # Definição de rotas/endpoints
│   │   ├── address.routes.ts
│   │   ├── admin.routes.ts
│   │   ├── appointment.routes.ts
│   │   ├── auth.routes.ts
│   │   ├── category.routes.ts
│   │   ├── dashboard.routes.ts
│   │   ├── favorite.routes.ts
│   │   ├── notification.routes.ts
│   │   ├── payment.routes.ts
│   │   ├── professional.routes.ts
│   │   ├── subcategory.routes.ts
│   │   └── user.routes.ts
│   │
│   ├── middlewares/           # Middlewares
│   │   ├── auth.middleware.ts        # Validação JWT
│   │   ├── admin.middleware.ts       # Autorização admin
│   │   ├── cors.middleware.ts        # CORS
│   │   └── logging.middleware.ts     # Logging de requisições
│   │
│   ├── interfaces/            # Tipagem TypeScript
│   │   ├── authentication.interface.ts
│   │   └── index.ts
│   │
│   ├── utils/                 # Utilitários
│   │   ├── authUtils.ts              # Geração de tokens JWT
│   │   ├── logger.ts                 # Sistema de logging
│   │   └── verification.ts           # Verificação de e-mail
│   │
│   └── assets/                # Bucket de avatares
│
├── migrations/                # Migrations (Sequelize)
│   ├── 001-create-users.js
│   ├── 002-create-address.js
│   ├── 003-create-admin.js
│   ├── 004-create-client.js
│   ├── 005-create-professional.js
│   ├── 006-create-category.js
│   ├── 007-create-subcategory.js
│   ├── 008-create-service.js
│   ├── 009-create-appointment.js
│   ├── 010-create-professional-availability.js
│   ├── 011-create-professional-availability-lock.js
│   ├── 012-create-amenities.js
│   ├── 013-create-professional-amenities.js
│   ├── 014-create-professional-gallery.js
│   ├── 015-create-notifications.js
│   ├── 016-create-admin-service-order.js
│   ├── 017-create-favorites.js
│   └── 20251109120000-add-completed-finalprice-appointment.js
│
├── seeders/                   # Seeds (Dados iniciais)
│   ├── 001-initial-category.js
│   ├── 002-initial-users.js
│   ├── 003-initial-address.js
│   ├── 004-initial-client.js
│   ├── 005-initial-professionals.js
│   ├── 006-initial-reformas-subcategories.js
│   ├── 007-initial-reformas-services.js
│   ├── 008-initial-appointments.js
│   ├── 009-demo-professionals-reviews.js
│   ├── 010-demo-professional-services.js
│   ├── 011-initial-amenities.js
│   ├── 012-initial-availabilities.js
│   ├── 013-initial-admin.js
│   └── 014-welcome-notifications.js
│
├── tests/                     # Testes
│   └── integration/
│
├── avatarBucket/              # Armazenamento local de avatares
├── coverage/                  # Cobertura de testes (Jest)
├── reports/                   # Relatórios de CI/CD
│
├── server.ts                  # 🟢 Entrada principal da aplicação
├── .env                       # Variáveis de ambiente
├── app.json                   # Configuração Expo (se aplicável)
├── docker-compose.yml         # Orquestração de containers
├── Dockerfile                 # Imagem Docker
├── jest.config.js             # Configuração Jest
├── package.json               # Dependências e scripts
├── tsconfig.json              # Configuração TypeScript
├── tsconfig.build.json        # Configuração TypeScript para build
├── CREATE_DATABASE.sql        # Script de criação de BD
└── README.md                  # Documentação do projeto
```

---

## 3. Modelos de Dados (Schema)

### 3.1 User (Usuário Base)
```typescript
interface IUser {
  id: number (PK)
  name: string
  email: string (UNIQUE)
  phone: string (UNIQUE, 13 chars)
  password: string (bcrypt)
  active: boolean (default: true)
  avatar_uri?: string
  banner_uri?: string
  createdAt: Date
  updatedAt: Date
}
```
**Índices:** `active_index_users(active)`

### 3.2 Client (Cliente/Comprador)
```typescript
interface IClient {
  id: number (PK)
  user_id: number (FK → User)
  main_address_id?: number (FK → Address)
  cpf: string (UNIQUE, 14 chars)
  createdAt: Date
  updatedAt: Date
}
```

### 3.3 Professional (Profissional/Prestador)
```typescript
interface IProfessional {
  id: number (PK)
  user_id: number (FK → User)
  main_address_id?: number (FK → Address)
  cpf: string (UNIQUE, 14 chars)
  cnpj?: string (UNIQUE, 18 chars)
  description?: string (max 1500)
  createdAt: Date
  updatedAt: Date
}
```

### 3.4 Address (Endereço)
```typescript
interface IAddress {
  id: number (PK)
  user_id: number (FK → User)
  street: string
  number: string
  complement?: string
  neighborhood: string
  city: string
  state: string
  postal_code: string
  lat: number (latitude)
  lng: number (longitude)
  createdAt: Date
  updatedAt: Date
}
```

### 3.5 Category (Categoria de Serviço)
```typescript
interface ICategory {
  id: number (PK)
  title: string
  description?: string
  active: boolean (default: true)
  createdAt: Date
  updatedAt: Date
}
```
**Índices:** `active_index_category(active)`

### 3.6 Subcategory (Subcategoria)
```typescript
interface ISubcategory {
  id: number (PK)
  title: string
  description?: string
  category_id: number (FK → Category)
  active: boolean (default: true)
  createdAt: Date
  updatedAt: Date
}
```

### 3.7 Service (Serviço do Profissional)
```typescript
interface IService {
  id: number (PK)
  title: string
  description?: string
  price: number (decimal 10.2)
  duration: number (minutos)
  banner_uri?: string
  active: boolean (default: true)
  subcategory_id: number (FK → Subcategory)
  professional_id: number (FK → Professional)
  createdAt: Date
  updatedAt: Date
}
```
**Índices:** `active_index_service(active)`

### 3.8 Appointment (Agendamento)
```typescript
interface IAppointment {
  id: number (PK)
  professional_id: number (FK → Professional)
  client_id: number (FK → Client)
  service_id: number (FK → Service)
  address_id: number (FK → Address)
  start_time: Date
  end_time: Date
  completed_at?: Date
  final_price?: number
  status: enum['pending', 'confirmed', 'completed', 'canceled']
  rating?: number (1-5)
  review?: string (max 1000)
  payment_intent_id?: string (Stripe Payment Intent)
  createdAt: Date
  updatedAt: Date
}
```
**Índices:** `idx_appointment_times(professional_id, start_time, end_time)`, `idx_status_check(status, start_time)`

### 3.9 ProfessionalAvailability (Disponibilidade)
```typescript
interface IProfessionalAvailability {
  id: number (PK)
  professional_id: number (FK → Professional)
  day_of_week: number (0-6)
  start_time: string (HH:MM:SS)
  end_time: string (HH:MM:SS)
  createdAt: Date
  updatedAt: Date
}
```

### 3.10 ProfessionalAvailabilityLock (Bloqueio de Agenda)
```typescript
interface IProfessionalAvailabilityLock {
  id: number (PK)
  professional_id: number (FK → Professional)
  lock_date: Date
  start_time: string (HH:MM:SS)
  end_time: string (HH:MM:SS)
  reason?: string
  createdAt: Date
  updatedAt: Date
}
```

### 3.11 Favorite (Favoritos)
```typescript
interface IFavorite {
  id: number (PK)
  client_id: number (FK → Client)
  professional_id: number (FK → Professional)
  createdAt: Date
  updatedAt: Date
}
```

### 3.12 Notification (Notificação - MongoDB)
```typescript
interface INotification {
  _id: ObjectId (PK - MongoDB)
  user_id: number
  title: string
  message: string
  read: boolean (default: false)
  expo_push_token?: string
  createdAt: Date
  updatedAt: Date
}
```

### 3.13 Admin (Administrador)
```typescript
interface IAdmin {
  id: number (PK)
  user_id: number (FK → User)
  role: string (super_admin, admin, moderator)
  permissions: JSON
  createdAt: Date
  updatedAt: Date
}
```

### 3.14 Amenities (Comodidades)
```typescript
interface IAmenities {
  id: number (PK)
  name: string
  description?: string
  icon_uri?: string
  active: boolean (default: true)
  createdAt: Date
  updatedAt: Date
}
```

### 3.15 ProfessionalAmenities (Comodidades do Profissional)
```typescript
interface IProfessionalAmenities {
  id: number (PK)
  professional_id: number (FK → Professional)
  amenities_id: number (FK → Amenities)
  createdAt: Date
  updatedAt: Date
}
```

### 3.16 ProfessionalGallery (Galeria do Profissional)
```typescript
interface IProfessionalGallery {
  id: number (PK)
  professional_id: number (FK → Professional)
  image_uri: string
  description?: string
  order: number (índice de ordenação)
  createdAt: Date
  updatedAt: Date
}
```

---

## 4. Endpoints da API

### 4.1 Autenticação (`/auth`)

| Método | Endpoint | Descrição | Auth |
|--------|----------|-----------|------|
| POST | `/auth/register` | Registrar novo usuário | ❌ |
| POST | `/auth/verify` | Verificar código de e-mail | ❌ |
| POST | `/auth/resend` | Reenviar código de verificação | ❌ |

### 4.2 Usuários (`/api/user`)

| Método | Endpoint | Descrição | Auth |
|--------|----------|-----------|------|
| POST | `/api/user/login` | Login com e-mail e senha | ❌ |
| GET | `/api/user/me` | Dados do usuário autenticado | ✅ JWT |
| PUT | `/api/user/me` | Atualizar perfil do usuário | ✅ JWT |
| POST | `/api/user/change-password` | Alterar senha | ✅ JWT |
| POST | `/api/user/imgbb/avatar` | Upload de avatar (imgbb) | ✅ JWT |
| DELETE | `/api/user/avatar` | Deletar avatar | ✅ JWT |
| GET | `/api/user/:id` | Buscar usuário por ID | ❌ |

### 4.3 Endereços (`/api/address`)

| Método | Endpoint | Descrição | Auth |
|--------|----------|-----------|------|
| GET | `/api/address` | Listar endereços do usuário autenticado | ✅ JWT |
| GET | `/api/address/:id` | Obter endereço por ID | ✅ JWT |
| POST | `/api/address` | Criar novo endereço | ✅ JWT |
| PUT | `/api/address/:id` | Atualizar endereço | ✅ JWT |
| DELETE | `/api/address/:id` | Deletar endereço | ✅ JWT |

### 4.4 Categorias (`/api/categories`)

| Método | Endpoint | Descrição | Auth |
|--------|----------|-----------|------|
| GET | `/api/categories` | Listar todas as categorias ativas | ❌ |
| GET | `/api/categories/:id` | Obter categoria por ID | ❌ |

### 4.5 Subcategorias (`/api/subcategories`)

| Método | Endpoint | Descrição | Auth |
|--------|----------|-----------|------|
| GET | `/api/subcategories` | Listar subcategorias | ❌ |
| GET | `/api/subcategories/:id` | Obter subcategoria por ID | ❌ |
| GET | `/api/subcategories/category/:categoryId` | Listar por categoria | ❌ |

### 4.6 Profissionais (`/api/professionals`)

| Método | Endpoint | Descrição | Auth |
|--------|----------|-----------|------|
| GET | `/api/professionals` | Listar profissionais com filtros (termo, lat, lng, raio_km) | ❌ |
| GET | `/api/professionals/:id` | Obter profissional por ID | ❌ |
| GET | `/api/professionals/search-availability` | Buscar disponibilidade de profissional | ❌ |

### 4.7 Agendamentos (`/api/appointments`)

| Método | Endpoint | Descrição | Auth |
|--------|----------|-----------|------|
| GET | `/api/appointments` | Listar agendamentos do usuário autenticado | ✅ JWT |
| POST | `/api/appointments` | Criar novo agendamento | ✅ JWT |
| PATCH | `/api/appointments/:id/confirm` | Confirmar agendamento | ✅ JWT |
| POST | `/api/appointments/:id/review` | Avaliar serviço (rating + review) | ✅ JWT |
| GET | `/api/appointments/:id/invoice` | Obter nota fiscal do agendamento | ✅ JWT |

### 4.8 Pagamentos (`/api/payments`)

| Método | Endpoint | Descrição | Auth |
|--------|----------|-----------|------|
| POST | `/api/payments/create-payment-intent` | Criar Payment Intent (Stripe) | ✅ JWT |
| POST | `/api/payments/confirm` | Confirmar pagamento e criar agendamento | ✅ JWT |

### 4.9 Notificações (`/api/notifications`)

| Método | Endpoint | Descrição | Auth |
|--------|----------|-----------|------|
| GET | `/api/notifications/:userId` | Listar notificações do usuário | ❌ |
| PATCH | `/api/notifications/:notificationId/read/:userId` | Marcar notificação como lida | ❌ |
| PATCH | `/api/notifications/mark-all-read/:userId` | Marcar todas como lidas | ❌ |
| POST | `/api/notifications/save-token` | Salvar token Expo Push | ❌ |

### 4.10 Favoritos (`/api/favorites`)

| Método | Endpoint | Descrição | Auth |
|--------|----------|-----------|------|
| GET | `/api/favorites` | Listar profissionais favoritos | ✅ JWT |
| POST | `/api/favorites/:professionalId` | Adicionar aos favoritos | ✅ JWT |
| DELETE | `/api/favorites/:professionalId` | Remover dos favoritos | ✅ JWT |

### 4.11 Dashboard (`/api/dashboard`)

| Método | Endpoint | Descrição | Auth |
|--------|----------|-----------|------|
| GET | `/api/dashboard/kpis` | KPIs do profissional (ganhos, avaliação, serviços) | ✅ JWT |
| GET | `/api/dashboard/earnings-over-time` | Ganhos ao longo do tempo | ✅ JWT |
| GET | `/api/dashboard/services-by-category` | Serviços agrupados por categoria | ✅ JWT |

### 4.12 Admin (`/api/admin`)

| Método | Endpoint | Descrição | Auth |
|--------|----------|-----------|------|
| POST | `/api/admin/login` | Login admin | ❌ |
| GET | `/api/admin/stats` | Estatísticas globais do sistema | ✅ Admin |

### 4.13 Avatar (`/api/user/avatar`)

| Método | Endpoint | Descrição | Auth |
|--------|----------|-----------|------|
| POST | `/api/user/imgbb/avatar` | Upload de avatar via imgbb | ✅ JWT |
| GET | `/api/user/avatar/:id` | Obter avatar do usuário | ❌ |
| DELETE | `/api/user/avatar` | Deletar avatar | ✅ JWT |

### 4.14 Documentação

| Método | Endpoint | Descrição | Auth |
|--------|----------|-----------|------|
| GET | `/docs` | Swagger UI interativa | ❌ |
| GET | `/avatarBucket/:filename` | Servir arquivos estáticos (avatares) | ❌ |

---

## 5. Middlewares

### 5.1 Auth Middleware (`auth.middleware.ts`)
- Valida token JWT no header `Authorization: Bearer <token>`
- Decodifica e injeta `req.user`, `req.client`, `req.address` no objeto de requisição
- Retorna erro 401 se token ausente, 403 se inválido

### 5.2 Admin Middleware (`admin.middleware.ts`)
- Verifica se o usuário autenticado é um administrador
- Protege rotas administrativas

### 5.3 CORS Middleware (`cors.middleware.ts`)
- Configura CORS para aceitar requisições de múltiplas origens
- Necessário para aceitar requisições do front-end (mobile/web)

### 5.4 Logging Middleware (`logging.middleware.ts`)
- Registra todas as requisições e respostas
- Integrado com Winston para logging estruturado

---

## 6. Services

### 6.1 Email Service (`email.service.ts`)
```typescript
EmailService.sendTransactionalEmail({
  to: string,
  subject: string,
  html: string
}): Promise<boolean>
```
- Envia e-mails transacionais via SendGrid
- Usado para: verificação de e-mail, notificações, recibos

### 6.2 Payment Service (`payment.service.ts`)
- Integração com Stripe API
- Cria Payment Intents
- Confirma pagamentos
- Atualiza status de agendamentos após confirmação

---

## 7. Configurações

### 7.1 Database Configuration (`config/database.ts`)
```typescript
// Desenvolvimento: MySQL/PostgreSQL local
{
  dialect: 'mysql' ou 'postgres',
  host: 'localhost',
  port: 3306 ou 5432,
  database: 'delbicos',
  username: 'root',
  password: 'password'
}

// Produção/Staging: PostgreSQL com SSL
{
  dialect: 'postgres',
  url: process.env.DATABASE_URL,
  ssl: { require: true, rejectUnauthorized: false }
}
```

### 7.2 SendGrid Configuration (`config/sendgrid.ts`)
- Usa variável de ambiente `SENDGRID_API_KEY`
- E-mail remetente: `SENDER_EMAIL_VERIFICADO`

### 7.3 Swagger Configuration (`config/swagger.ts`)
- Documenta todos os endpoints via OpenAPI 3.0
- Acessível em `/docs`

### 7.4 Variáveis de Ambiente (.env)
```env
# Ambiente
ENVIRONMENT=development|staging|production
IS_SERVERLESS=false|true

# Database
DATABASE_URL=postgresql://...
SEQUELIZE_DB_NAME=delbicos
SEQUELIZE_DB_USER=root
SEQUELIZE_DB_PASS=password
SEQUELIZE_HOST=localhost
SEQUELIZE_PORT=5432
SEQUELIZE_DIALECT=postgres|mysql

# MongoDB (Notificações)
MONGODB_URI=mongodb+srv://...

# Autenticação JWT
SECRET_KEY=sua-chave-secreta-aqui
EXPIRES_IN=24h

# Stripe
STRIPE_SECRET_KEY=sk_test_...

# SendGrid
SENDGRID_API_KEY=SG.xxxxx
SENDER_EMAIL_VERIFICADO=noreply@delbicos.com

# Servidor
PORT=3000
```

---

## 8. Fluxo de Negócio

### 8.1 Fluxo de Registro
1. **POST `/auth/register`** → Criar usuário + Client/Professional
2. **POST `/auth/verify`** → Validar código de e-mail (enviado via SendGrid)
3. **POST `/auth/resend`** → Reenviar código se necessário

### 8.2 Fluxo de Login
1. **POST `/api/user/login`** → Validar credenciais, retornar JWT + dados do usuário
2. JWT armazenado no client (AsyncStorage / localStorage)
3. JWT injeta-se automaticamente em requisições via interceptor Axios

### 8.3 Fluxo de Agendamento
1. **GET `/api/professionals`** → Listar profissionais
2. **GET `/api/professionals/:id`** → Detalhes do profissional
3. **GET `/api/professionals/search-availability`** → Verificar disponibilidade
4. **POST `/api/payments/create-payment-intent`** → Criar Payment Intent (Stripe)
5. **POST `/api/payments/confirm`** → Confirmar pagamento
6. Agendamento criado com status `pending`
7. **PATCH `/api/appointments/:id/confirm`** → Profissional confirma agendamento

### 8.4 Fluxo de Avaliação
1. **POST `/api/appointments/:id/review`** → Enviar rating (1-5) e review (texto)
2. Agendamento marcado como `completed`

### 8.5 Fluxo de Dashboard (Profissional)
1. **GET `/api/dashboard/kpis`** → KPIs (ganhos, avaliação média, contagem de serviços)
2. **GET `/api/dashboard/earnings-over-time`** → Gráfico de ganhos mensais
3. **GET `/api/dashboard/services-by-category`** → Serviços agrupados por categoria

---

## 9. Integrações Externas

| Serviço | Uso | Variável de Ambiente |
|---------|-----|---------------------|
| **Stripe** | Processamento de pagamentos | `STRIPE_SECRET_KEY` |
| **SendGrid** | E-mails transacionais | `SENDGRID_API_KEY` |
| **Expo** | Notificações push | (Token salvo por usuário) |
| **MongoDB** | Armazenamento de notificações | `MONGODB_URI` |
| **PostgreSQL / MySQL** | Dados relacionais | `DATABASE_URL` / `SEQUELIZE_*` |

---

## 10. Docker & Deploy

### 10.1 Docker Compose
```yaml
services:
  postgres:
    image: postgres
    ports: 5432:5432
    volumes: BD persistente

  delbicos-server:
    build: Dockerfile
    ports: 3000:3000
    depends_on: [postgres]
    environment: Todas as variáveis .env
```

### 10.2 Scripts Docker
```bash
# Construir
npm run docker:build

# Iniciar
npm run docker:up
npm run docker:dev

# Migrations + Seeds
npm run docker:migrate
npm run docker:seed

# Logs
npm run docker:logs

# Limpar tudo
npm run docker:clean:all
```

### 10.3 Deploy em Produção (Vercel)
- **Trigger:** Push para `main` branch
- **Build:** `npm run build` (compila TypeScript)
- **Start:** `node dist/server.js`
- **Modo Serverless:** `IS_SERVERLESS=true` (adapta handler para Vercel)

---

## 11. Scripts Disponíveis

```bash
# Desenvolvimento
npm run dev                    # Inicia dev server com hot-reload

# Build & Produção
npm run build                  # Compila TypeScript → dist/
npm run start                  # Inicia servidor de produção

# Database
npm run migrate                # Executa migrations pendentes
npm run migrate:new [name]     # Cria nova migration
npm run migrate:undo           # Desfaz última migration
npm run migrate:reset          # Desfaz tudo + refaz tudo

# Seeders (Dados iniciais)
npm run seed                   # Executa todos os seeders
npm run seed:new [name]        # Cria novo seeder
npm run seed:undo              # Desfaz último seeder
npm run seed:reset             # Desfaz tudo + refaz tudo

# Testing
npm run test                   # Executa testes Jest

# Linting
npm run lint                   # Verifica TypeScript (sem emit)

# Docker
npm run docker:up              # Inicia containers
npm run docker:down            # Para containers
npm run docker:dev             # Acessa terminal docker
npm run docker:logs            # Vê logs em tempo real
npm run docker:restart         # Reinicia
npm run docker:clean:all       # Remove tudo (containers + volumes)
```

---

## 12. Estrutura de Controllers

Padrão de um controller:
```typescript
// controllers/exemplo.controller.ts
import { Request, Response } from 'express';
import { AuthenticatedRequest } from '../interfaces/authentication.interface';

export const getExemple = async (req: Request, res: Response) => {
  try {
    // Lógica
    res.status(200).json({ data: '...' });
  } catch (error) {
    res.status(500).json({ message: 'Erro', error });
  }
};

export const createExemple = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = req.user.id; // Recupera de JWT
    // Lógica
    res.status(201).json({ message: 'Criado', data: '...' });
  } catch (error) {
    res.status(500).json({ message: 'Erro', error });
  }
};
```

---

## 13. Status de Implementação

### ✅ Implementado
- ✅ Autenticação JWT completa (login, registro, verify)
- ✅ CRUD de usuários (perfil, avatar, senha)
- ✅ CRUD de endereços com geolocalização (lat/lng)
- ✅ Listagem e busca de categorias/subcategorias
- ✅ Listagem e busca de profissionais com filtros (termo, proximidade)
- ✅ CRUD de agendamentos
- ✅ Sistema de avaliações (rating + review)
- ✅ Integração Stripe (pagamentos)
- ✅ Notificações push (Expo)
- ✅ Dashboard KPIs do profissional
- ✅ Favoritos (adicionar/remover)
- ✅ Upload de avatares (imgbb)
- ✅ Admin login + stats básicos
- ✅ Swagger documentation completa

### ⚠️ Parcialmente Implementado
- ⚠️ Professional Management (listar sim, criar/editar não)
- ⚠️ Service Management (apenas listar, sem CRUD)
- ⚠️ Availability Management (existe modelo, mas sem endpoints)
- ⚠️ Admin Dashboard (apenas stats básicos)

### ❌ Não Implementado
- ❌ Chat/Mensagens em tempo real (WebSocket)
- ❌ Sistema de reviews/ratings em tempo real
- ❌ Relatórios analytics avançados
- ❌ Integração com Google Maps API (apenas geocoding)
- ❌ Dois fatores (2FA)
- ❌ Recovery de senha (reset)
- ❌ Rate limiting
- ❌ API versioning (/v1/api, etc)

---

## 14. Próximos Passos Recomendados

1. **Completar CRUD de Serviços** → Profissionais possam criar/editar/deletar seus serviços
2. **Endpoints de Disponibilidade** → Gerenciar horários de atendimento (ProfessionalAvailability)
3. **Melhorar Admin Dashboard** → Mais estatísticas, filtros, relatórios
4. **Chat em Tempo Real** → WebSocket ou Firebase para mensagens live
5. **Sistema de Avaliação em Tempo Real** → Notificações quando profissional recebe avaliação
6. **Rate Limiting** → Proteger API contra abuso
7. **Autenticação Social** → Login com Google/Facebook
8. **Melhorar Logging** → Centralizar logs (Application Insights, ELK Stack)
9. **Testes Automatizados** → Aumentar cobertura (Jest + Supertest)
10. **API Versioning** → Preparar para evolução (/api/v1/)

---

## 15. Troubleshooting Comum

### Erro de Conexão com BD
```bash
# Verificar credenciais .env
SEQUELIZE_HOST=localhost
SEQUELIZE_PORT=5432
SEQUELIZE_DB_NAME=delbicos
SEQUELIZE_DB_USER=postgres
SEQUELIZE_DB_PASS=password

# Criar BD manualmente
npm run migrate:db:create
npm run migrate
```

### JWT Inválido ou Expirado
```bash
# Revisar SECRET_KEY e EXPIRES_IN
SECRET_KEY=sua-chave-segura-min-32-chars
EXPIRES_IN=24h
```

### Erro de CORS
```typescript
// src/middlewares/cors.middleware.ts
setupCors(app); // Verifica origem do cliente
```

### Erro ao Enviar E-mail
```bash
# Validar SendGrid
SENDGRID_API_KEY=SG.xxxxxxx
SENDER_EMAIL_VERIFICADO=noreply@delbicos.com
# E-mail remetente deve estar verificado na plataforma SendGrid
```

---

## 16. Resumo Executivo

| Aspecto | Status |
|--------|--------|
| **Framework & Stack** | ✅ Express + TypeScript + Sequelize |
| **Autenticação** | ✅ JWT com refresh automático |
| **Pagamentos** | ✅ Stripe integrado |
| **Notificações** | ✅ Expo push notifications + MongoDB |
| **Database** | ✅ PostgreSQL + Migrations |
| **Deploy** | ✅ Docker + Vercel Serverless |
| **Documentação** | ✅ Swagger OpenAPI |
| **Testes** | ⚠️ Estrutura pronta, cobertura baixa |
| **Escalabilidade** | ⚠️ Adequado para MVP, precisa rate-limiting e caching |
| **Segurança** | ⚠️ JWT OK, mas falta 2FA e rate-limiting |

---

**Projeto:** DelBicos V2 Backend  
**Versão:** 5.4.0  
**Última Atualização:** 25 de Abril de 2026  
**Status:** Production Ready (com melhorias recomendadas)
