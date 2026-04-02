import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { RegisterBody, LoginBody } from "@workspace/api-zod";
import { authLimiter } from "../lib/rateLimiters";

const router: IRouter = Router();

const JWT_SECRET = process.env["JWT_SECRET"];

if (!JWT_SECRET) {
  if (process.env["NODE_ENV"] === "production") {
    throw new Error("JWT_SECRET environment variable must be set in production.");
  }
  // In development, warn loudly but continue with a non-guessable fallback
  console.warn("[WARN] JWT_SECRET is not set — using an insecure development-only secret. Set JWT_SECRET before deploying.");
}

const ACTIVE_JWT_SECRET = JWT_SECRET ?? "dev-only-do-not-use-in-prod-" + Math.random().toString(36);
const SALT_ROUNDS = 12;
const TOKEN_EXPIRY = "30d";

// POST /auth/register
router.post("/auth/register", authLimiter, async (req: Request, res: Response) => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid email or password (minimum 6 characters)." });
    return;
  }

  const { email, password } = parsed.data;

  try {
    const existing = await db.select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.email, email.toLowerCase()))
      .limit(1);

    if (existing.length > 0) {
      res.status(409).json({ error: "An account with that email already exists." });
      return;
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const [user] = await db.insert(usersTable)
      .values({ email: email.toLowerCase(), passwordHash })
      .returning({ id: usersTable.id, email: usersTable.email });

    const token = jwt.sign({ userId: user.id, email: user.email }, ACTIVE_JWT_SECRET, { expiresIn: TOKEN_EXPIRY });

    res.status(201).json({ token, user: { id: user.id, email: user.email } });
  } catch (err: unknown) {
    const e = err as Error;
    res.status(500).json({ error: "Registration failed. Please try again." });
    console.error("[auth/register]", e.message);
  }
});

// POST /auth/login
router.post("/auth/login", authLimiter, async (req: Request, res: Response) => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid email or password." });
    return;
  }

  const { email, password } = parsed.data;

  try {
    const [user] = await db.select()
      .from(usersTable)
      .where(eq(usersTable.email, email.toLowerCase()))
      .limit(1);

    // Constant-time comparison: always run bcrypt even on miss (using a dummy hash)
    const DUMMY_HASH = "$2b$12$invalidhashfortimingprotection000000000000000000000000000";
    const hashToCheck = user?.passwordHash ?? DUMMY_HASH;
    const valid = await bcrypt.compare(password, hashToCheck);

    if (!user || !valid) {
      res.status(401).json({ error: "Invalid email or password." });
      return;
    }

    const token = jwt.sign({ userId: user.id, email: user.email }, ACTIVE_JWT_SECRET, { expiresIn: TOKEN_EXPIRY });

    res.json({ token, user: { id: user.id, email: user.email } });
  } catch (err: unknown) {
    const e = err as Error;
    res.status(500).json({ error: "Login failed. Please try again." });
    console.error("[auth/login]", e.message);
  }
});

// GET /auth/me
router.get("/auth/me", requireAuth, async (req: Request, res: Response) => {
  const { userId, email } = (req as any).user;
  res.json({ id: userId, email });
});

// ---- Middleware ----

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers["authorization"];
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Not authenticated." });
    return;
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, ACTIVE_JWT_SECRET, { algorithms: ["HS256"] }) as { userId: number; email: string };
    (req as any).user = payload;
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token." });
  }
}

export default router;
