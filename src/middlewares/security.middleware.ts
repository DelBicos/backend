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

export const globalRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutos
  // O app faz polling (status de agendamento/chatbot), entao o limite global
  // precisa ser folgado; rotas sensiveis tem limitadores proprios.
  max: isDev ? 5000 : envNumber("GLOBAL_RATE_LIMIT_MAX", 1000),
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    if (isTest) return true;
    // pula rate limit para IPs de desenvolvimento local
    const ip = req.ip || "";
    return (
      isDev &&
      (ip.includes("127.0.0.1") ||
        ip.includes("::1") ||
        ip.includes("10.0.2.2"))
    );
  },
  message: {
    msg: "Muitas requisições deste IP. Tente novamente após 15 minutos.",
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
