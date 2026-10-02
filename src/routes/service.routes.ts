import { Router } from "express";
import rateLimit from "express-rate-limit";
import authMiddleware from "../middlewares/auth.middleware";
import {
  getService,
  updateService,
  deleteService,
  listAllServices,
  searchServicesSemantically,
  createServiceSelf,
  listMyServices,
} from "../controllers/service.controller";
import {
  validateCreateServiceTopLevel,
  validateUpdateService,
} from "../middlewares/service.validation";
import { sseHandler } from "../utils/sse";

const router = Router();
const isProduction = (process.env.ENVIRONMENT || process.env.NODE_ENV) === "production";

const semanticSearchRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: isProduction ? 60 : 240,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Muitas buscas semânticas. Aguarde alguns minutos antes de tentar novamente." },
});

/**
 * @swagger
 * tags:
 *   name: Services
 *   description: CRUD de serviços com disponibilidade por dia da semana
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     AvailabilityInput:
 *       type: object
 *       required:
 *         - day
 *         - start
 *         - end
 *       properties:
 *         day:
 *           type: integer
 *           minimum: 0
 *           maximum: 6
 *           description: "Dia da semana: 0=Domingo, 1=Segunda, ..., 6=Sábado"
 *           example: 1
 *         start:
 *           type: string
 *           pattern: "^([01]\\d|2[0-3]):[0-5]\\d$"
 *           description: Horário de início no formato HH:MM (hora local do servidor)
 *           example: "09:00"
 *         end:
 *           type: string
 *           pattern: "^([01]\\d|2[0-3]):[0-5]\\d$"
 *           description: Horário de término no formato HH:MM (start < end obrigatório)
 *           example: "12:00"
 *
 *     AvailabilityOutput:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         day_of_week:
 *           type: integer
 *           description: "0=Domingo, 1=Segunda, ..., 6=Sábado"
 *         start_time:
 *           type: string
 *           description: Formato HH:MM
 *           example: "09:00"
 *         end_time:
 *           type: string
 *           description: Formato HH:MM
 *           example: "12:00"
 *
 *     ServiceCreateRequest:
 *       type: object
 *       required:
 *         - title
 *         - description
 *         - price
 *         - category_id
 *         - subcategory_id
 *       properties:
 *         title:
 *           type: string
 *           example: "Limpeza residencial"
 *         description:
 *           type: string
 *           example: "Limpeza completa de casa com produtos incluídos"
 *         price:
 *           type: number
 *           format: float
 *           minimum: 0
 *           example: 120.5
 *         category_id:
 *           type: integer
 *           example: 5
 *         subcategory_id:
 *           type: integer
 *           description: Deve pertencer à category_id informada
 *           example: 12
 *         duration:
 *           type: integer
 *           description: Duração em minutos (padrão 60)
 *           example: 90
 *         availabilities:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/AvailabilityInput'
 *           description: |
 *             Opcional. Se informado: day ∈ [0..6], start < end (HH:MM),
 *             sem sobreposição de horários no mesmo dia.
 *             Timezone: hora local do servidor.
 *
 *     ServiceUpdateRequest:
 *       type: object
 *       description: Todos os campos são opcionais (PATCH semântico via PUT)
 *       properties:
 *         title:
 *           type: string
 *         description:
 *           type: string
 *         price:
 *           type: number
 *           format: float
 *           minimum: 0
 *         category_id:
 *           type: integer
 *         subcategory_id:
 *           type: integer
 *         duration:
 *           type: integer
 *         active:
 *           type: boolean
 *         availabilities:
 *           type: array
 *           description: Se presente, SUBSTITUI todas as disponibilidades existentes
 *           items:
 *             $ref: '#/components/schemas/AvailabilityInput'
 *
 *     ServiceResponse:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         title:
 *           type: string
 *         description:
 *           type: string
 *         price:
 *           type: number
 *           format: float
 *         price_cents:
 *           type: integer
 *           description: Preço em centavos
 *         duration:
 *           type: integer
 *           description: Duração em minutos
 *         active:
 *           type: boolean
 *         category_id:
 *           type: integer
 *         subcategory_id:
 *           type: integer
 *         professional_id:
 *           type: integer
 *         Availabilities:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/AvailabilityOutput'
 *         Professional:
 *           type: object
 *           properties:
 *             id:
 *               type: integer
 *             user_id:
 *               type: integer
 *             description:
 *               type: string
 *             User:
 *               type: object
 *               properties:
 *                 id:
 *                   type: integer
 *                 name:
 *                   type: string
 *                 avatar_uri:
 *                   type: string
 *             MainAddress:
 *               type: object
 *               properties:
 *                 city:
 *                   type: string
 *                 state:
 *                   type: string
 *         Subcategory:
 *           type: object
 *           properties:
 *             id:
 *               type: integer
 *             title:
 *               type: string
 *             category_id:
 *               type: integer
 */

