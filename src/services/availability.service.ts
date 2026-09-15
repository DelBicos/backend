import { Op } from "sequelize";
import { ProfessionalAvailabilityModel } from "../models/ProfessionalAvailability";
import { ServiceAvailabilityModel } from "../models/ServiceAvailability";
import { ServiceModel } from "../models/Service";
import { AppointmentModel } from "../models/Appointment";

/**
 * Retorna os horários disponíveis de um profissional para uma data específica.
 *
 * @param professionalId - ID do profissional
 * @param date           - Data no formato YYYY-MM-DD
 * @param serviceDuration - Duração do serviço em minutos
 * @param serviceId      - ID do serviço (opcional; sem ele, considera todos os serviços ativos)
 * @returns Array de strings HH:MM ordenado e sem duplicatas
 */
export async function getAvailableSlots(
  professionalId: number,
  date: string,
  serviceDuration: number,
  serviceId?: number,
): Promise<string[]> {
  const targetDate = new Date(`${date}T12:00:00.000Z`);
  const dayOfWeek = targetDate.getUTCDay(); // 0=Dom..6=Sáb
  const bitmaskDay = "_".repeat(dayOfWeek) + "1" + "_".repeat(6 - dayOfWeek);

  // ── 1. Regras de disponibilidade geral do profissional ─────────────────────
  const professionalRules = await ProfessionalAvailabilityModel.findAll({
    where: {
      professional_id: professionalId,
      is_available: true,
      [Op.or]: [
        {
          recurrence_pattern: "weekly",
          days_of_week: { [Op.like]: `%${bitmaskDay}%` },
        },
        {
          recurrence_pattern: "none",
          start_day: { [Op.lte]: targetDate },
          end_day: { [Op.gte]: targetDate },
        },
      ],
    },
  });

  // ── 2. Disponibilidades do serviço específico (ServiceAvailabilityModel) ───
  let serviceRules: { start_time: string; end_time: string }[] = [];
  if (serviceId) {
    serviceRules = await ServiceAvailabilityModel.findAll({
      where: { service_id: serviceId, day_of_week: dayOfWeek },
    });
  } else {
    const profServices = await ServiceModel.findAll({
      where: { professional_id: professionalId, active: true },
      attributes: ["id"],
    });
    if (profServices.length > 0) {
      serviceRules = await ServiceAvailabilityModel.findAll({
        where: {
          service_id: profServices.map((s: any) => s.id),
          day_of_week: dayOfWeek,
        },
      });
    }
  }

  // Une as duas fontes de disponibilidade
  const allRules: { start_time: string; end_time: string }[] = [
    ...professionalRules,
    ...serviceRules,
  ];

  if (allRules.length === 0) return [];

  const startOfDay = new Date(`${date}T00:00:00.000Z`);
  const endOfDay = new Date(`${date}T23:59:59.999Z`);

  // ── 3. Bloqueios: agendamentos confirmados/pendentes + bloqueios explícitos ─
  const appointments = await AppointmentModel.findAll({
    where: {
      professional_id: professionalId,
      status: { [Op.in]: ["confirmed", "pending"] },
      start_time: { [Op.between]: [startOfDay, endOfDay] },
    },
  });

  const blocks = await ProfessionalAvailabilityModel.findAll({
    where: {
      professional_id: professionalId,
      is_available: false,
      recurrence_pattern: "none",
      start_day: { [Op.lte]: targetDate },
      end_day: { [Op.gte]: targetDate },
    },
  });

  const allBlockages = [
    ...appointments.map((a) => ({
      start: new Date(a.start_time),
      end: new Date(a.end_time),
    })),
    ...blocks.map((b) => {
      const [startH, startM] = b.start_time.split(":").map(Number);
      const [endH, endM] = b.end_time.split(":").map(Number);
      const blockStart = new Date(startOfDay);
      blockStart.setUTCHours(startH, startM);
      const blockEnd = new Date(startOfDay);
      blockEnd.setUTCHours(endH, endM);
      return { start: blockStart, end: blockEnd };
    }),
  ];

  // ── 4. Gerar slots disponíveis ──────────────────────────────────────────────
  const availableSlots: string[] = [];
  const slotInterval = 30;

  for (const rule of allRules) {
    const [startH, startM] = rule.start_time.split(":").map(Number);
    const [endH, endM] = rule.end_time.split(":").map(Number);

    const ruleStart = new Date(startOfDay);
    ruleStart.setUTCHours(startH, startM, 0, 0);
    const ruleEnd = new Date(startOfDay);
    ruleEnd.setUTCHours(endH, endM, 0, 0);

    let currentSlotStart = new Date(ruleStart);

    while (currentSlotStart < ruleEnd) {
      const slotEnd = new Date(
        currentSlotStart.getTime() + serviceDuration * 60000,
      );

      if (slotEnd > ruleEnd) break;

      const isBlocked = allBlockages.some(
        (block) => currentSlotStart < block.end && slotEnd > block.start,
      );

      if (!isBlocked) {
        availableSlots.push(
          currentSlotStart.toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "UTC",
          }),
        );
      }
      currentSlotStart.setMinutes(currentSlotStart.getMinutes() + slotInterval);
    }
  }

  return [...new Set(availableSlots)].sort();
}
