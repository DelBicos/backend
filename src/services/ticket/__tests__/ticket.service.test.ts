const mockTicketFindOne = jest.fn();
const mockTicketFindAll = jest.fn();
const mockTicketCreate = jest.fn();
const mockProfessionalFindOne = jest.fn();
const mockAdminFindOne = jest.fn();
const mockAppointmentFindOne = jest.fn();
const mockMessageFindAll = jest.fn();
const mockGenerateCode = jest.fn();
const mockMessageCreate = jest.fn();
const mockMessageFindByPk = jest.fn();
const mockTransaction = { LOCK: { UPDATE: "UPDATE" } };

jest.mock("../../../config/database", () => ({
  sequelize: {
    transaction: jest.fn(async (work: (t: unknown) => unknown) => work(mockTransaction)),
  },
}));
jest.mock("../../../models/Ticket", () => ({
  __esModule: true,
  default: { findOne: mockTicketFindOne, findAll: mockTicketFindAll, create: mockTicketCreate },
}));
jest.mock("../../../models/TicketMessage", () => ({
  __esModule: true,
  default: { findAll: mockMessageFindAll, create: mockMessageCreate, findByPk: mockMessageFindByPk },
}));
jest.mock("../../../models/Professional", () => ({ ProfessionalModel: { findOne: mockProfessionalFindOne } }));
jest.mock("../../../models/Admin", () => ({ AdminModel: { findOne: mockAdminFindOne } }));
jest.mock("../../../models/Appointment", () => ({ AppointmentModel: { findOne: mockAppointmentFindOne } }));
jest.mock("../../../models/User", () => ({ UserModel: { name: "UserModel" } }));
jest.mock("../../../utils/ticketCode", () => ({ generateTicketCode: mockGenerateCode }));

import { HttpError } from "../../../errors/HttpError";
import {
  addMessageToTicket,
  createTicket,
  findTicketByIdForUser,
  isAdmin,
  listMessagesByTicket,
  listTicketsByUser,
  openTicketFromChat,
  resolveUserType,
  TicketOpeningNotAllowedError,
} from "../ticket.service";
import type { CreateTicketInput } from "../../../middlewares/ticket.validation";

const input: CreateTicketInput = {
  title: "Erro ao agendar serviço",
  description: "Não consigo agendar um serviço de limpeza para amanhã.",
  category: "AGENDAMENTO",
  priority: "ALTA",
};

const createdTicket = () => ({ id: 42, reload: jest.fn().mockResolvedValue(undefined) });

beforeEach(() => {
  jest.clearAllMocks();
  mockGenerateCode.mockReturnValue("TKT-AAAA");
  mockTicketFindOne.mockResolvedValue(null);
  mockTicketCreate.mockImplementation(async () => createdTicket());
});

describe("ticket.service resolveUserType / isAdmin (TICKET-02)", () => {
  it("classifica como PRESTADOR quem tem registro em professional", async () => {
    mockProfessionalFindOne.mockResolvedValue({ id: 5 });
    await expect(resolveUserType(7)).resolves.toBe("PRESTADOR");
    expect(mockProfessionalFindOne).toHaveBeenCalledWith({ where: { user_id: 7 } });
  });

  it("classifica como CLIENTE quem não tem registro em professional", async () => {
    mockProfessionalFindOne.mockResolvedValue(null);
    await expect(resolveUserType(7)).resolves.toBe("CLIENTE");
  });

  it("identifica administrador pela tabela admin", async () => {
    mockAdminFindOne.mockResolvedValueOnce({ id: 1 }).mockResolvedValueOnce(null);
    await expect(isAdmin(3)).resolves.toBe(true);
    await expect(isAdmin(4)).resolves.toBe(false);
    expect(mockAdminFindOne).toHaveBeenCalledWith({ where: { user_id: 3 } });
  });
});

