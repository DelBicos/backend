import { Op, Transaction } from "sequelize";
import { ProfessionalAvailabilityModel } from "../models/ProfessionalAvailability";
import { ProfessionalAvailabilityLockModel } from "../models/ProfessionalAvailabilityLock";
import { ServiceAvailabilityModel } from "../models/ServiceAvailability";
import { ServiceModel } from "../models/Service";
import { AppointmentModel } from "../models/Appointment";
import { parseLocalAppointmentStart } from "../utils/date.util";

export interface AvailabilityOptions {
  transaction?: Transaction;
  excludeAppointmentId?: number;
}

// start_day/end_day são datas de calendário, inclusive quando o driver retorna Date.
function calendarDay(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : value.slice(0, 10);
}

export function ruleAppliesOnDate(
  rule: ProfessionalAvailabilityModel,
  date: string,
): boolean {
  if (rule.start_day && calendarDay(rule.start_day) > date) return false;
  if (rule.end_day && calendarDay(rule.end_day) < date) return false;
  const day = new Date(`${date}T12:00:00Z`);
  switch (rule.recurrence_pattern) {
    case "daily":
      return true;
    case "weekly":
      return rule.days_of_week?.[day.getUTCDay()] === "1";
    case "monthly":
      return (
        day.getUTCDate() >= (rule.start_day_of_month ?? 1) &&
        day.getUTCDate() <= (rule.end_day_of_month ?? 31)
      );
    case "none":
      return Boolean(rule.start_day && rule.end_day);
    default:
      return false;
  }
}

export function appointmentOverlapWhere(
  professionalId: number,
  start: Date,
  end: Date,
  excludeAppointmentId?: number,
) {
  return {
    professional_id: professionalId,
    status: { [Op.in]: ["confirmed", "pending"] },
    start_time: { [Op.lt]: end },
    end_time: { [Op.gt]: start },
    ...(excludeAppointmentId ? { id: { [Op.ne]: excludeAppointmentId } } : {}),
  };
}

/** Horários de calendário em São Paulo; todos os intervalos são comparados em UTC. */
export async function getAvailableSlots(
  professionalId: number,
  date: string,
  serviceDuration: number,
  serviceId?: number,
  options: AvailabilityOptions = {},
): Promise<string[]> {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
    !Number.isFinite(serviceDuration) ||
    serviceDuration <= 0
  )
    return [];
  const targetDate = new Date(`${date}T12:00:00Z`);
  if (
    isNaN(targetDate.getTime()) ||
    targetDate.toISOString().slice(0, 10) !== date
  )
    return [];
  const nextDate = new Date(targetDate);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const startOfDay = parseLocalAppointmentStart(date, "00:00");
  const endOfDay = parseLocalAppointmentStart(
    nextDate.toISOString().slice(0, 10),
    "00:00",
  );
  const { transaction } = options;
  const rules = (
    await ProfessionalAvailabilityModel.findAll({
      where: { professional_id: professionalId },
      transaction,
    })
  ).filter((rule) => ruleAppliesOnDate(rule, date));

  let serviceIds: number[] = serviceId ? [serviceId] : [];
  if (!serviceId) {
    serviceIds = (
      await ServiceModel.findAll({
        where: { professional_id: professionalId, active: true },
        attributes: ["id"],
        transaction,
      })
    ).map((service) => service.id);
  }
  const serviceRules = serviceIds.length
    ? await ServiceAvailabilityModel.findAll({
        where: {
          service_id: { [Op.in]: serviceIds },
          day_of_week: targetDate.getUTCDay(),
        },
        transaction,
      })
    : [];
  const allRules = [
    ...rules.filter((rule) => rule.is_available),
    ...serviceRules,
  ];
  if (!allRules.length) return [];

  const appointments = await AppointmentModel.findAll({
    where: appointmentOverlapWhere(
      professionalId,
      startOfDay,
      endOfDay,
      options.excludeAppointmentId,
    ),
    transaction,
  });
  const locks = await ProfessionalAvailabilityLockModel.findAll({
    where: {
      professional_id: professionalId,
      start_time: { [Op.lt]: endOfDay },
      end_time: { [Op.gt]: startOfDay },
    },
    transaction,
  });
  const blockages = [...appointments, ...locks].map((item) => ({
    start: new Date(item.start_time),
    end: new Date(item.end_time),
  }));
  for (const rule of rules.filter((rule) => !rule.is_available)) {
    blockages.push({
      start: parseLocalAppointmentStart(date, rule.start_time),
      end: parseLocalAppointmentStart(date, rule.end_time),
    });
  }

  const availableSlots = new Set<string>();
  for (const rule of allRules) {
    const start = parseLocalAppointmentStart(date, rule.start_time).getTime();
    const end = parseLocalAppointmentStart(date, rule.end_time).getTime();
    for (
      let slot = start;
      slot + serviceDuration * 60000 <= end;
      slot += 30 * 60000
    ) {
      const slotEnd = slot + serviceDuration * 60000;
      if (
        !blockages.some(
          (block) =>
            slot < block.end.getTime() && slotEnd > block.start.getTime(),
        )
      ) {
        availableSlots.add(
          new Date(slot).toLocaleTimeString("pt-BR", {
            timeZone: "America/Sao_Paulo",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }),
        );
      }
    }
  }
  return [...availableSlots].sort();
}
