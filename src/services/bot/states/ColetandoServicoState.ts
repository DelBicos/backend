import { ServiceModel } from "../../../models/Service";
import { SubCategoryModel } from "../../../models/Subcategory";
import { CategoryModel } from "../../../models/Category";
import { ProfessionalModel } from "../../../models/Professional";
import { UserModel } from "../../../models/User";
import { BotChatSessionModel, BotSessionContext } from "../../../models/BotChatSession";
import { NluResult } from "../../nlu.service";
import { BotStateNode, HandlerResult } from "../BotStateNode";
import { normalizeText, calculateMatchScore, findBestOptionMatch } from "../../../utils/nlp.util";

export class ColetandoServicoState implements BotStateNode {
  public async handle(
    userMessage: string,
    nlu: NluResult,
    session: BotChatSessionModel,
    userId: number
  ): Promise<HandlerResult> {
    const ctx = (session.context ?? {}) as BotSessionContext;

    // 1. Se estamos aguardando confirmação do serviço selecionado
    if (ctx.pendingService) {
      const lower = userMessage.toLowerCase().trim();
      const confirmed = /\b(sim|s|yes|confirmar|confirmo|ok|pode|vamos)\b/.test(lower);
      const denied = /\b(n[aã]o|nao|no|cancelar|desistir|voltar)\b/.test(lower);

      if (!confirmed && !denied) {
        return {
          reply: `Por favor, responda com "sim" para confirmar o serviço "${ctx.pendingService.title}" ou "não" para buscar outro:`,
          nextState: "COLETANDO_SERVICO",
          contextUpdate: {
            serviceOptions: ["Sim", "Não"],
            serviceOptionsData: undefined,
          },
        };
      }

      if (denied) {
        return {
          reply: "Ok, escolha cancelada. Qual serviço você gostaria de agendar? (Ex: corte de cabelo, pintura, limpeza...)",
          nextState: "COLETANDO_SERVICO",
          contextUpdate: {
            pendingService: null,
            serviceOptions: undefined,
            serviceOptionsData: undefined,
          },
        };
      }

      // Confirmado! Transiciona para COLETANDO_DATA (pergunta dia primeiro)
      const picked = ctx.pendingService;
      
      // Busca todos os IDs de serviços ativos com o mesmo título para verificar disponibilidade de múltiplos profissionais
      const matchingServices = await ServiceModel.findAll({
        where: { title: picked.title, active: true },
      });
      const matchedServiceIds = matchingServices.map(s => s.id);

      return {
        reply: `Serviço "${picked.title}" selecionado.\n\nQual data você prefere? (Formatos aceitos: DD/MM/AAAA, AAAA-MM-DD ou texto como "amanhã", "próxima segunda")`,
        nextState: "COLETANDO_DATA",
        contextUpdate: {
          serviceName: picked.title,
          serviceDuration: picked.duration,
          matchedServiceIds,
          pendingService: null,
          serviceOptions: undefined,
          serviceOptionsData: undefined,
        },
      };
    }

    // 2. Se há opções listadas, tenta selecionar por número ou por correspondência de texto
    if (ctx.serviceOptionsData && ctx.serviceOptionsData.length > 0) {
      const choice = parseInt(userMessage.trim(), 10);
      let picked = null;
      
      if (!isNaN(choice) && choice >= 1 && choice <= ctx.serviceOptionsData.length) {
        picked = ctx.serviceOptionsData[choice - 1];
      } else {
        // Tenta correspondência textual (ex: "Serv geral" correspondendo a "Serviços Gerais")
        picked = findBestOptionMatch(userMessage, ctx.serviceOptionsData);
      }

      if (picked) {
        return {
          reply: `Você escolheu: "${picked.title}".\n\nVocê confirma a escolha deste serviço? ("sim" / "não")`,
          nextState: "COLETANDO_SERVICO",
          contextUpdate: {
            pendingService: picked,
            serviceOptions: ["Sim", "Não"],
            serviceOptionsData: undefined,
          },
        };
      }
    }

    // 3. Caso contrário, faz a busca pelo termo
    const searchTerm = nlu.entities.service ?? userMessage.trim();
    if (!searchTerm) {
      return {
        reply: "Por favor, informe o nome ou tipo de serviço que deseja agendar.",
        nextState: "COLETANDO_SERVICO",
        contextUpdate: {},
      };
    }

    const services = await ServiceModel.findAll({
      where: { active: true },
      include: [
        {
          model: SubCategoryModel,
          as: "Subcategory",
          include: [{ model: CategoryModel, as: "Category" }],
        },
        {
          model: ProfessionalModel,
          as: "Professional",
          include: [{ model: UserModel, as: "User", attributes: ["name"] }],
        },
      ],
    });

    const normalizedSearch = normalizeText(searchTerm);
    const searchKeywords = normalizedSearch.split(" ").filter(w => w.length > 0);

    const scoredServices = services
      .map((svc: any) => {
        const score = calculateMatchScore(svc, normalizedSearch, searchKeywords);
        return { svc, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score);

    if (scoredServices.length === 0) {
      return {
        reply: `Não encontrei serviços com o nome "${searchTerm}". Tente um termo diferente ou mais genérico (ex: "cabelo", "pintura"):`,
        nextState: "COLETANDO_SERVICO",
        contextUpdate: {
          serviceOptions: ctx.serviceOptions,
          serviceOptionsData: ctx.serviceOptionsData,
        },
      };
    }

    // Se houver apenas títulos idênticos nos resultados encontrados, pede a confirmação
    const distinctTitles = Array.from(new Set(scoredServices.map(item => item.svc.title)));
    if (distinctTitles.length === 1) {
      const svc = scoredServices[0].svc as any;
      const profName = svc.Professional?.User?.name ?? "Profissional";
      const pending = {
        id: svc.id,
        title: svc.title,
        professionalId: svc.professional_id,
        professionalName: profName,
        price: svc.price_cents ?? Math.round(svc.price * 100),
        duration: svc.duration,
      };
      return {
        reply: `Encontrei o serviço: "${svc.title}".\n\nVocê confirma a escolha deste serviço? ("sim" / "não")`,
        nextState: "COLETANDO_SERVICO",
        contextUpdate: {
          pendingService: pending,
          serviceOptions: ["Sim", "Não"],
          serviceOptionsData: undefined,
        },
      };
    }

    // Múltiplos resultados com títulos diferentes
    const uniqueOptions: any[] = [];
    const seenTitles = new Set<string>();
    for (const item of scoredServices) {
      const svc = item.svc as any;
      if (!seenTitles.has(svc.title)) {
        seenTitles.add(svc.title);
        const profName = svc.Professional?.User?.name ?? "Profissional";
        uniqueOptions.push({
          id: svc.id,
          title: svc.title,
          professionalId: svc.professional_id,
          professionalName: profName,
          price: svc.price_cents ?? Math.round(svc.price * 100),
          duration: svc.duration,
        });
        if (uniqueOptions.length >= 5) break;
      }
    }

    const serviceOptions = uniqueOptions.map(o => o.title);
    const lines = uniqueOptions.map(
      (o, i) => `${i + 1}. ${o.title}`,
    );
    
    return {
      reply: `Encontrei ${uniqueOptions.length} opções relacionadas a "${searchTerm}":\n\n${lines.join("\n")}\n\nQual delas você prefere? Responda com o número:`,
      nextState: "COLETANDO_SERVICO",
      contextUpdate: {
        serviceOptions,
        serviceOptionsData: uniqueOptions,
        pendingService: null,
      },
    };
  }
}
