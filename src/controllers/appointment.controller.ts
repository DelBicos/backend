import { Request, Response } from "express";
import { AppointmentModel } from "../models/Appointment";
import { UserModel } from "../models/User";
import { ClientModel } from "../models/Client";
import { ProfessionalModel } from "../models/Professional";
import { ServiceModel } from "../models/Service";
import { PaymentService } from "../services/payment.service";
import { NotificationModel } from "../models/Notification";
import { AddressModel } from "../models/Address";
import { SubCategoryModel } from "../models/Subcategory";
import { AuthenticatedRequest } from "../interfaces/authentication.interface";
import logger, { logError, logDatabase } from "../utils/logger";
import {
  ensureChatRoomForAppointment,
  syncChatRoomStatusForAppointment,
} from "../utils/chatRoom";
import { syncBotSessionsForAppointmentStatus } from "../services/botAppointmentStatus.service";

const formatDate = (dateStr: string | Date) =>
  new Date(dateStr).toLocaleDateString("pt-BR");

const formatTime = (dateStr: string | Date) =>
  new Date(dateStr).toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });

export const createAppointment = async (req: Request, res: Response) => {
  try {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.user)
      return res.status(401).json({ error: "Usuário não autenticado" });

    // Derivar client_id do token — o usuário autenticado deve ter perfil de cliente
    const clientRecord = await ClientModel.findOne({
      where: { user_id: authReq.user.id },
    });
    if (!clientRecord)
      return res.status(403).json({
        error:
          "Usuário não possui perfil de cliente. Finalize seu cadastro antes de agendar.",
      });

    const {
      service_id,
      professional_id,
      address_id,
      start_time,
      end_time,
      client_lat,
      client_lng,
    } = req.body;

    if (!service_id || !professional_id || !start_time || !end_time) {
      return res.status(400).json({
        error:
          "Campos obrigatórios: service_id, professional_id, start_time, end_time (ou forneça address_id ou client_lat/client_lng)",
      });
    }

    // Regra de antecedência: no mínimo 48 horas (2 dias)
    const startDate = new Date(start_time);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const minAdvanceDate = new Date(today);
    minAdvanceDate.setDate(minAdvanceDate.getDate() + 2);

    if (startDate < minAdvanceDate) {
      return res.status(400).json({
        error: "Os agendamentos precisam ser feitos com no mínimo 48 horas (2 dias) de antecedência.",
      });
    }

    const [professional, service] = await Promise.all([
      ProfessionalModel.findByPk(Number(professional_id), {
        include: [
          {
            model: AddressModel,
            as: "MainAddress",
            attributes: ["lat", "lng"],
          },
        ],
      }),
      ServiceModel.findByPk(Number(service_id)),
    ]);
    if (!professional)
      return res.status(404).json({ error: "Profissional não encontrado" });
    if (!service)
      return res.status(404).json({ error: "Serviço não encontrado" });
    if (!service.active)
      return res.status(400).json({ error: "Serviço não está ativo" });

    // Determina coordenadas do cliente: prioriza client_lat/client_lng, senão address_id
    let clientLat: number | null = null;
    let clientLng: number | null = null;

    if (client_lat !== undefined && client_lng !== undefined) {
      const latN = parseFloat(String(client_lat));
      const lngN = parseFloat(String(client_lng));
      if (!Number.isFinite(latN) || !Number.isFinite(lngN)) {
        return res
          .status(400)
          .json({ error: "client_lat e client_lng inválidos" });
      }
      clientLat = latN;
      clientLng = lngN;
    } else if (address_id) {
      const clientAddress = await AddressModel.findByPk(Number(address_id));
      if (!clientAddress)
        return res
          .status(404)
          .json({ error: "Endereço do cliente não encontrado" });
      if (clientAddress.lat && clientAddress.lng) {
        clientLat = Number(clientAddress.lat);
        clientLng = Number(clientAddress.lng);
      }
    }

    const computeDistanceKm = (
      lat1: number,
      lon1: number,
      lat2: number,
      lon2: number,
    ) => {
      const toRad = (x: number) => (x * Math.PI) / 180;
      const R = 6371;
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) *
          Math.cos(toRad(lat2)) *
          Math.sin(dLon / 2) *
          Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    };

    const profData = professional as any;
    if (
      profData?.MainAddress &&
      clientLat !== null &&
      clientLng !== null &&
      professional.service_radius_km
    ) {
      const profLat = Number(profData.MainAddress.lat);
      const profLng = Number(profData.MainAddress.lng);
      if (
        Number.isFinite(profLat) &&
        Number.isFinite(profLng) &&
        Number.isFinite(clientLat) &&
        Number.isFinite(clientLng)
      ) {
        const dist = computeDistanceKm(profLat, profLng, clientLat, clientLng);
        if (dist > Number(professional.service_radius_km)) {
          return res.status(400).json({
            error:
              "O endereço do cliente está fora do raio de atuação do profissional",
          });
        }
      }
    }

    const appointment = await AppointmentModel.create({
      professional_id: Number(professional_id),
      client_id: clientRecord.id,
      service_id: Number(service_id),
      address_id: Number(address_id),
      start_time: new Date(start_time),
      end_time: new Date(end_time),
      status: "pending",
    });

    // Cria automaticamente a sala de chat para este agendamento
    await ensureChatRoomForAppointment(appointment);

    const client = clientRecord;
    // professional e service já foram buscados acima via Promise.all

    if (!professional || !client || !service) {
      logger.warn("Missing linked data for notification trigger", {
        appointmentId: appointment.id,
      });
    } else {
      const clientUser = await UserModel.findByPk(client.user_id);
      const professionalUser = await UserModel.findByPk(professional.user_id);

      const appointmentTime = appointment.start_time.toLocaleTimeString(
        "pt-BR",
        {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        },
      );
      const appointmentDate =
        appointment.start_time.toLocaleDateString("pt-BR");

      if (professionalUser) {
        await NotificationModel.create({
          user_id: professionalUser.id,
          title: "Novo Agendamento Recebido",
          message: `Você recebeu um novo agendamento de ${
            clientUser?.name || "Cliente Desconhecido"
          } para o serviço '${
            service.title
          }' no dia ${appointmentDate} às ${appointmentTime}. Status: Pendente de Confirmação.`,
          notification_type: "appointment",
          related_entity_id: appointment.id,
          is_read: false,
        });
      }

      if (clientUser) {
        await NotificationModel.create({
          user_id: clientUser.id,
          title: "Agendamento Criado com Sucesso",
          message: `Seu agendamento para o serviço '${service.title}' no dia ${appointmentDate} às ${appointmentTime} foi criado. Aguardando confirmação do profissional.`,
          notification_type: "appointment",
          related_entity_id: appointment.id,
          is_read: false,
        });
      }
    }
    logger.info("Appointment criado com sucesso", {
      appointmentId: appointment.id,
      clientId: appointment.client_id,
      professionalId: appointment.professional_id,
    });
    res.status(201).json(appointment);
  } catch (error: any) {
    logError("Erro ao criar appointment", error);
    res.status(400).json({ error: error.message });
  }
};

