import { Router } from "express";
import {
  getAllAppointments,
  confirmAppointment,
  reviewAppointment,
  getAppointmentInvoice,
  updateAppointmentStatus,
  createAppointment,
} from "../controllers/appointment.controller";
import authMiddleware from "../middlewares/auth.middleware";

const router = Router();

/**
 * @swagger
 * tags:
 *   name: Appointments
 *   description: Gerenciamento de agendamentos
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     Appointment:
 *       type: object
 *       required:
 *         - professional_id
 *         - service_id
 *         - client_id
 *         - date
 *         - start_time
 *         - end_time
 *       properties:
 *         id:
 *           type: integer
 *           description: ID auto-gerado do agendamento
 *         professional_id:
 *           type: integer
 *           description: ID do profissional
 *         service_id:
 *           type: integer
 *           description: ID do serviço
 *         client_id:
 *           type: integer
 *           description: ID do cliente
 *         date:
 *           type: string
 *           format: date
 *           description: Data do agendamento (YYYY-MM-DD)
 *         start_time:
 *           type: string
 *           format: time
 *           description: Hora de início (HH:MM:SS)
 *         end_time:
 *           type: string
 *           format: time
 *           description: Hora de término (HH:MM:SS)
 *         status:
 *           type: string
 *           enum: [pending, confirmed, canceled, completed]
 *           default: pending
 *           description: Status do agendamento
 *         rating:
 *           type: integer
 *           minimum: 1
 *           maximum: 5
 *           nullable: true
 *           description: Avaliação do serviço (1-5 estrelas)
 *         review:
 *           type: string
 *           nullable: true
 *           maxLength: 1000
 *           description: Comentário sobre o serviço
 *         notes:
 *           type: string
 *           nullable: true
 *           description: Observações adicionais
 *         createdAt:
 *           type: string
 *           format: date-time
 *           description: Data de criação
 *         updatedAt:
 *           type: string
 *           format: date-time
 *           description: Data de atualização
 *       example:
 *         id: 1
 *         professional_id: 5
 *         service_id: 3
 *         client_id: 8
 *         date: "2023-12-15"
 *         start_time: "14:00:00"
 *         end_time: "15:00:00"
 *         status: "completed"
 *         rating: 5
 *         review: "Excelente serviço, profissional muito competente!"
 *         notes: "Cliente preferencial"
 *         createdAt: "2023-12-01T10:00:00.000Z"
 *         updatedAt: "2023-12-01T10:00:00.000Z"
 *
 *     AppointmentInput:
 *       type: object
 *       required:
 *         - professional_id
 *         - service_id
 *         - client_id
 *         - date
 *         - start_time
 *         - end_time
 *       properties:
 *         professional_id:
 *           type: integer
 *         service_id:
 *           type: integer
 *         client_id:
 *           type: integer
 *         date:
 *           type: string
 *           format: date
 *         start_time:
 *           type: string
 *           format: time
 *         end_time:
 *           type: string
 *           format: time
 *         status:
 *           type: string
 *           enum: [pending, confirmed, canceled, completed]
 *         notes:
 *           type: string
 *           nullable: true
 *       example:
 *         professional_id: 5
 *         service_id: 3
 *         client_id: 8
 *         date: "2023-12-15"
 *         start_time: "14:00:00"
 *         end_time: "15:00:00"
 *         notes: "Cliente preferencial"
 *
 *     ReviewInput:
 *       type: object
 *       required:
 *         - rating
 *       properties:
 *         rating:
 *           type: integer
 *           minimum: 1
 *           maximum: 5
 *           description: Avaliação do serviço (1-5 estrelas)
 *         review:
 *           type: string
 *           nullable: true
 *           maxLength: 1000
 *           description: Comentário sobre o serviço
 *       example:
 *         rating: 5
 *         review: "Excelente serviço, profissional muito competente!"
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     InvoiceData:
 *       type: object
 *       properties:
 *         invoiceNumber:
 *           type: string
 *         date:
 *           type: string
 *         customerName:
 *           type: string
 *         customerCpf:
 *           type: string
 *         customerAddress:
 *           type: string
 *         professionalName:
 *           type: string
 *         professionalCpf:
 *           type: string
 *         serviceName:
 *           type: string
 *         serviceDescription:
 *           type: string
 *         servicePrice:
 *           type: number
 *         serviceDate:
 *           type: string
 *         serviceTime:
 *           type: string
 *         total:
 *           type: number
 *         paymentMethod:
 *           type: string
 *           nullable: true
 *         transactionId:
 *           type: string
 *           nullable: true
 *         dueDate:
 *           type: string
 *           nullable: true
 *         observations:
 *           type: string
 *           nullable: true
 *       example:
 *         invoiceNumber: "NF01234"
 *         date: "01/01/2024"
 *         customerName: "João da Silva Santos"
 *         customerCpf: "123.456.789-00"
 *         customerAddress: "Rua das Flores, 123 - Centro - São Paulo/SP - CEP: 01234-567"
 *         professionalName: "Maria Oliveira Costa"
 *         professionalCpf: "987.654.321-00"
 *         serviceName: "Limpeza Residencial Completa"
 *         serviceDescription: "Limpeza completa de casa com 3 quartos"
 *         servicePrice: 150.0
 *         serviceDate: "01/01/2024"
 *         serviceTime: "14:00 - 17:00"
 *         total: 150.0
 *         paymentMethod: "Cartão de Crédito"
 *         transactionId: "TXN123456789"
 */

