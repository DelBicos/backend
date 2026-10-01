import { Router } from "express";
import authMiddleware from "../middlewares/auth.middleware";
import {
  getUserById,
  logInUser,
  changePassword,
  getUserByToken,
  updateUserProfile,
  updateLocationConsent,
  revokeLocationConsent,
  getLocationConsent,
} from "../controllers/user.controller";

const router = Router();

/**
 * @swagger
 * tags:
 *   - name: Authentication
 *     description: Autenticação e registro de usuários
 *   - name: Users
 *     description: Gerenciamento de usuários
 *   - name: Avatar
 *     description: Upload e gerenciamento de avatares
 */

/**
 * @swagger
 * components:
 *   schemas:
 *     PhoneNumberRequest:
 *       type: object
 *       required:
 *         - phoneNumber
 *       properties:
 *         phoneNumber:
 *           type: string
 *           description: Número de telefone do usuário
 *           minLength: 10
 *           example: "11999999999"
 *
 *     PhoneNumberResponse:
 *       type: object
 *       properties:
 *         exists:
 *           type: boolean
 *           description: Indica se o número já está registrado
 *         message:
 *           type: string
 *           description: Mensagem de status
 *       example:
 *         exists: true
 *         message: "Usuário existente, envie o código SMS"
 *
 *     VerifyCodeRequest:
 *       type: object
 *       required:
 *         - phoneNumber
 *         - code
 *       properties:
 *         phoneNumber:
 *           type: string
 *           minLength: 10
 *         code:
 *           type: string
 *           minLength: 4
 *           maxLength: 4
 *           description: Código SMS de 4 dígitos
 *       example:
 *         phoneNumber: "11999999999"
 *         code: "1234"
 *
 *     VerifyCodeResponse:
 *       type: object
 *       properties:
 *         exists:
 *           type: boolean
 *         user:
 *           type: object
 *           properties:
 *             name:
 *               type: string
 *             location:
 *               type: string
 *       examples:
 *         existsTrue:
 *           value:
 *             exists: true
 *             user:
 *               name: "João Silva"
 *               location: "São Paulo"
 *         existsFalse:
 *           value:
 *             exists: false
 *
 *     User:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           description: ID do usuário
 *         name:
 *           type: string
 *           description: Nome do usuário
 *         email:
 *           type: string
 *           format: email
 *           description: Email do usuário
 *         phone:
 *           type: string
 *           description: Telefone do usuário
 *         active:
 *           type: boolean
 *           description: Status do usuário
 *         avatar_uri:
 *           type: string
 *           description: Caminho do avatar do usuário
 *         banner_uri:
 *           type: string
 *           description: Caminho do banner do usuário
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 *       example:
 *         id: 1
 *         name: "João Silva"
 *         email: "joao@email.com"
 *         phone: "11999999999"
 *         active: true
 *         avatar_uri: "avatarBucket/1/avatar.png"
 *         createdAt: "2023-01-01T00:00:00.000Z"
 *         updatedAt: "2023-01-01T00:00:00.000Z"
 *
 *     UserCreate:
 *       type: object
 *       required:
 *         - name
 *         - email
 *         - phone
 *         - password
 *       properties:
 *         name:
 *           type: string
 *           minLength: 2
 *         email:
 *           type: string
 *           format: email
 *         phone:
 *           type: string
 *           minLength: 10
 *         password:
 *           type: string
 *           minLength: 6
 *         active:
 *           type: boolean
 *       example:
 *         name: "João Silva"
 *         email: "joao@email.com"
 *         phone: "11999999999"
 *         password: "senha123"
 *         active: true
 *
 *     UserUpdate:
 *       type: object
 *       properties:
 *         name:
 *           type: string
 *           minLength: 2
 *         email:
 *           type: string
 *           format: email
 *         phone:
 *           type: string
 *           minLength: 10
 *         password:
 *           type: string
 *           minLength: 6
 *         active:
 *           type: boolean
 *         avatar_uri:
 *           type: string
 *       example:
 *         name: "João Silva Santos"
 *         email: "joao.novo@email.com"
 *
 *     SignUpRequest:
 *       type: object
 *       required:
 *         - name
 *         - email
 *         - phone
 *         - password
 *         - cpf
 *         - address
 *       properties:
 *         name:
 *           type: string
 *           minLength: 2
 *         email:
 *           type: string
 *           format: email
 *         phone:
 *           type: string
 *           minLength: 10
 *         password:
 *           type: string
 *           minLength: 6
 *         cpf:
 *           type: string
 *           minLength: 11
 *           maxLength: 11
 *         address:
 *           type: object
 *           required:
 *             - lat
 *             - lng
 *             - city
 *             - state
 *             - country_iso
 *           properties:
 *             lat:
 *               type: number
 *               format: float
 *             lng:
 *               type: number
 *               format: float
 *             city:
 *               type: string
 *             state:
 *               type: string
 *             country_iso:
 *               type: string
 *               minLength: 2
 *               maxLength: 2
 *       example:
 *         name: "João Silva"
 *         email: "joao@email.com"
 *         phone: "11999999999"
 *         password: "senha123"
 *         cpf: "12345678901"
 *         address:
 *           lat: -23.5505
 *           lng: -46.6333
 *           city: "São Paulo"
 *           state: "SP"
 *           country_iso: "BR"
 *
 *     LoginRequest:
 *       type: object
 *       required:
 *         - email
 *         - password
 *       properties:
 *         email:
 *           type: string
 *           format: email
 *         password:
 *           type: string
 *       example:
 *         email: "joao@email.com"
 *         password: "senha123"
 *
 *     AuthResponse:
 *       type: object
 *       properties:
 *         message:
 *           type: string
 *         token:
 *           type: string
 *         user:
 *           type: object
 *           properties:
 *             id:
 *               type: integer
 *             client_id:
 *               type: integer
 *             name:
 *               type: string
 *             email:
 *               type: string
 *             phone:
 *               type: string
 *             cpf:
 *               type: string
 *             address:
 *               type: object
 *               nullable: true
 *       example:
 *         message: "Login realizado com sucesso"
 *         token: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
 *         user:
 *           id: 1
 *           client_id: 1
 *           name: "João Silva"
 *           email: "joao@email.com"
 *           phone: "11999999999"
 *           cpf: "12345678901"
 *           address:
 *             lat: -23.5505
 *             lng: -46.6333
 *             city: "São Paulo"
 *             state: "SP"
 *             country_iso: "BR"
 *
 *     AvatarUploadRequest:
 *       type: object
 *       required:
 *         - base64Image
 *       properties:
 *         base64Image:
 *           type: string
 *           description: Imagem em formato base64 com prefixo data:image/(png|jpg|jpeg);base64,
 *       example:
 *         base64Image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAA..."
 *
 *     AvatarResponse:
 *       type: object
 *       properties:
 *         message:
 *           type: string
 *         avatar_uri:
 *           type: string
 *       example:
 *         message: "Avatar enviado com sucesso"
 *         avatar_uri: "avatarBucket/1/avatar.png"
 *
 *     AvatarInfo:
 *       type: object
 *       properties:
 *         userId:
 *           type: integer
 *         avatar_uri:
 *           type: string
 *       example:
 *         userId: 1
 *         avatar_uri: "avatarBucket/1/avatar.png"
 *
 *   responses:
 *     NotFound:
 *       description: Recurso não encontrado
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               error:
 *                 type: string
 *             example:
 *               error: "Usuário não encontrado"
 *
 *     ServerError:
 *       description: Erro interno do servidor
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               error:
 *                 type: string
 *             example:
 *               error: "Erro interno do servidor"
 *
 *   parameters:
 *     userIdParam:
 *       in: path
 *       name: id
 *       required: true
 *       schema:
 *         type: integer
 *       description: ID do usuário
 */

