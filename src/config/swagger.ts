import { Options } from "swagger-jsdoc";
import path from "path";

const isProduction =
  process.env.ENVIRONMENT === "production" ||
  process.env.NODE_ENV === "production";

const isAzure = !!process.env.WEBSITE_INSTANCE_ID;

const azureServer = {
  url: "https://delbicos-backend-dg.azurewebsites.net/api",
  description: "Servidor de produção (Azure App Service)",
};
const renderServer = {
  url: "https://delbicosbackend.onrender.com/api",
  description: "Servidor de produção (Render)",
};
const localServer = {
  url: "http://localhost:3000/api",
  description: "Servidor local",
};

const servers = isAzure
  ? [azureServer, renderServer, localServer]
  : isProduction
    ? [renderServer, azureServer, localServer]
    : [localServer, azureServer, renderServer];

// In production, __dirname is /app/dist/src/config — resolve up to dist/src/
// In development, __dirname is /…/src/config — resolve up to src/
const routesGlob = path.resolve(__dirname, "../routes/*.js");
const modelsGlob = path.resolve(__dirname, "../models/*.js");
const docsGlob = path.resolve(__dirname, "../docs/*.js");
const routesGlobTs = path.resolve(__dirname, "../routes/*.ts");
const modelsGlobTs = path.resolve(__dirname, "../models/*.ts");
const docsGlobTs = path.resolve(__dirname, "../docs/*.ts");

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
  apis: isProduction ? [routesGlob, modelsGlob, docsGlob]
    : [routesGlobTs, modelsGlobTs, docsGlobTs],
};

export default swaggerOptions;