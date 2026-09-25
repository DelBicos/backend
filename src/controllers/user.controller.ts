import bcrypt from "bcryptjs";
import { Request, Response } from "express";
import { AuthenticatedRequest } from "../interfaces/authentication.interface";
import { UserModel } from "../models/User";
import { AddressModel } from "../models/Address";
import { ClientModel } from "../models/Client";
import { ProfessionalModel } from "../models/Professional";
import { generateTokenAndUserPayload } from "../utils/authUtils";
import logger, { logAuth, logError } from "../utils/logger";
import { saveLoginLog } from "../services/loginLog.service";
import { S3Service } from "../services/s3Service";

const s3Service = new S3Service();

export const logInUser = async (req: Request, res: Response): Promise<void> => {
  const { email, password } = req.body as { email: string; password: string };
  
  try {
    console.log("\n🔍 [LOGIN] Iniciando processo de login para:", email);

    const user = await UserModel.findOne({ where: { email } });
    if (!user) {
      logAuth("login", undefined, email, false, "Usuário não encontrado");
      res.status(404).json({ message: "Usuário não encontrado" });
      return;
    }

    console.log("✅ [LOGIN] Usuário encontrado, ID:", user.id);

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      logAuth("login", user.id, email, false, "Senha inválida");
      res.status(401).json({ message: "Senha inválida" });
      return;
    }

    console.log("✅ [LOGIN] Senha válida");

    const client = await ClientModel.findOne({ where: { user_id: user.id } });
    if (!client) {
      logAuth("login", user.id, email, false, "Cliente não encontrado");
      res.status(404).json({ message: "Cliente não encontrado" });
      return;
    }

    console.log("✅ [LOGIN] Cliente encontrado, ID:", client.id);

    const address = await AddressModel.findByPk(client.main_address_id);

    // Buscar professional com query explícita
    console.log(`🔍 [LOGIN] Buscando profissional para user_id: ${user.id}`);
    const professional = await ProfessionalModel.findOne({
      where: { user_id: user.id },
      raw: false,
    });

    console.log("✅ [LOGIN] Professional encontrado:", {
      exists: !!professional,
      data: professional?.toJSON?.() || null,
    });

    const { token, user: userPayload } = generateTokenAndUserPayload(
      user,
      client,
      address
    );

    saveLoginLog(req, {
      userId: user.id,
      username: user.email,
      jwt: token,
    });

    logAuth("login", user.id, email, true);
    logger.info("Login realizado com sucesso", { userId: user.id, email });

    const responseUser: any = {
      ...userPayload,
      professional_id: professional?.id || null,
    };

    // Se houver professional, adicionar objeto completo
    if (professional) {
      responseUser.professional = {
        id: professional.id,
        cpf: professional.cpf,
        cnpj: professional.cnpj,
        description: professional.description,
        main_address_id: professional.main_address_id,
      };
    }

    console.log("📤 [LOGIN] Retornando usuário com professional_id:", responseUser.professional_id);

    res.status(200).json({
      message: "Login realizado com sucesso",
      token: token,
      user: responseUser,
    });
  } catch (error) {
    logError("Erro ao fazer login", error, { email });
    console.error("❌ [LOGIN] Erro:", error);
    res.status(500).json({
      message: "Erro interno do servidor",
      error: error instanceof Error ? error.message : "Erro desconhecido",
    });
  }
};

/** Perfil publico de um usuario; e-mail e telefone apenas para o proprio. */
export const getUserById = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const user = await UserModel.findByPk(req.params.id);
    if (!user) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }
    const isSelf = req.user?.id === user.id;
    res.json({
      id: user.id,
      name: user.name,
      avatar_uri: user.avatar_uri,
      banner_uri: user.banner_uri,
      ...(isSelf ? { email: user.email, phone: user.phone } : {}),
    });
  } catch (error) {
    res.status(500).json({ error: "Erro ao buscar usuário" });
  }
};

export const changePassword = async (
  req: AuthenticatedRequest,
  res: Response
): Promise<void> => {
  const userId = req.user?.id; // Declarado fora para o catch enxergar

  try {
    const { current_password, new_password } = req.body as {
      current_password: string;
      new_password: string;
    };

    if (!current_password || !new_password) {
      res.status(400).json({ message: "Senha atual e nova senha são obrigatórias" });
      return;
    }

    if (!userId) {
      res.status(401).json({ message: "Não autorizado" });
      return;
    }

    const user = await UserModel.findByPk(userId);
    if (!user) {
      res.status(404).json({ message: "Usuário não encontrado" });
      return;
    }

    const isMatch = await bcrypt.compare(current_password, user.password);
    if (!isMatch) {
      logger.warn("Tentativa de mudança de senha com senha incorreta", { userId });
      res.status(400).json({ message: "Senha atual incorreta" });
      return;
    }

    const salt = await bcrypt.genSalt(10);
    const hashed = await bcrypt.hash(new_password, salt);
    user.password = hashed;
    await user.save();

    logger.info("Senha alterada com sucesso", { userId });
    res.status(204).send();
  } catch (error) {
    logError("Erro ao alterar senha", error, { userId });
    res.status(500).json({ message: "Erro interno do servidor" });
  }
};

