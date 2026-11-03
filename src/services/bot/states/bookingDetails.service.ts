import { AddressModel } from "../../../models/Address";
import type { BotSessionContext } from "../../../models/BotChatSession";
import { normalizeText } from "../../../utils/nlp.util";
import type { HandlerResult } from "../BotStateNode";

function addressLabel(address: AddressModel): string {
  return `${address.street}, ${address.number}${address.complement ? `, ${address.complement}` : ""} — ${address.neighborhood}, ${address.city}/${address.state}, CEP ${address.postal_code}`;
}

export async function requestBookingAddress(userId: number): Promise<HandlerResult> {
  const addresses = await AddressModel.findAll({
    where: { user_id: userId, active: true },
    order: [["id", "ASC"]],
  });
  const options = addresses.map((address) => ({ id: address.id, label: addressLabel(address) }));
  return {
    reply: options.length
      ? "Em qual endereço será o atendimento?\n\n" +
        options.map((option, index) => `${index + 1}. ${option.label}`).join("\n") +
        "\n\nDiga ou digite o número da opção, por exemplo, ‘primeiro’."
      : "Você ainda não tem um endereço ativo cadastrado. Cadastre o endereço na área de endereços do aplicativo e diga ‘continuar’ aqui. Vou manter o serviço, a data e o horário escolhidos.",
    nextState: "COLETANDO_ENDERECO",
    contextUpdate: {
      bookingDetailsStep: "ADDRESS",
      addressId: undefined,
      addressLabel: undefined,
      addressOptions: options,
      serviceOptions: options.map((_, index) => String(index + 1)),
      serviceOptionsData: undefined,
    },
  };
}

/** Accepts numbers and common spoken ordinals without treating a street number as an option. */
function addressChoice(message: string): number | undefined {
  const value = normalizeText(message).replace(/[.!?]+$/g, "").trim();
  const match = /^(?:(?:quero|escolho|prefiro)\s+)?(?:(?:a|o)\s+)?(?:(?:opcao|numero|endereco)\s+)?(\d+|um|uma|dois|duas|tres|quatro|cinco|seis|sete|oito|nove|dez|primeiro|primeira|segundo|segunda|terceiro|terceira|quarto|quarta|quinto|quinta)(?:\s+(?:opcao|endereco))?$/.exec(value);
  if (!match) return undefined;
  const words: Record<string, number> = {
    um: 1, uma: 1, primeiro: 1, primeira: 1,
    dois: 2, duas: 2, segundo: 2, segunda: 2,
    tres: 3, terceiro: 3, terceira: 3,
    quatro: 4, quarto: 4, quarta: 4,
    cinco: 5, quinto: 5, quinta: 5,
    seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
  };
  return words[match[1]] ?? Number(match[1]);
}

export async function collectBookingDetails(
  message: string,
  ctx: BotSessionContext,
  userId: number,
): Promise<HandlerResult> {
  const normalized = normalizeText(message).replace(/[.!?]+$/g, "").trim();
  if (/^(?:trocar|mudar|outro|alterar)(?: o)? endereco$/.test(normalized)) {
    return requestBookingAddress(userId);
  }
  if (ctx.bookingDetailsStep === "ADDRESS") {
    if (/^(?:continuar|atualizar|cadastrei|pronto)$/.test(normalized) || !ctx.addressOptions?.length) {
      return requestBookingAddress(userId);
    }
    const choice = addressChoice(message);
    const option = choice !== undefined ? ctx.addressOptions[choice - 1] : undefined;
    if (!option) {
      return {
        reply: "Não identifiquei a opção. Diga ou digite o número de um dos endereços exibidos. Para atualizar a lista, diga ‘continuar’.",
        nextState: "COLETANDO_ENDERECO",
        contextUpdate: {},
      };
    }
    const address = await AddressModel.findOne({ where: { id: option.id, user_id: userId, active: true } });
    if (!address) return requestBookingAddress(userId);
    return {
      reply: "",
      nextState: "CONFIRMACAO",
      contextUpdate: {
        addressId: address.id,
        addressLabel: addressLabel(address),
        addressOptions: undefined,
        bookingDetailsStep: "REVIEW",
        serviceOptions: ["Sim", "Não"],
      },
    };
  }
  return requestBookingAddress(userId);
}
