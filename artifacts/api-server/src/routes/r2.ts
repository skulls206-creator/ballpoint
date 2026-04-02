import { Router, Request, Response, NextFunction } from "express";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { requireAuth } from "./auth";
import type { Readable } from "stream";

const router = Router();

// ── Typed auth request ────────────────────────────────────────────────────────

interface AuthedRequest extends Request {
  user: { userId: number; email: string };
}

function authed(req: Request): AuthedRequest {
  return req as AuthedRequest;
}

// ── R2 client ─────────────────────────────────────────────────────────────────

function getR2Client(): S3Client | null {
  const accountId = process.env["R2_ACCOUNT_ID"];
  const accessKeyId = process.env["R2_ACCESS_KEY_ID"];
  const secretAccessKey = process.env["R2_SECRET_ACCESS_KEY"];
  if (!accountId || !accessKeyId || !secretAccessKey) return null;
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
}

function getBucket(): string {
  return process.env["R2_BUCKET_NAME"] ?? "ballpoint-notes";
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function readStream(
  body: Readable | ReadableStream | Blob | string | null | undefined
): Promise<string> {
  if (!body) return "";
  if (typeof body === "string") return body;
  if (body instanceof Blob) return body.text();
  if (typeof (body as ReadableStream).getReader === "function") {
    const reader = (body as ReadableStream).getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value as Uint8Array);
    }
    const total = new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0));
    let off = 0;
    for (const c of chunks) { total.set(c, off); off += c.length; }
    return new TextDecoder().decode(total);
  }
  return new Promise<string>((resolve, reject) => {
    const bufs: Buffer[] = [];
    (body as Readable).on("data", (c: Buffer) => bufs.push(c));
    (body as Readable).on("end", () => resolve(Buffer.concat(bufs).toString("utf-8")));
    (body as Readable).on("error", reject);
  });
}

function noR2(res: Response): void {
  res.status(503).json({ error: "R2 not configured" });
}

function sanitizeNoteId(id: string): boolean {
  return id.length > 0 && !id.includes("/") && !id.includes("\\") && !id.includes("..");
}

// ── Public: status ────────────────────────────────────────────────────────────

router.get("/r2/status", (_req: Request, res: Response) => {
  const client = getR2Client();
  const bucket = getBucket();
  res.json({ configured: client !== null && Boolean(bucket), bucket });
});

// ── Vault key ─────────────────────────────────────────────────────────────────

router.get("/r2/key", requireAuth, async (req: Request, res: Response) => {
  const client = getR2Client();
  if (!client) { noR2(res); return; }
  const { userId } = authed(req).user;
  try {
    const resp = await client.send(
      new GetObjectCommand({ Bucket: getBucket(), Key: `notes/${userId}/.ballpoint-key` })
    );
    const content = await readStream(resp.Body as Readable);
    res.json({ content });
  } catch (err: unknown) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number }; message?: string };
    if (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) {
      res.status(404).json({ error: "No key file" });
    } else {
      res.status(500).json({ error: e.message ?? "R2 error" });
    }
  }
});

router.put("/r2/key", requireAuth, async (req: Request, res: Response) => {
  const client = getR2Client();
  if (!client) { noR2(res); return; }
  const { userId } = authed(req).user;
  const { content } = req.body as { content: string };
  if (!content) { res.status(400).json({ error: "content required" }); return; }
  await client.send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: `notes/${userId}/.ballpoint-key`,
      Body: content,
      ContentType: "application/json",
    })
  );
  res.json({ ok: true });
});

// ── Notes list ────────────────────────────────────────────────────────────────

const SYSTEM_KEYS = new Set([".ballpoint-key", ".ballpoint-meta", ".ballpoint-tasks"]);

router.get("/r2/notes", requireAuth, async (req: Request, res: Response) => {
  const client = getR2Client();
  if (!client) { noR2(res); return; }
  const { userId } = authed(req).user;
  const prefix = `notes/${userId}/`;
  try {
    const result = await client.send(
      new ListObjectsV2Command({ Bucket: getBucket(), Prefix: prefix })
    );
    const notes = (result.Contents ?? [])
      .filter(obj => {
        const name = obj.Key!.slice(prefix.length);
        return name.length > 0 && !SYSTEM_KEYS.has(name);
      })
      .map(obj => ({
        key: obj.Key!.slice(prefix.length),
        lastModified: obj.LastModified?.getTime() ?? 0,
        size: obj.Size ?? 0,
      }));
    res.json({ notes });
  } catch (err: unknown) {
    const e = err as { message?: string };
    res.status(500).json({ error: e.message ?? "R2 error" });
  }
});

