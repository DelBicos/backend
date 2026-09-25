import { Options } from "swagger-jsdoc";
import path from "path";

const isProduction =
  process.env.ENVIRONMENT === "production" ||
  process.env.NODE_ENV === "production";

// O Azure App Service injeta essa variável automaticamente em todo Web App nativo (Oryx),
// o que permite diferenciar "rodando no Azure" de "produção genérica" (ex: Render).
const isAzure = !!process.env.WEBSITE_INSTANCE_ID;

const azureServer = {
  url: "https://delbicos-backend-edu.azurewebsites.net/api",
  description: "Servidor de produção (Azure App Service)",
};
const renderServer = {
  url: "https://delbicosbackend.onrender.com/api",
  description: "Servidor de produção (Render)",
};
const localServer = { url: "http://localhost:3000/api", description: "Servidor local" };

// O Swagger UI seleciona o primeiro item da lista por padrão no dropdown de servidores.
// Reordenamos colocando o ambiente atual primeiro, mas todos continuam disponíveis pra troca manual.
const servers = isAzure
  ? [azureServer, renderServer, localServer]
  : isProduction
    ? [renderServer, azureServer, localServer]
    : [localServer, azureServer, renderServer];

// In production, __dirname is /app/dist/src/config — resolve up to dist/src/
// In development, __dirname is /…/src/config — resolve up to src/
const routesGlob = path.resolve(__dirname, "../routes/*.js");
const modelsGlob = path.resolve(__dirname, "../models/*.js");
const routesGlobTs = path.resolve(__dirname, "../routes/*.ts");
const modelsGlobTs = path.resolve(__dirname, "../models/*.ts");

const swaggerOptions: Options = {
  definition: {
    openapi: "3.0.0",
    info: {
      title: "DelBicos API",
      version: "1.0.0",
      description: "Documentação das rotas da API DelBicos",
    },
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
    },
    servers,
  },
  apis: isProduction ? [routesGlob, modelsGlob] : [routesGlobTs, modelsGlobTs],
};

export default swaggerOptions;
