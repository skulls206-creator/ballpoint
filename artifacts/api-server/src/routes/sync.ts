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
 * GET /sync/ping
 * Health check: confirms whether Lighthouse API key and ETH key are configured.
 */
router.get("/sync/ping", requireAuth, (_req: Request, res: Response) => {
  res.json({ ok: true, hasLighthouseKey: !!LIGHTHOUSE_API_KEY, hasEthKey: !!ETH_PRIVATE_KEY });
});

export default router;
