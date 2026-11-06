/**
 * Datas e horarios em portugues (bot e agendamento). O codigo foi dividido em
 * modulos por assunto em ./date; este arquivo reexporta a API publica.
 */
export * from "./date/calendar";
export * from "./date/timeParsing";
export * from "./date/dateParsing";
export { PORTUGUESE_DAY_WORDS } from "./date/portugueseText";