/**
 * Busca todos os agendamentos associados a um usuário específico.
 *
 * Suporta filtragem por perfil (`role` query param: 'client' ou 'professional').
 * Popula todas as associações necessárias para exibição completa na visão do cliente e do prestador:
 * - `Service` com sua respetiva `Subcategory`
 * - `Client` e `Professional` com dados de perfil do usuário (`name`, `avatar_uri`, `phone`, `email`)
 * - `Address` completo do local de atendimento (`street`, `number`, `complement`, `neighborhood`, `city`, `state`, `postal_code`)
 * - Campo computado `payment_method` ("Cartão de Crédito")
 *
 * @param req Request do Express contendo o ID do usuário em `req.params.id` e filtro opcional `role` em `req.query`.
 * @param res Response do Express retornando a lista de agendamentos formatados em formato JSON.
 */
export const getAllAppointments = async (req: Request, res: Response) => {
  const userId = req.params.id;
  const { role } = req.query;

  try {
    const user = await UserModel.findByPk(userId);
    if (!user) {
      return res.status(404).json({ error: "Usuário não encontrado" });
    }

    const client = await ClientModel.findOne({ where: { user_id: userId } });
    const professional = await ProfessionalModel.findOne({ where: { user_id: userId } });

    let whereClause: any = {};

    if (role === "client") {
      if (!client) return res.json([]);
      whereClause.client_id = client.id;
    } else if (role === "professional") {
      if (!professional) return res.json([]);
      whereClause.professional_id = professional.id;
    } else {
      if (client && professional) {
        whereClause = {
          [require('sequelize').Op.or]: [
            { client_id: client.id },
            { professional_id: professional.id }
          ]
        };
      } else if (client) {
        whereClause.client_id = client.id;
      } else if (professional) {
        whereClause.professional_id = professional.id;
      } else {
        return res.json([]);
      }
    }

    const appointments = await AppointmentModel.findAll({
      where: whereClause,
      include: [
        {
          model: ServiceModel,
          as: "Service",
          include: [{ model: SubCategoryModel, as: "Subcategory" }],
        },
        {
          model: ClientModel,
          as: "Client",
          include: [
            {
              model: UserModel,
              as: "User",
              attributes: ["name", "avatar_uri", "phone", "email"],
            },
          ],
        },
        {
          model: ProfessionalModel,
          as: "Professional",
          include: [
            {
              model: UserModel,
              as: "User",
              attributes: ["name", "avatar_uri", "phone", "email"],
            },
          ],
        },
        {
          model: AddressModel,
          as: "Address",
        },
      ],
      order: [["start_time", "ASC"]],
    });

    const formattedAppointments = appointments.map((apt: any) => {
      const json = apt.toJSON();
      json.payment_method = json.payment_intent_id
        ? "Cartão de Crédito"
        : "Cartão de Crédito";
      return json;
    });

    res.json(formattedAppointments);
  } catch (error: any) {
    logError("Erro ao buscar appointments", error, { userId });
    res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const confirmAppointment = async (req: Request, res: Response) => {
  const { id } = req.params;
  try {
    const authReq = req as AuthenticatedRequest;
    const appointment = await AppointmentModel.findByPk(id);
    if (!appointment) {
      return res.status(404).json({ error: "Agendamento não encontrado" });
    }
    if (appointment.status !== "pending") {
      return res.status(400).json({
        error: `Não é possível aceitar um agendamento com status '${appointment.status}'`,
      });
    }
    const professional = await ProfessionalModel.findByPk(appointment.professional_id);
    if (!authReq.user || professional?.user_id !== authReq.user.id) {
      return res.status(403).json({
        error: "Apenas o profissional respons\u00e1vel pode aceitar este agendamento",
      });
    }

    appointment.status = "confirmed";
    await appointment.save();
    await syncBotSessionsForAppointmentStatus(appointment);
    logger.info("Appointment confirmado", { appointmentId: id });
    res.json(appointment);
  } catch (error: any) {
    logError("Erro ao confirmar agendamento", error, { appointmentId: id });
    res.status(500).json({ error: "Erro ao confirmar agendamento" });
  }
};

export const updateAppointmentStatus = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { status } = req.body;
  const authReq = req as AuthenticatedRequest;

  try {
    if (status !== "confirmed" && status !== "canceled") {
      return res.status(400).json({ error: "Status inválido. Use 'confirmed' ou 'canceled'." });
    }

    const appointment = await AppointmentModel.findByPk(id, {
      include: [
        { model: ClientModel, as: "Client", include: [{ model: UserModel, as: "User" }] },
        { model: ProfessionalModel, as: "Professional", include: [{ model: UserModel, as: "User" }] },
        { model: ServiceModel, as: "Service" },
      ],
    });

    if (!appointment) {
      return res.status(404).json({ error: "Agendamento não encontrado" });
    }

    const appointmentProfessional = (appointment as any).Professional;
    if (!authReq.user || appointmentProfessional?.user_id !== authReq.user.id) {
      return res.status(403).json({
        error: "Apenas o profissional respons\u00e1vel pode alterar este agendamento",
      });
    }

    if (appointment.status !== "pending") {
      return res.status(400).json({
        error: `Não é possível alterar um agendamento com status '${appointment.status}'`,
      });
    }

    appointment.status = status;
    await appointment.save();

    // Arquiva a sala de chat caso o agendamento seja cancelado
    await syncChatRoomStatusForAppointment(appointment.id, status);

    const apptData: any = appointment;
    const clientUser = apptData.Client?.User;
    const service = apptData.Service;

    if (clientUser) {
      if (status === "confirmed") {
        await NotificationModel.create({
          user_id: clientUser.id,
          title: "Seu agendamento foi aceito!",
          message: `O profissional aceitou seu agendamento para o serviço '${service?.title}'.`,
          notification_type: "appointment",
          related_entity_id: appointment.id,
          is_read: false,
        });
      } else if (status === "canceled") {
        await NotificationModel.create({
          user_id: clientUser.id,
          title: "Agendamento Recusado",
          message: `O profissional não pôde aceitar o serviço '${service?.title}'.`,
          notification_type: "appointment",
          related_entity_id: appointment.id,
          is_read: false,
        });
      }
    }

    await syncBotSessionsForAppointmentStatus(appointment);

    logger.info(`Appointment status updated to ${status}`, { appointmentId: id });
    res.json(appointment);
  } catch (error: any) {
    logError("Erro ao atualizar status do agendamento", error, { appointmentId: id });
    res.status(500).json({ error: "Erro ao atualizar status do agendamento" });
  }
};


export const reviewAppointment = async (req: Request, res: Response) => {
  const { id } = req.params;
  const { rating, review } = req.body;
  const authReq = req as AuthenticatedRequest;

  try {
    if (!rating) {
      return res.status(400).json({
        error: "O campo 'rating' é obrigatório",
      });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({
        error: "A avaliação deve estar entre 1 e 5",
      });
    }

    if (review && review.length > 500) {
      return res.status(400).json({
        error: "O comentário deve ter no máximo 500 caracteres",
      });
    }

    const appointment = await AppointmentModel.findByPk(id, {
      include: [
        {
          model: ClientModel,
          as: "Client",
          include: [{ model: UserModel, as: "User" }],
        },
      ],
    });

    if (!appointment) {
      return res.status(404).json({ error: "Agendamento não encontrado" });
    }

    if (appointment.status !== "completed") {
      return res.status(400).json({
        error: `Não é possível avaliar um agendamento com status '${appointment.status}'`,
      });
    }

    const authenticatedUserId = authReq.user?.id;
    if (!authenticatedUserId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const apptData: any = appointment;
    const clientUserId = apptData.Client?.User?.id;

    if (clientUserId !== authenticatedUserId) {
      return res.status(403).json({
        error: "Você não tem permissão para avaliar este agendamento",
      });
    }

    const isUpdate =
      appointment.rating !== null && appointment.rating !== undefined;

    appointment.rating = rating;
    appointment.review = review || null;
    await appointment.save();

    if (!isUpdate) {
      const professional = await ProfessionalModel.findByPk(
        appointment.professional_id,
      );
      if (professional) {
        const professionalUser = await UserModel.findByPk(professional.user_id);
        const service = await ServiceModel.findByPk(appointment.service_id);

        if (professionalUser) {
          await NotificationModel.create({
            user_id: professionalUser.id,
            title: "Nova Avaliação Recebida",
            message: `Você recebeu uma avaliação de ${rating} estrelas${
              service ? ` para o serviço '${service.title}'` : ""
            }${review ? `: "${review}"` : "."}`,
            notification_type: "service",
            related_entity_id: appointment.id,
            is_read: false,
          });
        }
      }
    }

    res.json({
      success: true,
      message: isUpdate
        ? "Avaliação atualizada com sucesso"
        : "Avaliação registrada com sucesso",
    });
  } catch (error: any) {
    console.error(error);
    res.status(500).json({ error: "Erro ao avaliar agendamento" });
  }
};

export const getAppointmentInvoice = async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;

  try {
    const appointmentId = Number(req.params.id);
    const authenticatedUserId = authReq.user?.id;

    if (!authenticatedUserId) {
      return res.status(401).json({ error: "Usuário não autenticado." });
    }
    if (isNaN(appointmentId)) {
      return res.status(400).json({ error: "ID do agendamento inválido." });
    }

    const client = await ClientModel.findOne({
      where: { user_id: authenticatedUserId },
    });
    if (!client) {
      return res.status(404).json({ error: "Cliente não encontrado." });
    }

    const appointment = await AppointmentModel.findOne({
      where: {
        id: appointmentId,
        client_id: client.id,
      },
      include: [
        {
          model: ServiceModel,
          as: "Service",
          include: [{ model: SubCategoryModel, as: "Subcategory" }],
        },
        {
          model: ClientModel,
          as: "Client",
          include: [{ model: UserModel, as: "User" }],
        },
        {
          model: ProfessionalModel,
          as: "Professional",
          include: [{ model: UserModel, as: "User" }],
        },
        {
          model: AddressModel,
          as: "Address",
        },
      ],
    });

    if (!appointment) {
      return res.status(404).json({
        error: "Agendamento não encontrado ou não pertence a este usuário.",
      });
    }

    const apptData: any = appointment;

    const invoice = {
      invoiceNumber: `NF${appointment.id.toString().padStart(6, "0")}`,
      date: formatDate(appointment.createdAt),

      customerName: apptData.Client?.User?.name || "Cliente não encontrado",
      customerCpf: apptData.Client?.cpf || "CPF não encontrado",
      customerAddress: apptData.Address
        ? `${apptData.Address.street}, ${apptData.Address.number} - ${apptData.Address.neighborhood} - ${apptData.Address.city}/${apptData.Address.state}`
        : "Endereço não fornecido",

      professionalName:
        apptData.Professional?.User?.name || "Profissional não encontrado",
      professionalCpf: apptData.Professional?.cpf || "CPF/CNPJ não encontrado",

      serviceName: apptData.Service?.title || "Serviço não encontrado",
      serviceDescription: apptData.Service?.description || "",
      servicePrice: parseFloat(apptData.Service?.price || "0"),

      serviceDate: formatDate(appointment.start_time),
      serviceTime: `${formatTime(appointment.start_time)} - ${formatTime(
        appointment.end_time,
      )}`,

      total: parseFloat(apptData.Service?.price || "0"),

      paymentMethod: "Cartão de Crédito",
      transactionId: appointment.payment_intent_id || "N/A",
    };

    res.json(invoice);
  } catch (error: any) {
    console.error("Erro ao gerar invoice:", error);
    res
      .status(500)
      .json({ error: "Erro ao gerar invoice", details: error.message });
  }
};
