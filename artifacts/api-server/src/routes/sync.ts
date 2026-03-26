import { Router, type IRouter, type Request, type Response } from "express";
import { Wallet } from "ethers";
import { requireAuth } from "./auth";
import lighthouseDefault from "@lighthouse-web3/sdk";
// ESM/CJS compat — SDK may export as default or as the object itself
const lighthouse = (lighthouseDefault as any)?.default ?? lighthouseDefault;

const router: IRouter = Router();

const ETH_PRIVATE_KEY = process.env["ETH_PRIVATE_KEY"] ?? "";
const LIGHTHOUSE_API_KEY = process.env["LIGHTHOUSE_API_KEY"] ?? "";

function getWallet(): Wallet {
  if (!ETH_PRIVATE_KEY) throw new Error("ETH_PRIVATE_KEY not set");
  return new Wallet(ETH_PRIVATE_KEY);
}

/**
 * GET /sync/wallet
 * Returns the server-derived ETH wallet address and the Lighthouse API key.
 * The API key is safe to expose to the browser — it only allows uploads to
 * Lighthouse IPFS; it cannot sign transactions or move funds.
 * The ETH private key never leaves this server.
 */
router.get("/sync/wallet", requireAuth, async (_req: Request, res: Response) => {
  try {
    const wallet = getWallet();
    res.json({
      address: wallet.address,
      lighthouseApiKey: LIGHTHOUSE_API_KEY,
      hasLighthouseKey: !!LIGHTHOUSE_API_KEY,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message ?? "Wallet configuration error" });
  }
});

/**
 * POST /sync/sign
 * Signs an arbitrary message with the server-side ETH private key.
 * Used by the browser to obtain a Kavach authentication token:
 *   1. Browser calls lighthouse.getAuthMessage(address) → gets Kavach challenge
 *   2. Browser POSTs that challenge here → gets ETH signature
 *   3. Browser uses address + signature with lighthouse.uploadEncrypted() / fetchEncryptionKey()
 *
 * The ETH private key is never sent to the browser.
 */
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

/**
 * POST /sync/decrypt
 * Server-side Lighthouse + Kavach decrypt proxy.
 * Accepts { cid } and returns the decrypted notes JSON text.
 *
 * Why server-side: The browser's Lighthouse SDK calls to Kavach nodes and
 * the IPFS gateway fail in proxied iframe environments (CORS / network policy).
 * The server has unrestricted outbound access and holds the ETH private key.
 *
 * Flow:
 *   1. Get Kavach auth challenge from Lighthouse → sign with server ETH key
 *   2. lighthouse.fetchEncryptionKey(cid, address, sig) → masterKey from Kavach shards
 *   3. lighthouse.decryptFile(cid, masterKey) → encrypted blob from IPFS → plaintext
 */
router.post("/sync/decrypt", requireAuth, async (req: Request, res: Response) => {
  const { cid } = req.body as { cid?: string };
  if (!cid || typeof cid !== "string") {
    res.status(400).json({ error: "cid is required" });
    return;
  }
  try {
    const wallet = getWallet();
    const address = wallet.address;

    const authMsgResult = await lighthouse.getAuthMessage(address);
    const challengeMessage: string = (authMsgResult as any)?.data?.message;
    if (!challengeMessage) throw new Error("Failed to get Kavach auth message from Lighthouse");

    const signature = await wallet.signMessage(challengeMessage);

    const keyResponse = await lighthouse.fetchEncryptionKey(cid, address, signature);
    const masterKey: string | undefined = (keyResponse as any)?.data?.key;
    if (!masterKey) throw new Error("Failed to recover Kavach encryption key for CID: " + cid);

    const decryptedBlob = await lighthouse.decryptFile(cid, masterKey);
    if (!decryptedBlob) throw new Error("Failed to decrypt file from Lighthouse for CID: " + cid);

    // lighthouse.decryptFile returns different types depending on the environment:
    // browser → Blob, Node.js → may be Buffer, Uint8Array, ArrayBuffer, or string.
    let text: string;
    const raw = decryptedBlob as unknown;
    if (typeof raw === "string") {
      text = raw;
    } else if (Buffer.isBuffer(raw)) {
      text = (raw as Buffer).toString("utf8");
    } else if (raw instanceof Uint8Array) {
      text = Buffer.from(raw).toString("utf8");
    } else if (raw instanceof ArrayBuffer) {
      text = Buffer.from(raw).toString("utf8");
    } else if (typeof (raw as any).text === "function") {
      text = await (raw as Blob).text();
    } else if (typeof (raw as any).arrayBuffer === "function") {
      const ab = await (raw as Blob).arrayBuffer();
      text = Buffer.from(ab).toString("utf8");
    } else {
      // Last resort: JSON.stringify for debugging, then throw
      throw new Error(`Unexpected decryptFile return type: ${Object.prototype.toString.call(raw)}`);
    }
    res.json({ text });
  } catch (err: any) {
    res.status(502).json({ error: err.message ?? "Decrypt failed" });
  }
});

/**
 * GET /sync/ping
 * Health check: confirms whether Lighthouse API key and ETH key are configured.
 */
router.get("/sync/ping", requireAuth, (_req: Request, res: Response) => {
  res.json({ ok: true, hasLighthouseKey: !!LIGHTHOUSE_API_KEY, hasEthKey: !!ETH_PRIVATE_KEY });
});

export default router;
