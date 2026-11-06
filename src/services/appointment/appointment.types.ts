import { AppointmentModel } from "../../models/Appointment";

interface UserSummary {
  id: number;
  name?: string | null;
  email?: string | null;
  avatar_uri?: string | null;
}

/**
 * Agendamento com as associacoes que os servicos costumam carregar.
 * Todas opcionais: cada consulta inclui somente o que precisa.
 */
export type AppointmentWithRelations = AppointmentModel & {
  Client?: { id?: number; user_id: number; cpf?: string; User?: UserSummary };
  Professional?: {
    id: number;
    user_id: number;
    cpf?: string;
    cnpj?: string | null;
    service_radius_km?: number | null;
    MainAddress?: { lat?: number | string; lng?: number | string };
    User?: UserSummary;
  };
  Service?: {
    id?: number;
    title: string;
    description?: string | null;
    duration?: number;
    price?: number | string | null;
    price_cents?: number | null;
  };
  Address?: {
    street: string;
    number: string;
    neighborhood: string;
    city: string;
    state: string;
  };
};
