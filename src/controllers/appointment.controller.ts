import { Response } from "express";
import { AuthenticatedRequest } from "../interfaces/authentication.interface";
import { HttpError } from "../errors/HttpError";
import { asyncHandler } from "../utils/asyncHandler";
import * as AppointmentService from "../services/appointment/appointment.service";

/** Controllers finos: extraem dados do HTTP e delegam ao AppointmentService. */

function requireUserId(req: AuthenticatedRequest): number {
  const id = req.user?.id;
  if (!id) throw HttpError.unauthorized();
  return id;
}

export const createAppointment = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const appointment = await AppointmentService.createAppointment(
      requireUserId(req),
      req.body ?? {},
    );
    res.status(201).json(appointment);
  },
);

/** Lista os agendamentos do usuario autenticado (params.id deve ser o proprio). */
export const getAllAppointments = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const appointments = await AppointmentService.listAppointmentsForUser(
      requireUserId(req),
      req.params.id,
      req.query.role,
    );
    res.json(appointments);
  },
);

export const confirmAppointment = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const appointment = await AppointmentService.confirmAppointment(
      requireUserId(req),
      req.params.id,
    );
    res.json(appointment);
  },
);

export const updateAppointmentStatus = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const appointment = await AppointmentService.respondToAppointment(
      requireUserId(req),
      req.params.id,
      req.body?.status,
    );
    res.json(appointment);
  },
);

export const reviewAppointment = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const result = await AppointmentService.reviewAppointment(
      requireUserId(req),
      req.params.id,
      { rating: req.body?.rating, review: req.body?.review },
    );
    res.json(result);
  },
);

export const getAppointmentInvoice = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const invoice = await AppointmentService.getAppointmentInvoice(
      requireUserId(req),
      req.params.id,
    );
    res.json(invoice);
  },
);