// ── Note CRUD ─────────────────────────────────────────────────────────────────

router.get("/r2/notes/:noteId", requireAuth, async (req: Request, res: Response) => {
  const client = getR2Client();
  if (!client) { noR2(res); return; }
  const { userId } = authed(req).user;
  const { noteId } = req.params;
  if (!sanitizeNoteId(noteId)) { res.status(400).json({ error: "Invalid note ID" }); return; }
  try {
    const resp = await client.send(
      new GetObjectCommand({ Bucket: getBucket(), Key: `notes/${userId}/${noteId}` })
    );
    const content = await readStream(resp.Body as Readable);
    res.json({ content });
  } catch (err: unknown) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number }; message?: string };
    if (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) {
      res.status(404).json({ error: "Note not found" });
    } else {
      res.status(500).json({ error: e.message ?? "R2 error" });
    }
  }
});

router.put("/r2/notes/:noteId", requireAuth, async (req: Request, res: Response) => {
  const client = getR2Client();
  if (!client) { noR2(res); return; }
  const { userId } = authed(req).user;
  const { noteId } = req.params;
  if (!sanitizeNoteId(noteId)) { res.status(400).json({ error: "Invalid note ID" }); return; }
  const { content } = req.body as { content: string };
  if (content === undefined) { res.status(400).json({ error: "content required" }); return; }
  await client.send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: `notes/${userId}/${noteId}`,
      Body: content,
      ContentType: "text/plain; charset=utf-8",
    })
  );
  res.json({ ok: true });
});

router.delete("/r2/notes/:noteId", requireAuth, async (req: Request, res: Response) => {
  const client = getR2Client();
  if (!client) { noR2(res); return; }
  const { userId } = authed(req).user;
  const { noteId } = req.params;
  if (!sanitizeNoteId(noteId)) { res.status(400).json({ error: "Invalid note ID" }); return; }
  await client.send(
    new DeleteObjectCommand({ Bucket: getBucket(), Key: `notes/${userId}/${noteId}` })
  );
  res.json({ ok: true });
});

// ── Metadata (GET/PUT /r2/metadata) ──────────────────────────────────────────

router.get("/r2/metadata", requireAuth, async (req: Request, res: Response) => {
  const client = getR2Client();
  if (!client) { noR2(res); return; }
  const { userId } = authed(req).user;
  try {
    const resp = await client.send(
      new GetObjectCommand({ Bucket: getBucket(), Key: `notes/${userId}/.ballpoint-meta` })
    );
    const content = await readStream(resp.Body as Readable);
    res.json({ content });
  } catch (err: unknown) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number }; message?: string };
    if (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) {
      res.json({ content: "{}" });
    } else {
      res.status(500).json({ error: e.message ?? "R2 error" });
    }
  }
});

router.put("/r2/metadata", requireAuth, async (req: Request, res: Response) => {
  const client = getR2Client();
  if (!client) { noR2(res); return; }
  const { userId } = authed(req).user;
  const { content } = req.body as { content: string };
  if (content === undefined) { res.status(400).json({ error: "content required" }); return; }
  await client.send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: `notes/${userId}/.ballpoint-meta`,
      Body: content,
      ContentType: "application/json",
    })
  );
  res.json({ ok: true });
});

// ── Tasks (GET/PUT /r2/tasks) ─────────────────────────────────────────────────

router.get("/r2/tasks", requireAuth, async (req: Request, res: Response) => {
  const client = getR2Client();
  if (!client) { noR2(res); return; }
  const { userId } = authed(req).user;
  try {
    const resp = await client.send(
      new GetObjectCommand({ Bucket: getBucket(), Key: `notes/${userId}/.ballpoint-tasks` })
    );
    const content = await readStream(resp.Body as Readable);
    res.json({ content });
  } catch (err: unknown) {
    const e = err as { name?: string; $metadata?: { httpStatusCode?: number }; message?: string };
    if (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) {
      res.json({ content: "{}" });
    } else {
      res.status(500).json({ error: e.message ?? "R2 error" });
    }
  }
});

router.put("/r2/tasks", requireAuth, async (req: Request, res: Response) => {
  const client = getR2Client();
  if (!client) { noR2(res); return; }
  const { userId } = authed(req).user;
  const { content } = req.body as { content: string };
  if (content === undefined) { res.status(400).json({ error: "content required" }); return; }
  await client.send(
    new PutObjectCommand({
      Bucket: getBucket(),
      Key: `notes/${userId}/.ballpoint-tasks`,
      Body: content,
      ContentType: "application/json",
    })
  );
  res.json({ ok: true });
});

export default router;
