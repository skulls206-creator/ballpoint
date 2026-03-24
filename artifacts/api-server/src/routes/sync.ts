import { Router, type IRouter, type Request, type Response } from "express";
import { Wallet } from "ethers";
import { requireAuth } from "./auth";

const router: IRouter = Router();

const ETH_PRIVATE_KEY = process.env["ETH_PRIVATE_KEY"] ?? "";
const LIGHTHOUSE_API_KEY = process.env["LIGHTHOUSE_API_KEY"] ?? "";

function getWallet(): Wallet {
  if (!ETH_PRIVATE_KEY) throw new Error("ETH_PRIVATE_KEY not set");
  return new Wallet(ETH_PRIVATE_KEY);
}

// GET /sync/wallet — returns wallet address and lighthouse API key (for browser UI)
router.get("/sync/wallet", requireAuth, async (_req: Request, res: Response) => {
  try {
    const wallet = getWallet();
    res.json({
      address: wallet.address,
      lighthouseApiKey: LIGHTHOUSE_API_KEY ? "configured" : "not-configured",
      hasLighthouseKey: !!LIGHTHOUSE_API_KEY,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Wallet configuration error" });
  }
});

// POST /sync/sign — signs a message with the server-side ETH private key
router.post("/sync/sign", requireAuth, async (req: Request, res: Response) => {
  const { message } = req.body as { message?: string };
  if (!message || typeof message !== "string") {
    res.status(400).json({ error: "message is required" });
    return;
  }
  try {
    const wallet = getWallet();
    const signature = await wallet.signMessage(message);
    res.json({ signature, address: wallet.address });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Signing error" });
  }
});

// POST /sync/upload — upload an encrypted blob to Lighthouse IPFS
// Body: { data: string (base64-encoded encrypted blob), filename?: string }
router.post("/sync/upload", requireAuth, async (req: Request, res: Response) => {
  const { data, filename = "backup.bin" } = req.body as { data?: string; filename?: string };
  if (!data || typeof data !== "string") {
    res.status(400).json({ error: "data (base64) is required" });
    return;
  }
  if (!LIGHTHOUSE_API_KEY) {
    res.status(503).json({ error: "Lighthouse API key not configured on server" });
    return;
  }

  try {
    const bytes = Buffer.from(data, "base64");

    // Build multipart/form-data manually using fetch
    const boundary = `----ballpoint${Date.now()}`;
    const CRLF = "\r\n";
    const header = `--${boundary}${CRLF}Content-Disposition: form-data; name="file"; filename="${filename}"${CRLF}Content-Type: application/octet-stream${CRLF}${CRLF}`;
    const footer = `${CRLF}--${boundary}--${CRLF}`;

    const headerBuf = Buffer.from(header, "utf-8");
    const footerBuf = Buffer.from(footer, "utf-8");
    const body = Buffer.concat([headerBuf, bytes, footerBuf]);

    const response = await fetch("https://node.lighthouse.storage/api/v0/add", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LIGHTHOUSE_API_KEY}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      res.status(502).json({ error: `Lighthouse upload failed: ${response.status} ${text}` });
      return;
    }

    const result = await response.json() as { Hash?: string; Name?: string; Size?: string };
    const cid = result.Hash;
    if (!cid) {
      res.status(502).json({ error: "Lighthouse did not return a CID" });
      return;
    }

    res.json({ cid, size: result.Size ?? bytes.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Upload error" });
  }
});

// GET /sync/download/:cid — proxy-fetch an encrypted blob from IPFS gateway
router.get("/sync/download/:cid", requireAuth, async (req: Request, res: Response) => {
  const { cid } = req.params as { cid: string };
  if (!cid || !/^[a-zA-Z0-9]+$/.test(cid)) {
    res.status(400).json({ error: "Invalid CID" });
    return;
  }

  try {
    // Try Lighthouse gateway first, fall back to public IPFS
    const urls = [
      `https://gateway.lighthouse.storage/ipfs/${cid}`,
      `https://ipfs.io/ipfs/${cid}`,
    ];

    let lastError = "";
    for (const url of urls) {
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
        if (response.ok) {
          const buf = await response.arrayBuffer();
          const b64 = Buffer.from(buf).toString("base64");
          res.json({ data: b64, cid });
          return;
        }
        lastError = `${response.status} from ${url}`;
      } catch (e: any) {
        lastError = e.message;
      }
    }

    res.status(502).json({ error: `Could not fetch CID from IPFS: ${lastError}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Download error" });
  }
});

// GET /sync/history — list previously uploaded backups stored in DB
// For now we use a simple in-memory list; IndexedDB on client is the canonical store
router.get("/sync/ping", requireAuth, (_req: Request, res: Response) => {
  res.json({ ok: true, hasLighthouseKey: !!LIGHTHOUSE_API_KEY, hasEthKey: !!ETH_PRIVATE_KEY });
});

export default router;
