/**
 * Carrega o .env antes de qualquer outro modulo ler process.env.
 * Deve ser o PRIMEIRO import do entrypoint (server.ts).
 * override: false — variaveis do ambiente (Docker/App Service) tem prioridade.
 */
import * as dotenv from "dotenv";

dotenv.config({ override: false });
