import { Request, Response } from "express";
import logger from "../utils/logger";
import { sendViaAzureFunction } from "../utils/azureEmailFunction";

const isDevelopmentEnvironment = (): boolean => {
  const environment = process.env.ENVIRONMENT || process.env.NODE_ENV;
  return environment === "development";
};

export const testEmailFallback = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  if (!isDevelopmentEnvironment()) {
    return res
      .status(404)
      .json({ error: "Endpoint indisponivel neste ambiente" });
  }

  const { to, subject, body } = req.body || {};

  if (!to || !subject || !body) {
    return res
      .status(400)
      .json({ error: 'Fields "to", "subject", "body" are required' });
  }

  try {
    const result = await sendViaAzureFunction({ to, subject, html: body });

    if (result) {
      return res.status(200).json({ ok: true });
    }

    return res
      .status(502)
      .json({ ok: false, error: "Azure Function invocation failed" });
  } catch (error) {
    logger.error("Error in testEmailFallback controller:", error as any);
    return res.status(500).json({ ok: false, error: String(error) });
  }
};
