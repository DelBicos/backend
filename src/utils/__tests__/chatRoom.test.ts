jest.mock("../../config/database");
jest.mock("../logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
}));
jest.mock("../../models/ChatRoom", () => ({
  ChatRoomModel: {
    findOrCreate: jest.fn(),
    update: jest.fn(),
    findByPk: jest.fn(),
  },
}));
jest.mock("../../models/Appointment", () => ({
  AppointmentModel: { findAll: jest.fn(), findByPk: jest.fn() },
}));
jest.mock("../../models/Client", () => ({ ClientModel: { findOne: jest.fn() } }));
jest.mock("../../models/Professional", () => ({
  ProfessionalModel: { findOne: jest.fn() },
}));

import { Op } from "sequelize";
import { AppointmentModel } from "../../models/Appointment";
import { ChatRoomModel } from "../../models/ChatRoom";
import { ClientModel } from "../../models/Client";
import { ProfessionalModel } from "../../models/Professional";
import {
  archiveChatRoomForAppointment,
  ensureChatRoomForAppointment,
  getAppointmentForRoom,
  syncChatRoomStatusForAppointment,
  syncChatRoomsForUser,
} from "../chatRoom";
import logger from "../logger";

const mocked = (fn: unknown) => fn as jest.Mock;

const appointment = {
  id: 10,
  professional_id: 2,
  client_id: 3,
  service_id: 4,
};

describe("ensureChatRoomForAppointment", () => {
  it("cria ou reaproveita a sala do agendamento", async () => {
    const room = { id: 1 };
    mocked(ChatRoomModel.findOrCreate).mockResolvedValue([room, true]);

    await expect(ensureChatRoomForAppointment(appointment)).resolves.toBe(room);
    expect(ChatRoomModel.findOrCreate).toHaveBeenCalledWith({
      where: { appointment_id: 10 },
      defaults: {
        appointment_id: 10,
        professional_id: 2,
        client_id: 3,
        service_id: 4,
        status: "active",
      },
    });
  });

  it("devolve null e registra o erro sem lançar", async () => {
    mocked(ChatRoomModel.findOrCreate).mockRejectedValue(new Error("db fora"));

    await expect(ensureChatRoomForAppointment(appointment)).resolves.toBeNull();
    expect(logger.error).toHaveBeenCalledWith(
      "Erro ao garantir sala de chat para agendamento",
      expect.objectContaining({ appointmentId: 10 }),
    );
  });
});

describe("archiveChatRoomForAppointment", () => {
  it("arquiva a sala do agendamento", async () => {
    mocked(ChatRoomModel.update).mockResolvedValue([1]);
    await archiveChatRoomForAppointment(10);
    expect(ChatRoomModel.update).toHaveBeenCalledWith(
      { status: "archived" },
      { where: { appointment_id: 10 } },
    );
  });

  it("registra o erro sem lançar", async () => {
    mocked(ChatRoomModel.update).mockRejectedValue(new Error("db fora"));
    await expect(archiveChatRoomForAppointment(10)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      "Erro ao arquivar sala de chat do agendamento",
      expect.objectContaining({ appointmentId: 10 }),
    );
  });
});

describe("syncChatRoomStatusForAppointment", () => {
  it.each(["completed", "canceled", "no_show"])(
    "arquiva a sala quando o agendamento fica %s",
    async (status) => {
      mocked(ChatRoomModel.update).mockResolvedValue([1]);
      await syncChatRoomStatusForAppointment(10, status);
      expect(ChatRoomModel.update).toHaveBeenCalledWith(
        { status: "archived" },
        { where: { appointment_id: 10 } },
      );
    },
  );

  it.each(["pending", "confirmed", "in_progress"])(
    "mantém a sala ativa quando o agendamento fica %s",
    async (status) => {
      await syncChatRoomStatusForAppointment(10, status);
      expect(ChatRoomModel.update).not.toHaveBeenCalled();
    },
  );
});

describe("syncChatRoomsForUser", () => {
  it("não consulta agendamentos de usuário sem perfil", async () => {
    mocked(ClientModel.findOne).mockResolvedValue(null);
    mocked(ProfessionalModel.findOne).mockResolvedValue(null);

    await syncChatRoomsForUser(1);

    expect(AppointmentModel.findAll).not.toHaveBeenCalled();
  });

  it("cria salas para os agendamentos do cliente e do profissional e arquiva os finalizados", async () => {
    mocked(ClientModel.findOne).mockResolvedValue({ id: 3 });
    mocked(ProfessionalModel.findOne).mockResolvedValue({ id: 2 });
    mocked(ChatRoomModel.findOrCreate).mockResolvedValue([{ id: 1 }, true]);
    mocked(ChatRoomModel.update).mockResolvedValue([1]);
    mocked(AppointmentModel.findAll).mockResolvedValue([
      { ...appointment, id: 10, status: "completed" },
      { ...appointment, id: 11, status: "confirmed" },
      { ...appointment, id: 12 },
    ]);

    await syncChatRoomsForUser(1);

    expect(ClientModel.findOne).toHaveBeenCalledWith({ where: { user_id: 1 } });
    expect(mocked(AppointmentModel.findAll).mock.calls[0][0].where).toEqual({
      [Op.or]: [{ client_id: 3 }, { professional_id: 2 }],
    });
    expect(ChatRoomModel.findOrCreate).toHaveBeenCalledTimes(3);
    expect(ChatRoomModel.update).toHaveBeenCalledTimes(1);
    expect(ChatRoomModel.update).toHaveBeenCalledWith(
      { status: "archived" },
      { where: { appointment_id: 10 } },
    );
  });

  it("processa os agendamentos em lotes de 20", async () => {
    mocked(ClientModel.findOne).mockResolvedValue(null);
    mocked(ProfessionalModel.findOne).mockResolvedValue({ id: 2 });
    mocked(ChatRoomModel.findOrCreate).mockResolvedValue([{ id: 1 }, true]);
    const many = Array.from({ length: 45 }, (_, index) => ({
      ...appointment,
      id: index + 1,
    }));
    mocked(AppointmentModel.findAll).mockResolvedValue(many);

    await syncChatRoomsForUser(1);

    expect(mocked(AppointmentModel.findAll).mock.calls[0][0].where).toEqual({
      [Op.or]: [{ professional_id: 2 }],
    });
    expect(ChatRoomModel.findOrCreate).toHaveBeenCalledTimes(45);
  });

  it("registra o erro sem lançar quando a consulta falha", async () => {
    mocked(ClientModel.findOne).mockRejectedValue(new Error("db fora"));
    mocked(ProfessionalModel.findOne).mockResolvedValue(null);

    await expect(syncChatRoomsForUser(1)).resolves.toBeUndefined();
    expect(logger.error).toHaveBeenCalledWith(
      "Erro ao sincronizar salas de chat do usuário",
      expect.objectContaining({ userId: 1 }),
    );
  });
});

describe("getAppointmentForRoom", () => {
  it("devolve null quando a sala não existe", async () => {
    mocked(ChatRoomModel.findByPk).mockResolvedValue(null);
    await expect(getAppointmentForRoom(5)).resolves.toBeNull();
    expect(AppointmentModel.findByPk).not.toHaveBeenCalled();
  });

  it("busca o agendamento da sala", async () => {
    const found = { id: 10 };
    mocked(ChatRoomModel.findByPk).mockResolvedValue({ appointment_id: 10 });
    mocked(AppointmentModel.findByPk).mockResolvedValue(found);
    await expect(getAppointmentForRoom(5)).resolves.toBe(found);
    expect(AppointmentModel.findByPk).toHaveBeenCalledWith(10);
  });
});