/**
 * @swagger
 * /services:
 *   get:
 *     summary: Lista serviços públicos ativos
 *     tags: [Services]
 *     parameters:
 *       - in: query
 *         name: category_id
 *         schema:
 *           type: integer
 *         description: Filtrar por categoria
 *       - in: query
 *         name: subcategory_id
 *         schema:
 *           type: integer
 *         description: Filtrar por subcategoria
 *       - in: query
 *         name: q
 *         schema:
 *           type: string
 *         description: Busca por título (LIKE %q%)
 *       - in: query
 *         name: day
 *         schema:
 *           type: integer
 *           minimum: 0
 *           maximum: 6
 *         description: "Filtrar por dia de disponibilidade (0=Dom..6=Sáb)"
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *           maximum: 100
 *     responses:
 *       200:
 *         description: Lista paginada de serviços
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ServiceResponse'
 *             example:
 *               total: 42
 *               page: 1
 *               limit: 20
 *               data:
 *                 - id: 7
 *                   title: "Limpeza residencial"
 *                   description: "Limpeza completa"
 *                   price: 120.5
 *                   price_cents: 12050
 *                   duration: 90
 *                   active: true
 *                   category_id: 5
 *                   subcategory_id: 12
 *                   professional_id: 3
 *                   Availabilities:
 *                     - id: 1
 *                       day_of_week: 1
 *                       start_time: "09:00"
 *                       end_time: "12:00"
 *                   Professional:
 *                     id: 3
 *                     user_id: 6
 *                     description: "Especialista em limpeza"
 *                     User:
 *                       id: 6
 *                       name: "Iago Silva"
 *                       avatar_uri: "https://i.pravatar.cc/150?img=6"
 *                     MainAddress:
 *                       city: "Sorocaba"
 *                       state: "SP"
 */
/**
 * @swagger
 * /services/events:
 *   get:
 *     summary: Stream SSE de novos serviços criados (Server-Sent Events)
 *     description: >
 *       Conecta ao stream de eventos SSE. Quando um profissional cria um novo serviço,
 *       o servidor emite um evento `new_service` com os dados básicos do serviço.
 *       O cliente deve usar a API `EventSource` do browser.
 *     tags: [Services]
 *     responses:
 *       200:
 *         description: Stream SSE ativo
 *         content:
 *           text/event-stream:
 *             schema:
 *               type: string
 *               example: "event: new_service\ndata: {\"id\":123,\"title\":\"Limpeza\"}\n\n"
 */
router.get("/events", sseHandler("services"));

/**
 * @route GET /api/services/search/semantic?q=...
 * @desc Busca serviços por significado e retorna serviço + profissional.
 */
router.get("/search/semantic", semanticSearchRateLimit, searchServicesSemantically);

router.get("/", listAllServices);

/**
 * @swagger
 * /services/my:
 *   get:
 *     summary: Lista todos os serviços (ativos e inativos) do profissional autenticado
 *     tags: [Services]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 50
 *     responses:
 *       200:
 *         description: Serviços do profissional autenticado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 total:
 *                   type: integer
 *                 page:
 *                   type: integer
 *                 limit:
 *                   type: integer
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/ServiceResponse'
 *       401:
 *         description: Usuário não autenticado
 *       403:
 *         description: Usuário não é profissional
 */
router.get("/my", authMiddleware, listMyServices);