/**
 * @swagger
 * /user/login:
 *   post:
 *     summary: Realiza login do usuário
 *     tags: [Authentication]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/LoginRequest'
 *     responses:
 *       200:
 *         description: Login realizado com sucesso
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AuthResponse'
 *       401:
 *         description: Credenciais inválidas
 *       404:
 *         description: Usuário não encontrado
 *       500:
 *         description: Erro no servidor
 */
router.post("/login", logInUser);

/**
 * Change password for authenticated user
 */
router.post("/change-password", authMiddleware, changePassword);

router.get("/me", authMiddleware, getUserByToken);
router.put("/me", authMiddleware, updateUserProfile);

/**
 * @swagger
 * /user/{id}:
 *   get:
 *     summary: Obtém um usuário pelo ID
 *     tags: [Users]
 *     parameters:
 *       - $ref: '#/components/parameters/userIdParam'
 *     responses:
 *       200:
 *         description: Usuário encontrado
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/User'
 *       404:
 *         $ref: '#/components/responses/NotFound'
 *       500:
 *         $ref: '#/components/responses/ServerError'
 */
router.get("/:id", authMiddleware, getUserById);

/**
 * LGPD Location Consent endpoints
 */
router.get("/location-consent", authMiddleware, getLocationConsent);
router.post("/location-consent", authMiddleware, updateLocationConsent);
router.post("/revoke-location-consent", authMiddleware, revokeLocationConsent);

export default router;
