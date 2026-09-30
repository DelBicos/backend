/**
 * Mock manual da trava da agenda para testes unitarios (sem Postgres).
 * `withProfessionalScheduleLock` executa o trabalho na hora com uma transacao
 * falsa; os testes que precisam do comportamento real usam a integracao.
 * Uso: jest.mock("<caminho>/services/appointmentSchedule.service");
 */
import type { Transaction } from "sequelize";

const actual = jest.requireActual<typeof import("../appointmentSchedule.service")>(
  "../appointmentSchedule.service",
);

export const fakeTransaction = { LOCK: { UPDATE: "UPDATE" } } as unknown as Transaction;

export const ScheduleConflictError = actual.ScheduleConflictError;

export const withProfessionalScheduleLock = jest.fn(
  async <T>(_professionalId: number, work: (transaction: Transaction) => Promise<T>) =>
    work(fakeTransaction),
);

export const assertNoAppointmentOverlap = jest.fn(async () => undefined);
export const createAppointmentWithScheduleLock = jest.fn();
export const changePendingAppointmentStatus = jest.fn();
export const expirePendingAppointment = jest.fn();
