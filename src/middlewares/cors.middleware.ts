import { Express } from "express";
import cors, { CorsOptions } from "cors";

// Normaliza para protocolo + host (com porta, se houver), sem barra final e em minúsculas.
const normalizeOrigin = (o?: string) => {
  if (!o) return "";
  try {
    const u = new URL(o);
    return `${u.protocol}//${u.host}`.toLowerCase();
  } catch {
    return o.replace(/\/+$/, "").toLowerCase();
  }
};

export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    const rawAllowed = process.env.ALLOWED_ORIGINS || "";
    const allowedOrigins = rawAllowed
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
    const allowedNormalized = allowedOrigins.map(normalizeOrigin);

    if (!origin) return callback(null, true); // curl/Postman
    const norm = normalizeOrigin(origin);
    if (allowedNormalized.includes(norm)) return callback(null, true);
    try {
      const host = new URL(origin).hostname.toLowerCase();
      // Libera previews do Vercel (*.vercel.app). Ajuste se quiser restringir mais.
      if (/\.vercel\.app$/.test(host)) return callback(null, true);
    } catch (_) {}
    return callback(new Error(`Origin not allowed by CORS: ${origin}`));
  },
  credentials: true,
  methods: ["GET", "HEAD", "PUT", "PATCH", "POST", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Cache-Control",
    "Pragma",
    "Expires",
    "X-Requested-With",
    "X-Voice-Language",
    "X-Voice-Session-Id",
    "X-Voice-Channel",
    "X-Voice-Selected-Time",
    "X-Voice-Timezone",
    "Idempotency-Key",
  ],
  exposedHeaders: ["Idempotency-Replayed", "RateLimit-Limit", "RateLimit-Remaining", "RateLimit-Reset"],
  maxAge: 86400,
};

export function setupCors(app: Express) {
  const middleware = cors(corsOptions);
  app.use((req, res, next) => {
    if (req.path.startsWith("/docs")) return next();
    return middleware(req, res, next);
  });
  app.options(/^(?!\/docs).*$/, middleware); // pré-flight (exceto /docs)
}
