import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { apiLimiter } from "./lib/rateLimiters";

const app: Express = express();

// ── Trust proxy (Replit sits behind a load-balancer / TLS terminator) ─────────
// Required so that express-rate-limit reads the real client IP from
// X-Forwarded-For instead of the proxy's IP, and so that req.ip is correct.
app.set("trust proxy", 1);

// ── Security headers ──────────────────────────────────────────────────────────

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false,
  })
);

// ── CORS ──────────────────────────────────────────────────────────────────────
// All sensitive endpoints require a JWT bearer token via the Authorization
// header — not cookies. Therefore credentials:true is not needed, and removing
// it eliminates the CSRF attack surface from any future cookie-based auth.
// We block plain-HTTP origins but allow any HTTPS origin so the app works
// across every Replit deployment URL format and custom domains.

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow same-origin and server-to-server requests (no Origin header)
      if (!origin || origin === "null") return callback(null, true);
      // Block non-HTTPS origins in all environments
      if (!origin.startsWith("https://")) {
        return callback(new Error("CORS: only HTTPS origins allowed"));
      }
      // Allow all extra origins from env (comma-separated)
      const extra = (process.env["CORS_ORIGIN"] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (extra.includes(origin)) return callback(null, true);
      // Allow any HTTPS origin — JWT auth is the real protection gate
      return callback(null, true);
    },
  })
);

// ── Logging ───────────────────────────────────────────────────────────────────

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  })
);

// ── Body parsing (with size cap) ──────────────────────────────────────────────

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true, limit: "2mb" }));

// ── Routes ────────────────────────────────────────────────────────────────────

app.use("/api", apiLimiter, router);

// ── Global error handler ──────────────────────────────────────────────────────

const isProduction = process.env["NODE_ENV"] === "production";

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, "Unhandled error");
  const status = (err as any).status ?? (err as any).statusCode ?? 500;
  res.status(status).json({ error: isProduction ? "Internal server error" : err.message });
});

export default app;