/**
 * @swagger
 * /services:
 *   post:
 *     summary: Cria um serviço para o profissional autenticado
 *     tags: [Services]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ServiceCreateRequest'
 *           example:
 *             title: "Limpeza residencial"
 *             description: "Limpeza completa de casa com produtos incluídos"
 *             price: 120.5
 *             category_id: 5
 *             subcategory_id: 12
 *             duration: 90
 *             availabilities:
 *               - day: 1
 *                 start: "09:00"
 *                 end: "12:00"
 *               - day: 3
 *                 start: "14:00"
 *                 end: "18:00"
 *     responses:
 *       201:
 *         description: Serviço criado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 service:
 *                   $ref: '#/components/schemas/ServiceResponse'
 *             example:
 *               service:
 *                 id: 7
 *                 title: "Limpeza residencial"
 *                 description: "Limpeza completa de casa com produtos incluídos"
 *                 price: 120.5
 *                 price_cents: 12050
 *                 duration: 90
 *                 active: true
 *                 category_id: 5
 *                 subcategory_id: 12
 *                 professional_id: 3
 *                 Availabilities:
 *                   - id: 1
 *                     day_of_week: 1
 *                     start_time: "09:00"
 *                     end_time: "12:00"
 *                   - id: 2
 *                     day_of_week: 3
 *                     start_time: "14:00"
 *                     end_time: "18:00"
 *       400:
 *         description: |
 *           Payload inválido. Possíveis causas:
 *           - `title` ausente ou vazio
 *           - `description` ausente ou vazia
 *           - `price` ausente ou negativo
 *           - `category_id` ausente ou inválido
 *           - `subcategory_id` ausente, inválido ou não pertence à `category_id`
 *           - `availabilities` com formato inválido, `start >= end`, ou sobreposição de horários no mesmo dia
 *         content:
 *           application/json:
 *             examples:
 *               missingTitle:
 *                 value:
 *                   error: "title é obrigatório"
 *               missingDescription:
 *                 value:
 *                   error: "description é obrigatória"
 *               subcategoryMismatch:
 *                 value:
 *                   error: "subcategory_id não pertence à category_id informada"
 *               availabilityOverlap:
 *                 value:
 *                   error: "availabilities inválidas"
 *                   details:
 *                     - index: 1
 *                       message: "Sobreposição de horário no dia 1 com o item 0"
 *               availabilityFormat:
 *                 value:
 *                   error: "availabilities inválidas"
 *                   details:
 *                     - index: 0
 *                       message: "start deve estar no formato HH:MM"
 *       401:
 *         description: "Token ausente (header Authorization ausente)"
 *       403:
 *         description: Token inválido ou usuário não é profissional
 *       500:
 *         description: Erro interno do servidor
 */
router.post(
  "/",
  authMiddleware,
  validateCreateServiceTopLevel,
  createServiceSelf,
);

/**
 * @swagger
 * /services/{id}:
 *   get:
 *     summary: Detalhe de um serviço
 *     tags: [Services]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID do serviço
 *     responses:
 *       200:
 *         description: Serviço encontrado com availabilities e Professional
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ServiceResponse'
 *       404:
 *         description: Serviço não encontrado
 */
router.get("/:id", getService);

/**
 * @swagger
 * /services/{id}:
 *   put:
 *     summary: Atualiza um serviço (dono profissional apenas)
 *     tags: [Services]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ServiceUpdateRequest'
 *           example:
 *             title: "Limpeza residencial premium"
 *             price: 150
 *             availabilities:
 *               - day: 5
 *                 start: "10:00"
 *                 end: "15:00"
 *     responses:
 *       200:
 *         description: Serviço atualizado (retorna objeto completo com availabilities)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ServiceResponse'
 *       400:
 *         description: Dados inválidos (mesmos casos do POST)
 *       401:
 *         description: Não autenticado
 *       403:
 *         description: Sem permissão (não é o dono do serviço)
 *       404:
 *         description: Serviço não encontrado
 */
router.put("/:id", authMiddleware, validateUpdateService, updateService);

/**
 * @swagger
 * /services/{id}:
 *   delete:
 *     summary: Remove (soft delete) um serviço — dono profissional apenas
 *     tags: [Services]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       204:
 *         description: Serviço desativado com sucesso (soft delete — active=false)
 *       401:
 *         description: Não autenticado
 *       403:
 *         description: Sem permissão (não é o dono)
 *       404:
 *         description: Serviço não encontrado
 */
router.delete("/:id", authMiddleware, deleteService);

export default router;