describe("ticket.service createTicket (TICKET-01 / TICKET-02)", () => {
  it("grava título, descrição, categoria e prioridade com status ABERTO", async () => {
    const ticket = await createTicket(input, 7, "CLIENTE");

    expect(mockTicketCreate).toHaveBeenCalledWith({
      ticket_code: "TKT-AAAA",
      title: input.title,
      description: input.description,
      category: "AGENDAMENTO",
      priority: "ALTA",
      status: "ABERTO",
      user_id: 7,
      user_type: "CLIENTE",
      appointment_id: null,
    });
    expect(ticket.reload).toHaveBeenCalled();
    expect(mockAppointmentFindOne).not.toHaveBeenCalled();
  });

  it("grava o user_type recebido (PRESTADOR)", async () => {
    await createTicket({ ...input, priority: "BAIXA" }, 9, "PRESTADOR");
    expect(mockTicketCreate).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 9, user_type: "PRESTADOR", priority: "BAIXA" }),
    );
  });

  it("converte appointment_short_id no id numérico do agendamento", async () => {
    mockAppointmentFindOne.mockResolvedValue({ id: 31 });

    await createTicket({ ...input, appointment_short_id: "6BDOKZ" }, 7, "CLIENTE");

    expect(mockAppointmentFindOne).toHaveBeenCalledWith({
      where: { short_id: "6BDOKZ" },
      attributes: ["id"],
    });
    expect(mockTicketCreate).toHaveBeenCalledWith(expect.objectContaining({ appointment_id: 31 }));
  });

  it("recusa agendamento inexistente com erro 400 e não grava", async () => {
    mockAppointmentFindOne.mockResolvedValue(null);

    await expect(createTicket({ ...input, appointment_short_id: "NAOEXI" }, 7, "CLIENTE")).rejects.toMatchObject({
      message: "Agendamento com código NAOEXI não encontrado.",
      status: 400,
    });
    await expect(
      createTicket({ ...input, appointment_short_id: "NAOEXI" }, 7, "CLIENTE"),
    ).rejects.toBeInstanceOf(HttpError);
    expect(mockTicketCreate).not.toHaveBeenCalled();
  });

  it("sorteia outro código enquanto o gerado já existir", async () => {
    mockGenerateCode
      .mockReturnValueOnce("TKT-AAAA")
      .mockReturnValueOnce("TKT-BBBB")
      .mockReturnValueOnce("TKT-CCCC");
    mockTicketFindOne
      .mockResolvedValueOnce({ id: 1 })
      .mockResolvedValueOnce({ id: 2 })
      .mockResolvedValueOnce(null);

    await createTicket(input, 7, "CLIENTE");

    expect(mockGenerateCode).toHaveBeenCalledTimes(3);
    expect(mockTicketCreate).toHaveBeenCalledWith(expect.objectContaining({ ticket_code: "TKT-CCCC" }));
  });
});

describe("ticket.service consultas (TICKET-03)", () => {
  it("lista só os chamados do usuário, mais recentes primeiro", async () => {
    mockTicketFindAll.mockResolvedValue([{ id: 2 }, { id: 1 }]);

    await expect(listTicketsByUser(7)).resolves.toEqual([{ id: 2 }, { id: 1 }]);
    expect(mockTicketFindAll).toHaveBeenCalledWith({
      where: { user_id: 7 },
      order: [["createdAt", "DESC"]],
    });
  });

  it("busca o detalhe filtrando pelo dono", async () => {
    mockTicketFindOne.mockResolvedValue({ id: 42 });

    await expect(findTicketByIdForUser(42, 7)).resolves.toEqual({ id: 42 });
    expect(mockTicketFindOne).toHaveBeenCalledWith({ where: { id: 42, user_id: 7 } });
  });

  it("devolve null para chamado de outro usuário", async () => {
    mockTicketFindOne.mockResolvedValue(null);
    await expect(findTicketByIdForUser(42, 8)).resolves.toBeNull();
  });
});

describe("ticket.service listMessagesByTicket", () => {
  it("devolve null e não consulta mensagens se o chamado não for do usuário", async () => {
    mockTicketFindOne.mockResolvedValue(null);

    await expect(listMessagesByTicket(42, 8)).resolves.toBeNull();
    expect(mockTicketFindOne).toHaveBeenCalledWith({ where: { id: 42, user_id: 8 } });
    expect(mockMessageFindAll).not.toHaveBeenCalled();
  });

  it("lista as mensagens do próprio chamado em ordem cronológica, com o autor", async () => {
    mockTicketFindOne.mockResolvedValue({ id: 42 });
    mockMessageFindAll.mockResolvedValue([{ id: 1 }]);

    await expect(listMessagesByTicket(42, 7)).resolves.toEqual([{ id: 1 }]);
    expect(mockMessageFindAll).toHaveBeenCalledWith({
      where: { ticket_id: 42 },
      order: [["createdAt", "ASC"]],
      include: [{ model: { name: "UserModel" }, as: "author", attributes: ["id", "name", "avatar_uri"] }],
    });
  });
});

