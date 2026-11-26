jest.mock("../../config/database");

import { initializeAssociations } from "../associations";
import { UserModel } from "../User";
import { AppointmentModel } from "../Appointment";
import { AdminModel } from "../Admin";
import { AdminServiceOrderModel } from "../AdminServiceOrder";
import { AmenitiesModel } from "../Amenities";
import { ProfessionalAmenityModel } from "../ProfessionalAmenities";
import { ProfessionalModel } from "../Professional";
import TicketModel from "../Ticket";
import TicketMessageModel from "../TicketMessage";

describe("initializeAssociations", () => {
  beforeAll(() => {
    initializeAssociations();
  });

  it("liga o usuario aos perfis de cliente, profissional e admin", () => {
    expect(UserModel.associations.Client?.associationType).toBe("HasOne");
    expect(UserModel.associations.Professional?.associationType).toBe("HasOne");
    expect(UserModel.associations.Admin?.associationType).toBe("HasOne");
    expect(UserModel.associations.Addresses?.associationType).toBe("HasMany");
  });

  it("liga agendamento a disputa e ordens de servico do admin", () => {
    expect(AppointmentModel.associations.Dispute?.associationType).toBe("HasOne");
    expect(AppointmentModel.associations.ServiceOrders?.target).toBe(AdminServiceOrderModel);
    expect(AdminModel.associations.ServiceOrders?.associationType).toBe("HasMany");
    expect(AdminServiceOrderModel.associations.Admin?.target).toBe(AdminModel);
    expect(AdminServiceOrderModel.associations.Appointment?.foreignKey).toBe("appointment_id");
  });

  it("liga profissionais e comodidades pela tabela intermediaria", () => {
    expect(AmenitiesModel.associations.Professionals?.associationType).toBe("BelongsToMany");
    expect(ProfessionalAmenityModel.associations.Professional?.target).toBe(ProfessionalModel);
    expect(ProfessionalAmenityModel.associations.Amenity?.target).toBe(AmenitiesModel);
  });

  it("liga chamados ao usuario, ao agendamento e as mensagens", () => {
    expect(UserModel.associations.openedTickets?.foreignKey).toBe("user_id");
    expect(UserModel.associations.assignedTickets?.foreignKey).toBe("admin_id");
    expect(AppointmentModel.associations.tickets?.target).toBe(TicketModel);
    expect(TicketModel.associations.messages?.target).toBe(TicketMessageModel);
    expect(TicketMessageModel.associations.ticket?.target).toBe(TicketModel);
    expect(TicketMessageModel.associations.author?.foreignKey).toBe("author_id");
  });
});
