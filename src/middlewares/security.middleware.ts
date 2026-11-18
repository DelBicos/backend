import helmet from "helmet";
import rateLimit from "express-rate-limit";
import hpp from "hpp";
import mongoSanitize from "express-mongo-sanitize";

// ---------------------------------------------------------------------------
// 1. Helmet – define HTTP headers seguros (XSS-Protection, Content-Security-Policy, etc.)
// ---------------------------------------------------------------------------
export const helmetMiddleware = helmet({
  // Avatares/arquivos em /avatarBucket sao consumidos pelo app web em outra origem.
  crossOriginResourcePolicy: { policy: "cross-origin" },
});

// ---------------------------------------------------------------------------
// 2. Rate Limiting – protege contra brute-force e DDoS
// ---------------------------------------------------------------------------
const environment =
  process.env.ENVIRONMENT || process.env.NODE_ENV || "development";
const isDev = environment === "development";
const isTest = environment === "test";

const envNumber = (name: string, fallback: number) => {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

/** Conexoes longas (SSE) nao devem consumir a cota: o navegador reconecta sozinho. */
const LONG_LIVED_PATHS = ["/api/services/events"];

/**
 * Protecao contra abuso/DoS por IP. Janela curta (1 min) e limite folgado:
 * uma pagina do app dispara dezenas de requisicoes e, na apresentacao, varios
 * visitantes podem compartilhar o mesmo IP (rede da faculdade). Rotas
 * sensiveis (login, cadastro, chatbot, voz) tem limitadores proprios.
 * Desligado em desenvolvimento e testes.
 */
export const globalRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: envNumber("GLOBAL_RATE_LIMIT_MAX", 600),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) =>
    isDev || isTest || LONG_LIVED_PATHS.some((path) => req.path.startsWith(path)),
  message: {
    msg: "Muitas requisições deste IP. Aguarde um minuto e tente novamente.",
  },
});

const AUTH_WINDOW_MS = 15 * 60 * 1000; // 15 minutos

/** Rotas de cadastro/verificacao/reenvio: conta todas as requisicoes (evita spam de e-mail). */
export const authRateLimiter = rateLimit({
  windowMs: AUTH_WINDOW_MS,
  max: envNumber("AUTH_RATE_LIMIT_MAX", 20),
  skip: () => isTest,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    msg: "Muitas tentativas. Tente novamente após 15 minutos.",
  },
});

/** Login: conta apenas tentativas que falharam (protege contra forca bruta). */
export const loginRateLimiter = rateLimit({
  windowMs: AUTH_WINDOW_MS,
  max: envNumber("LOGIN_RATE_LIMIT_MAX", 10),
  skipSuccessfulRequests: true,
  skip: () => isTest,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    msg: "Muitas tentativas de login. Tente novamente após 15 minutos.",
  },
});

// ---------------------------------------------------------------------------
// 3. HPP – HTTP Parameter Pollution protection
// ---------------------------------------------------------------------------
export const hppMiddleware = hpp();

// ---------------------------------------------------------------------------
// 4. NoSQL Injection protection (MongoDB)
// ---------------------------------------------------------------------------
export const mongoSanitizeMiddleware = mongoSanitize();

// ---------------------------------------------------------------------------
// Observacao: sanitizacao de XSS e deteccao de SQL injection por regex NAO sao
// aplicadas globalmente. Escapar HTML na entrada corrompia senhas, URLs e
// mensagens do chatbot, e o regex de SQL bloqueava textos legitimos. A defesa
// correta ja esta no lugar: Sequelize usa queries parametrizadas e o app
// (React Native) nao interpreta HTML. Conteudo inserido em templates HTML
// (ex.: e-mails) deve ser escapado no momento da renderizacao.
// ---------------------------------------------------------------------------