describe("ticket.service addMessageToTicket (TICKET-05)", () => {
  const openTicket = (overrides: Record<string, unknown> = {}) => ({
    id: 42,
    status: "ABERTO",
    user_type: "CLIENTE",
    changed: jest.fn(),
    save: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  });

  beforeEach(() => {
    mockMessageCreate.mockResolvedValue({ id: 3 });
    mockMessageFindByPk.mockResolvedValue({ id: 3, content: "Ainda sem resposta" });
  });

  it("grava a mensagem do dono com author_type do chamado, dentro da transação com trava", async () => {
    mockTicketFindOne.mockResolvedValue(openTicket());

    const result = await addMessageToTicket(42, 7, { content: "Ainda sem resposta" });

    expect(mockTicketFindOne).toHaveBeenCalledWith({
      where: { id: 42, user_id: 7 },
      transaction: mockTransaction,
      lock: "UPDATE",
    });
    expect(mockMessageCreate).toHaveBeenCalledWith(
      { ticket_id: 42, author_id: 7, author_type: "CLIENTE", content: "Ainda sem resposta" },
      { transaction: mockTransaction },
    );
    expect(result).toEqual({ id: 3, content: "Ainda sem resposta" });
    expect(mockMessageFindByPk).toHaveBeenCalledWith(3, {
      include: [{ model: { name: "UserModel" }, as: "author", attributes: ["id", "name", "avatar_uri"] }],
    });
  });

  it("usa PRESTADOR como author_type quando o chamado é de prestador", async () => {
    mockTicketFindOne.mockResolvedValue(openTicket({ user_type: "PRESTADOR" }));

    await addMessageToTicket(42, 9, { content: "Cliente não respondeu" });

    expect(mockMessageCreate).toHaveBeenCalledWith(
      expect.objectContaining({ author_id: 9, author_type: "PRESTADOR" }),
      expect.anything(),
    );
  });

  it("atualiza o updated_at do chamado para refletir a última interação", async () => {
    const ticket = openTicket();
    mockTicketFindOne.mockResolvedValue(ticket);

    await addMessageToTicket(42, 7, { content: "Ainda sem resposta" });

    expect(ticket.changed).toHaveBeenCalledWith("updatedAt", true);
    expect(ticket.save).toHaveBeenCalledWith({ transaction: mockTransaction });
  });

  it.each(["EM_ANALISE", "EM_ATENDIMENTO"])("aceita mensagem com status %s", async (status) => {
    mockTicketFindOne.mockResolvedValue(openTicket({ status }));
    await expect(addMessageToTicket(42, 7, { content: "Oi" })).resolves.toBeDefined();
  });

  it("lança 404 sem gravar quando o chamado não existe ou é de outro usuário", async () => {
    mockTicketFindOne.mockResolvedValue(null);

    await expect(addMessageToTicket(42, 8, { content: "Oi" })).rejects.toMatchObject({
      status: 404,
      message: "Chamado não encontrado.",
    });
    expect(mockMessageCreate).not.toHaveBeenCalled();
  });

  it.each(["RESOLVIDO", "FECHADO"])("lança 409 TICKET_CLOSED sem gravar quando o status é %s", async (status) => {
    const ticket = openTicket({ status });
    mockTicketFindOne.mockResolvedValue(ticket);

    await expect(addMessageToTicket(42, 7, { content: "Oi" })).rejects.toMatchObject({
      status: 409,
      code: "TICKET_CLOSED",
      message: "Chamado encerrado não aceita novas mensagens.",
    });
    expect(mockMessageCreate).not.toHaveBeenCalled();
    expect(ticket.save).not.toHaveBeenCalled();
  });
});

describe("ticket.service openTicketFromChat (chatbot)", () => {
  it("abre o chamado com o resumo como título e os detalhes na descrição", async () => {
    mockAdminFindOne.mockResolvedValue(null);
    mockProfessionalFindOne.mockResolvedValue(null);

    await openTicketFromChat(
      7,
      "  Fui cobrado duas vezes pelo mesmo serviço  ",
      "Foi ontem, no agendamento 6BDOKZ"
    );

    expect(mockTicketCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Fui cobrado duas vezes pelo mesmo serviço",
        description:
          "Fui cobrado duas vezes pelo mesmo serviço\n\nDetalhes: Foi ontem, no agendamento 6BDOKZ",
        category: "PAGAMENTO",
        priority: "MEDIA",
        status: "ABERTO",
        user_id: 7,
        user_type: "CLIENTE",
        appointment_id: null,
      })
    );
  });

  it("registra o prestador com o tipo PRESTADOR", async () => {
    mockAdminFindOne.mockResolvedValue(null);
    mockProfessionalFindOne.mockResolvedValue({ id: 3 });

    await openTicketFromChat(7, "O aplicativo não carrega minha agenda");

    expect(mockTicketCreate).toHaveBeenCalledWith(expect.objectContaining({ user_type: "PRESTADOR" }));
  });

  it("recusa administradores sem criar o chamado (TICKET-02)", async () => {
    mockAdminFindOne.mockResolvedValue({ id: 1 });

    await expect(openTicketFromChat(1, "O aplicativo não carrega")).rejects.toBeInstanceOf(
      TicketOpeningNotAllowedError
    );
    expect(mockTicketCreate).not.toHaveBeenCalled();
  });
});