export const deleteUser = async (req: Request, res: Response) => {
  try {
    const deleted = await UserModel.destroy({ where: { id: req.params.id } });
    deleted
      ? res.json({ message: "Usuário deletado com sucesso" })
      : res.status(404).json({ error: "Usuário não encontrado" });
  } catch (error) {
    res.status(500).json({ error: "Erro ao deletar usuário" });
  }
};

export const getUserByToken = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const userId = req.user?.id; // Declarado fora

  try {
    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const user = await UserModel.findByPk(userId, {
      attributes: ["id", "name", "email", "phone", "avatar_uri", "banner_uri"],
      include: [
        {
          model: ClientModel,
          as: "Client",
          attributes: ["id", "cpf"],
        },
      ],
    });

    if (!user) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    // Buscar professional separadamente para garantir que funciona
    const professional = await ProfessionalModel.findOne({
      where: { user_id: userId },
      raw: false,
    });

    console.log("[DEBUG ME] Professional encontrado:", professional?.toJSON?.() || professional);

    const userData: any = user.toJSON();

    const responseUser = {
      ...userData,
      professional_id: professional?.id || null,
    };

    // Se houver professional, adicionar objeto completo
    if (professional) {
      responseUser.professional = {
        id: professional.id,
        cpf: professional.cpf,
        cnpj: professional.cnpj,
        description: professional.description,
        main_address_id: professional.main_address_id,
      };
    }

    res.status(200).json({ user: responseUser });
  } catch (error: any) {
    logError("Erro ao buscar usuário pelo token", error, { userId });
    res.status(500).json({ error: error.message });
  }
};

export const updateUserProfile = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const userId = req.user?.id; // Declarado fora

  if (!userId) {
    return res.status(401).json({ error: "Usuário não autenticado." });
  }

  const { name, email, phone } = req.body;

  try {
    const user = await UserModel.findByPk(userId);

    if (!user) {
      return res.status(404).json({ error: "Usuário não encontrado." });
    }

    if (email && email !== user.email) {
      const emailExists = await UserModel.findOne({ where: { email } });
      if (emailExists) {
        return res.status(409).json({ error: "Este e-mail já está em uso." });
      }
    }

    if (name) user.name = name;
    if (email) user.email = email;
    if (phone) user.phone = phone;

    await user.save();

    return res.status(200).json({
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      avatar_uri: user.avatar_uri,
      banner_uri: user.banner_uri,
    });
  } catch (error: any) {
    logError("Erro ao atualizar perfil", error, { userId });
    return res.status(500).json({
      error: "Erro interno ao atualizar perfil.",
      details: error.message,
    });
  }
};

/**
 * NOVAS FUNÇÕES PARA PoC S3 (AWS)
 */

export const getAvatarUploadUrl = async (req: Request, res: Response) => {
  try {
    const { fileName, fileType } = req.body;
    if (!fileName || !fileType) {
      return res.status(400).json({ error: "fileName e fileType são obrigatórios" });
    }

    const uploadUrl = await s3Service.generateUploadUrl(fileName, fileType);
    const fileUrl = `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${fileName}`;

    res.json({ uploadUrl, fileUrl });
  } catch (error: any) {
    logError("Erro ao gerar URL do S3", error);
    res.status(500).json({ error: error.message });
  }
};

export const updateUserAvatarUri = async (req: AuthenticatedRequest, res: Response) => {
  const userId = req.user?.id;
  const { avatar_uri } = req.body;

  try {
    if (!avatar_uri) return res.status(400).json({ error: "avatar_uri é obrigatório" });

    const user = await UserModel.findByPk(userId);
    if (!user) return res.status(404).json({ error: "Usuário não encontrado" });

    await user.update({ avatar_uri });
    
    res.json({ 
      message: "URI do avatar atualizada com sucesso!", 
      user: { id: user.id, avatar_uri: user.avatar_uri } 
    });
  } catch (error: any) {
    logError("Erro ao atualizar URI do avatar", error, { userId });
    res.status(500).json({ error: error.message });
  }
};