/**
 * @swagger
 * /appointments/user/{id}:
 *   get:
 *     summary: Retorna todos os agendamentos de um usuário específico
 *     tags: [Appointments]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID do usuário
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, confirmed, canceled, completed]
 *         description: Filtrar por status
 *       - in: query
 *         name: date
 *         schema:
 *           type: string
 *           format: date
 *         description: Filtrar por data específica (YYYY-MM-DD)
 *       - in: query
 *         name: start_date
 *         schema:
 *           type: string
 *           format: date
 *         description: Data inicial para intervalo (YYYY-MM-DD)
 *       - in: query
 *         name: end_date
 *         schema:
 *           type: string
 *           format: date
 *         description: Data final para intervalo (YYYY-MM-DD)
 *     responses:
 *       200:
 *         description: Lista de agendamentos do usuário (como cliente e profissional)
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 asClient:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Appointment'
 *                   description: Agendamentos onde o usuário é cliente
 *                 asProfessional:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Appointment'
 *                   description: Agendamentos onde o usuário é profissional
 *       404:
 *         description: Usuário não encontrado
 *       500:
 *         description: Erro interno do servidor
 */
/**
 * @swagger
 * /appointments:
 *   post:
 *     summary: Cria um novo agendamento (sem pagamento)
 *     description: >
 *       Cria um agendamento com status `pending`. O `client_id` é derivado
 *       automaticamente do token JWT — o usuário autenticado deve ter perfil de cliente.
 *     tags: [Appointments]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - service_id
 *               - professional_id
 *               - address_id
 *               - start_time
 *               - end_time
 *             properties:
 *               service_id:
 *                 type: integer
 *                 example: 3
 *               professional_id:
 *                 type: integer
 *                 example: 5
 *               address_id:
 *                 type: integer
 *                 example: 12
 *               start_time:
 *                 type: string
 *                 format: date-time
 *                 example: "2026-06-10T14:00:00.000Z"
 *               end_time:
 *                 type: string
 *                 format: date-time
 *                 example: "2026-06-10T15:00:00.000Z"
 *     responses:
 *       201:
 *         description: Agendamento criado com sucesso (status pending)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Appointment'
 *       400:
 *         description: Campos obrigatórios ausentes ou serviço inativo
 *       401:
 *         description: Token ausente
 *       403:
 *         description: Usuário não possui perfil de cliente
 *       404:
 *         description: Profissional ou serviço não encontrado
 *       500:
 *         description: Erro interno do servidor
 */
router.post("/", authMiddleware, createAppointment);

router.get("/user/:id", getAllAppointments);

/**
 * @swagger
 * /appointments/{id}/confirm:
 *   post:
 *     summary: Confirma um agendamento pendente
 *     tags: [Appointments]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID do agendamento
 *     responses:
 *       200:
 *         description: Agendamento confirmado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Appointment'
 *       400:
 *         description: Agendamento não está pendente ou já foi confirmado/cancelado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *       404:
 *         description: Agendamento não encontrado
 *       500:
 *         description: Erro interno do servidor
 */
router.post("/:id/confirm", authMiddleware, confirmAppointment);

/**
 * @swagger
 * /appointments/{id}:
 *   put:
 *     summary: Atualiza o status de um agendamento pendente (Aceitar/Recusar)
 *     tags: [Appointments]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID do agendamento
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [status]
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [confirmed, canceled]
 *     responses:
 *       200:
 *         description: Status do agendamento atualizado com sucesso
 *       400:
 *         description: Status inválido ou agendamento não está pendente
 *       404:
 *         description: Agendamento não encontrado
 *       500:
 *         description: Erro interno do servidor
 */
router.put("/:id", authMiddleware, updateAppointmentStatus);


/**
 * @swagger
 * /appointments/{id}/review:
 *   post:
 *     summary: Avalia um agendamento concluído
 *     tags: [Appointments]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID do agendamento
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ReviewInput'
 *     responses:
 *       200:
 *         description: Agendamento avaliado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Appointment'
 *       400:
 *         description: Agendamento não está concluído, avaliação inválida ou dados incorretos
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *               example:
 *                 error: "Não é possível avaliar um agendamento com status 'pending'"
 *       404:
 *         description: Agendamento não encontrado
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *               example:
 *                 error: "Agendamento não encontrado"
 *       500:
 *         description: Erro interno do servidor
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 error:
 *                   type: string
 *               example:
 *                 error: "Erro ao avaliar agendamento"
 */
router.post("/:id/review", authMiddleware, reviewAppointment);

/**
 * @swagger
 * /appointments/{id}/invoice:
 *   get:
 *     summary: Retorna a invoice de um agendamento pelo ID
 *     tags: [Appointments]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         description: ID do agendamento
 *     responses:
 *       200:
 *         description: Dados da invoice do agendamento
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/InvoiceData'
 *       404:
 *         description: Agendamento não encontrado
 *       500:
 *         description: Erro interno do servidor
 */
router.get("/:id/receipt", authMiddleware, getAppointmentInvoice);

export default router;
