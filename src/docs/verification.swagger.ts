/**
 * Documentacao OpenAPI da verificacao de conta (MFA por e-mail e identidade).
 */

/**
 * @swagger
 * tags:
 *   name: Verification
 *   description: Verificação da conta (duas etapas por e-mail e identidade do profissional)
 */

/**
 * @swagger
 * /api/verification/status:
 *   get:
 *     summary: Situação da verificação da conta autenticada
 *     tags: [Verification]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200:
 *         description: e-mail, MFA e pedido de identidade (quando profissional)
 */

/**
 * @swagger
 * /api/verification/mfa/enable:
 *   post:
 *     summary: Envia o código para ativar a verificação em duas etapas
 *     tags: [Verification]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Código enviado ao e-mail da conta }
 *       409: { description: Já está ativa }
 *       502: { description: Falha no envio do e-mail }
 */

/**
 * @swagger
 * /api/verification/mfa/confirm:
 *   post:
 *     summary: Confirma o código e ativa a verificação em duas etapas
 *     tags: [Verification]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [code]
 *             properties:
 *               code: { type: string }
 *     responses:
 *       200: { description: Ativada }
 *       400: { description: Código inválido }
 *       404: { description: Código expirado }
 *       429: { description: Tentativas esgotadas }
 */

/**
 * @swagger
 * /api/verification/mfa/disable:
 *   post:
 *     summary: Desativa a verificação em duas etapas (exige a senha)
 *     tags: [Verification]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [password]
 *             properties:
 *               password: { type: string }
 *     responses:
 *       200: { description: Desativada }
 *       400: { description: Senha incorreta }
 */

/**
 * @swagger
 * /api/verification/identity/upload-url:
 *   post:
 *     summary: URL assinada para enviar um arquivo do pedido (armazenamento privado)
 *     tags: [Verification]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [kind, fileType]
 *             properties:
 *               kind: { type: string, enum: [front, back, selfie] }
 *               fileType: { type: string, example: image/jpeg }
 *     responses:
 *       200: { description: "key, uploadUrl e uploadHeaders" }
 *       403: { description: Somente profissionais }
 *       503: { description: Armazenamento seguro indisponível }
 */

/**
 * @swagger
 * /api/verification/identity:
 *   post:
 *     summary: Envia o pedido de verificação de identidade para análise
 *     tags: [Verification]
 *     security: [{ bearerAuth: [] }]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [document_type, front_key, selfie_key]
 *             properties:
 *               document_type: { type: string, enum: [rg, cnh] }
 *               front_key: { type: string }
 *               back_key: { type: string }
 *               selfie_key: { type: string }
 *     responses:
 *       201: { description: Pedido em análise }
 *       409: { description: Já verificado ou já existe pedido em análise }
 */

/**
 * @swagger
 * /api/admin/verifications:
 *   get:
 *     summary: Pedidos de verificação (administrador)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [pending, approved, rejected, all] }
 *     responses:
 *       200: { description: Lista com links de leitura temporários dos pedidos pendentes }
 */

/**
 * @swagger
 * /api/admin/verifications/{id}/review:
 *   post:
 *     summary: Aprova ou recusa um pedido de verificação (administrador)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [decision]
 *             properties:
 *               decision: { type: string, enum: [approve, reject] }
 *               reason: { type: string, description: Obrigatório ao recusar }
 *     responses:
 *       200: { description: Decisão registrada }
 *       409: { description: Já analisado }
 */

/**
 * @swagger
 * /api/admin/stats:
 *   get:
 *     summary: Indicadores do painel administrativo
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: year
 *         schema: { type: integer }
 *     responses:
 *       200: { description: KPIs, filas de pendências e séries mensais do ano }
 */

/**
 * @swagger
 * /api/admin/disputes:
 *   get:
 *     summary: Disputas dos clientes (administrador)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema: { type: string, enum: [open, resolved] }
 *     responses:
 *       200: { description: Lista de disputas }
 */

/**
 * @swagger
 * /api/admin/disputes/{id}/resolve:
 *   post:
 *     summary: Decide uma disputa (reembolso total, parcial ou recusa)
 *     tags: [Admin]
 *     security: [{ bearerAuth: [] }]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: integer }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [resolution]
 *             properties:
 *               resolution: { type: string, enum: [refund_full, refund_partial, rejected] }
 *               refundCents: { type: integer }
 *               note: { type: string }
 *     responses:
 *       200: { description: Disputa resolvida }
 */

export {};
