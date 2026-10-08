export interface RegistrationInput {
  name: string; surname: string; email: string; password: string; phone: string; cpf: string;
  address: {
    postal_code: string; street: string; number: string; complement?: string;
    neighborhood: string; city: string; state: string; country_iso?: string;
  };
}
