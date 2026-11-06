import { Response } from "express";
import { AuthenticatedRequest } from "../interfaces/authentication.interface";
import { AddressModel } from "../models/Address";
import { ClientModel } from "../models/Client";

import { logError } from "../utils/logger";
import { errorMessage } from "../utils/errors.util";
import type { CreationAttributes } from "sequelize";
import { bodyOf } from "../utils/requestBody.util";
/** Rota legada: exige JWT e so retorna os enderecos do proprio usuario. */
export const getAllAddressByUserId = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "Unauthorized" });
    if (Number(req.params.userId) !== userId) {
      return res.status(403).json({ error: "Ação não permitida" });
    }

    const addresses = await AddressModel.findAll({
      where: {
        user_id: userId,
        active: true,
      },
      order: [["createdAt", "DESC"]],
    });

    res.json(addresses);
  } catch (error) {
    logError("Erro ao buscar endereços:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const getAddressesForAuthenticatedUser = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const client = await ClientModel.findOne({ where: { user_id: userId } });
    const mainAddressId = client?.main_address_id;

    const addresses = await AddressModel.findAll({
      where: { user_id: userId },
      order: [["created_at", "DESC"]],
    });

    const addressesWithPrimaryFlag = addresses.map((addr) => {
      const addrJSON = addr.toJSON();
      return {
        ...addrJSON,
        isPrimary: addr.id === mainAddressId,
      };
    });

    res.json(addressesWithPrimaryFlag);
  } catch (error) {
    logError("Erro ao buscar endereços do usuário autenticado:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const createAddressForAuthenticatedUser = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const { id, user_id, isPrimary, ...fields } = bodyOf(req);
    const payload = { ...fields, user_id: userId };
    const address = await AddressModel.create(payload as unknown as CreationAttributes<AddressModel>);
    res.status(201).json(address);
  } catch (error) {
    logError("Erro ao criar endereço para usuário autenticado:", error);
    res.status(400).json({ error: errorMessage(error) });
  }
};

export const updateAddressForAuthenticatedUser = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const addressId = Number(req.params.id);
  if (!addressId || Number.isNaN(addressId)) {
    res.status(400).json({ error: "ID de endereço inválido" });
    return;
  }

  try {
    const address = await AddressModel.findByPk(addressId);
    if (!address) {
      res.status(404).json({ error: "Endereço não encontrado" });
      return;
    }

    if (address.user_id !== userId) {
      res.status(403).json({ error: "Ação não permitida" });
      return;
    }

    const { user_id, id, isPrimary, ...updatable } = bodyOf(req);

    await address.update(updatable as Partial<CreationAttributes<AddressModel>>);

    if (isPrimary === true) {
      const client = await ClientModel.findOne({ where: { user_id: userId } });
      if (client) {
        await client.update({ main_address_id: address.id });
      }
    }
    res.json(address);
  } catch (error) {
    logError("Erro ao atualizar endereço do usuário autenticado:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const deleteAddressForAuthenticatedUser = async (
  req: AuthenticatedRequest,
  res: Response
) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const addressId = Number(req.params.id);
  if (!addressId || Number.isNaN(addressId)) {
    res.status(400).json({ error: "ID de endereço inválido" });
    return;
  }

  try {
    const address = await AddressModel.findByPk(addressId);
    if (!address) {
      res.status(404).json({ error: "Endereço não encontrado" });
      return;
    }

    if (address.user_id !== userId) {
      res.status(403).json({ error: "Ação não permitida" });
      return;
    }

    await address.destroy();
    res.json({ message: "Endereço deletado" });
  } catch (error) {
    logError("Erro ao deletar endereço do usuário autenticado:", error);
    res.status(500).json({ error: "Erro interno do servidor" });
  }
};
