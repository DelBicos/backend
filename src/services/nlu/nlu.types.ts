import { TimePeriod } from "../../utils/date.util";

export type NluIntent =
  "AGENDAR" | "ALTERAR" | "CANCELAR" | "CONSULTAR" | "SAUDACAO" | "FALLBACK";

export interface NluEntities {
  service?: string;
  date?: string;
  time?: string;
  time_period?: TimePeriod;
  professional?: string;
  appointment_id?: number;
  /** Origem da entrada, por exemplo web, voice-web ou voice-mobile. */
  input_channel?: string;
}

export interface NluResult {
  intent: NluIntent;
  entities: NluEntities;
  confidence: number;
}

/**
 * Comandos explícitos do domínio. As regras validam ou corrigem a classificação
 * de frases inequívocas, mas não impedem que o texto passe pelo TF-IDF + SVM.
 */
