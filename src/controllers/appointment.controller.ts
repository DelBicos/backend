import { Response } from "express";
import { AuthenticatedRequest } from "../interfaces/authentication.interface";
import { HttpError } from "../errors/HttpError";
import { asyncHandler } from "../utils/asyncHandler";
import * as AppointmentService from "../services/appointment/appointment.service";
import * as Lifecycle from "../services/appointment/lifecycle.rules";
import * as Disputes from "../services/appointment/dispute.service";

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

export const completeAppointment = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const appointment = await AppointmentService.completeAppointment(
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

export const previewCancellation = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    res.json(await Lifecycle.previewCancellation(requireUserId(req), req.params.id));
  },
);

export const cancelAppointment = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    res.json(await Lifecycle.cancelAppointment(requireUserId(req), req.params.id, req.body?.reason));
  },
);

export const markNoShow = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    res.json(await Lifecycle.markNoShow(requireUserId(req), req.params.id));
  },
);

export const requestReschedule = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    res.json(
      await Lifecycle.requestReschedule(requireUserId(req), req.params.id, req.body?.start_time),
    );
  },
);

export const respondToReschedule = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    res.json(
      await Lifecycle.respondToReschedule(requireUserId(req), req.params.id, req.body?.accept),
    );
  },
);

export const openDispute = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    const dispute = await Disputes.openDispute(requireUserId(req), req.params.id, {
      reason: req.body?.reason,
      description: req.body?.description,
    });
    res.status(201).json(dispute);
  },
);

export const getDispute = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    res.json(await Disputes.getDisputeForAppointment(requireUserId(req), req.params.id));
  },
);

export const listRescheduleSlots = asyncHandler<AuthenticatedRequest>(
  async (req, res: Response) => {
    res.json(await Lifecycle.listRescheduleSlots(requireUserId(req), req.params.id, req.query.date));
  },
);
