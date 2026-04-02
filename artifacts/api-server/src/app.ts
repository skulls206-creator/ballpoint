import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { apiLimiter } from "./lib/rateLimiters";

const app: Express = express();

// ── Security headers ──────────────────────────────────────────────────────────

app.use(
  helmet({
    crossOriginResourcePolicy: { policy: "cross-origin" },
    contentSecurityPolicy: false,
  })
);

// ── CORS ──────────────────────────────────────────────────────────────────────

const isProduction = process.env["NODE_ENV"] === "production";

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow same-origin and server-to-server (no Origin header)
      if (!origin) return callback(null, true);
      // Allow all Replit dev & production domains
      if (
        /^https:\/\/[a-z0-9-]+\.replit\.app$/.test(origin) ||
        /^https:\/\/[a-z0-9-]+\.replit\.dev$/.test(origin)
      ) {
        return callback(null, true);
      }
      // Allow any extra origins from env (comma-separated)
      const extra = (process.env["CORS_ORIGIN"] ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      if (extra.includes(origin)) return callback(null, true);
      // In development allow everything so the Vite dev server can call the API
      if (!isProduction) return callback(null, true);
      callback(new Error("CORS: origin not allowed"));
    },
    credentials: true,
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

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, "Unhandled error");
  const status = (err as any).status ?? (err as any).statusCode ?? 500;
  res.status(status).json({ error: isProduction ? "Internal server error" : err.message });
});

export default app;
