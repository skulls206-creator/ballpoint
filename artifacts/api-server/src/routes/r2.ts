import { Router, type IRouter, type Request, type Response } from "express";
import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { requireAuth } from "./auth";
import type { Readable } from "stream";

const router: IRouter = Router();

// ── R2 client (lazy, one per request to pick up env changes) ─────────────────

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
  if (typeof (body as any).getReader === "function") {
    const reader = (body as ReadableStream).getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value as Uint8Array);
    }
    const total = new Uint8Array(chunks.reduce((acc, c) => acc + c.length, 0));
    let offset = 0;
    for (const c of chunks) { total.set(c, offset); offset += c.length; }
    return new TextDecoder().decode(total);
  }
  return new Promise<string>((resolve, reject) => {
    const bufs: Buffer[] = [];
    (body as Readable).on("data", (c: Buffer) => bufs.push(c));
    (body as Readable).on("end", () => resolve(Buffer.concat(bufs).toString("utf-8")));
    (body as Readable).on("error", reject);
  });
}

function sanitizeNoteId(id: string): boolean {
  return !id.includes("/") && !id.includes("\\") && !id.includes("..");
}

// ── Public route: status (no auth needed so the UI can check before login) ───

router.get("/r2/status", async (_req: Request, res: Response) => {
  const client = getR2Client();
  const bucket = getBucket();
  res.json({ configured: client !== null && Boolean(bucket), bucket });
});

// ── All other R2 routes require JWT ──────────────────────────────────────────

router.use("/r2", requireAuth as any);

// GET /r2/key — fetch vault key descriptor
router.get("/r2/key", async (req: Request, res: Response) => {
  const client = getR2Client();
  if (!client) { res.status(503).json({ error: "R2 not configured" }); return; }
  const userId = (req as any).user.userId as number;
  try {
    const resp = await client.send(
      new GetObjectCommand({ Bucket: getBucket(), Key: `notes/${userId}/.ballpoint-key` })
    );
    const content = await readStream(resp.Body as Readable);
    res.json({ content });
  } catch (e: any) {
    if (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) {
      res.status(404).json({ error: "No key file" });
    } else {
      res.status(500).json({ error: e.message ?? "R2 error" });
    }
  }
});

// PUT /r2/key — store vault key descriptor
router.put("/r2/key", async (req: Request, res: Response) => {
  const client = getR2Client();
  if (!client) { res.status(503).json({ error: "R2 not configured" }); return; }
  const userId = (req as any).user.userId as number;
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

// GET /r2/notes — list notes for this user
router.get("/r2/notes", async (req: Request, res: Response) => {
  const client = getR2Client();
  if (!client) { res.status(503).json({ error: "R2 not configured" }); return; }
  const userId = (req as any).user.userId as number;
  const prefix = `notes/${userId}/`;
  const SYSTEM_KEYS = new Set([".ballpoint-key", ".ballpoint-meta", ".ballpoint-tasks"]);
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
  } catch (e: any) {
    res.status(500).json({ error: e.message ?? "R2 error" });
  }
});

// GET /r2/notes/:noteId — get encrypted note content
router.get("/r2/notes/:noteId", async (req: Request, res: Response) => {
  const client = getR2Client();
  if (!client) { res.status(503).json({ error: "R2 not configured" }); return; }
  const userId = (req as any).user.userId as number;
  const { noteId } = req.params as { noteId: string };
  if (!sanitizeNoteId(noteId)) { res.status(400).json({ error: "Invalid note ID" }); return; }
  try {
    const resp = await client.send(
      new GetObjectCommand({ Bucket: getBucket(), Key: `notes/${userId}/${noteId}` })
    );
    const content = await readStream(resp.Body as Readable);
    res.json({ content });
  } catch (e: any) {
    if (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) {
      res.status(404).json({ error: "Note not found" });
    } else {
      res.status(500).json({ error: e.message ?? "R2 error" });
    }
  }
});

// PUT /r2/notes/:noteId — save encrypted note content
router.put("/r2/notes/:noteId", async (req: Request, res: Response) => {
  const client = getR2Client();
  if (!client) { res.status(503).json({ error: "R2 not configured" }); return; }
  const userId = (req as any).user.userId as number;
  const { noteId } = req.params as { noteId: string };
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

// DELETE /r2/notes/:noteId — delete note
router.delete("/r2/notes/:noteId", async (req: Request, res: Response) => {
  const client = getR2Client();
  if (!client) { res.status(503).json({ error: "R2 not configured" }); return; }
  const userId = (req as any).user.userId as number;
  const { noteId } = req.params as { noteId: string };
  if (!sanitizeNoteId(noteId)) { res.status(400).json({ error: "Invalid note ID" }); return; }
  await client.send(
    new DeleteObjectCommand({ Bucket: getBucket(), Key: `notes/${userId}/${noteId}` })
  );
  res.json({ ok: true });
});

// GET /r2/meta — get metadata JSON
router.get("/r2/meta", async (req: Request, res: Response) => {
  const client = getR2Client();
  if (!client) { res.status(503).json({ error: "R2 not configured" }); return; }
  const userId = (req as any).user.userId as number;
  try {
    const resp = await client.send(
      new GetObjectCommand({ Bucket: getBucket(), Key: `notes/${userId}/.ballpoint-meta` })
    );
    const content = await readStream(resp.Body as Readable);
    res.json({ content });
  } catch (e: any) {
    if (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) {
      res.json({ content: "{}" });
    } else {
      res.status(500).json({ error: e.message ?? "R2 error" });
    }
  }
});

// PUT /r2/meta — save metadata JSON
router.put("/r2/meta", async (req: Request, res: Response) => {
  const client = getR2Client();
  if (!client) { res.status(503).json({ error: "R2 not configured" }); return; }
  const userId = (req as any).user.userId as number;
  const { content } = req.body as { content: string };
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

// GET /r2/tasks — get tasks JSON
router.get("/r2/tasks", async (req: Request, res: Response) => {
  const client = getR2Client();
  if (!client) { res.status(503).json({ error: "R2 not configured" }); return; }
  const userId = (req as any).user.userId as number;
  try {
    const resp = await client.send(
      new GetObjectCommand({ Bucket: getBucket(), Key: `notes/${userId}/.ballpoint-tasks` })
    );
    const content = await readStream(resp.Body as Readable);
    res.json({ content });
  } catch (e: any) {
    if (e.name === "NoSuchKey" || e.$metadata?.httpStatusCode === 404) {
      res.json({ content: "{}" });
    } else {
      res.status(500).json({ error: e.message ?? "R2 error" });
    }
  }
});

// PUT /r2/tasks — save tasks JSON
router.put("/r2/tasks", async (req: Request, res: Response) => {
  const client = getR2Client();
  if (!client) { res.status(503).json({ error: "R2 not configured" }); return; }
  const userId = (req as any).user.userId as number;
  const { content } = req.body as { content: string };
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
