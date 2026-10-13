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

const routesGlobJs = path.resolve(__dirname, "../routes/*.js");
const modelsGlobJs = path.resolve(__dirname, "../models/*.js");
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
  apis: [routesGlobTs, modelsGlobTs, routesGlobJs, modelsGlobJs],
};

export default swaggerOptions;