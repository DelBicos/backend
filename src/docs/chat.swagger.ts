/**
 * Documentacao OpenAPI (swagger-jsdoc) das rotas de chat.
 * Mantida fora do arquivo de rotas para ele ficar so com o roteamento.
 */

/**
 * @swagger
 * tags:
 *   name: Chat
 *   description: Conversas e mensagens do chat
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     ChatRoomParticipant:
 *       type: object
 *       nullable: true
 *       properties:
 *         id:
 *           type: integer
 *         name:
 *           type: string
 *         avatar_uri:
 *           type: string
 *           nullable: true
 *     ChatLastMessage:
 *       type: object
 *       nullable: true
 *       properties:
 *         id:
 *           type: string
 *           description: ID da mensagem no MongoDB
 *         room_id:
 *           type: integer
 *         sender_id:
 *           type: integer
 *         content:
 *           type: string
 *         sent_at:
 *           type: string
 *           format: date-time
 *     ChatRoom:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         appointment_id:
 *           type: integer
 *         status:
 *           type: string
 *           enum: [active, archived, blocked]
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *         other_participant:
 *           $ref: '#/components/schemas/ChatRoomParticipant'
 *         last_message:
 *           $ref: '#/components/schemas/ChatLastMessage'
 *     ChatMessage:
 *       type: object
 *       properties:
 *         id:
 *           type: string
 *           description: ID da mensagem no MongoDB
 *         room_id:
 *           type: integer
 *         sender_id:
 *           type: integer
 *         content:
 *           type: string
 *         sent_at:
 *           type: string
 *           format: date-time
 *     ChatMessagesResponse:
 *       type: object
 *       properties:
 *         room_id:
 *           type: integer
 *         cursor:
 *           type: string
 *           format: date-time
 *           nullable: true
 *           description: Cursor para próxima paginação
 *         has_more:
 *           type: boolean
 *         messages:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/ChatMessage'
 *         room_status:
 *           type: string
 *           enum: [active, archived, blocked]
 *         role:
 *           type: string
 *           enum: [client, professional]
 */

/**
 * @swagger
 * /chat/rooms:
 *   get:
 *     summary: Lista conversas do usuário autenticado
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 100
 *           default: 50
 *         description: Limite de salas retornadas por chamada
 *     responses:
 *       200:
 *         description: Lista de salas com correspondente e última mensagem
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ChatRoom'
 *       401:
 *         description: Usuário não autenticado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       500:
 *         description: Erro interno ao listar salas
 */

/**
 * @swagger
 * /chat/rooms/{roomId}/messages:
 *   get:
 *     summary: Histórico paginado de mensagens por sala
 *     tags: [Chat]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: roomId
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID da sala de chat
 *       - in: query
 *         name: cursor
 *         required: false
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Cursor em ISO date (sent_at) para paginação
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *           default: 20
 *         description: Quantidade de mensagens retornadas
 *     responses:
 *       200:
 *         description: Histórico paginado de mensagens
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ChatMessagesResponse'
 *       400:
 *         description: ID da sala inválido
 *       401:
 *         description: Usuário não autenticado
 *       403:
 *         description: Usuário não participa da conversa
 *       503:
 *         description: Serviço de chat indisponível
 *       500:
 *         description: Erro interno ao buscar histórico
 */

export {};
