import {
  loadShopifyCreditMaps,
  processShopifyPaidOrder,
  verifyShopifyWebhookHmac,
} from "../../../lib/shopifyCredits.js";
import { getServiceRoleClient } from "../../../lib/supabase/server.js";

export const config = {
  api: {
    bodyParser: false,
  },
};

/**
 * @param {import("http").IncomingMessage} req
 * @returns {Promise<Buffer>}
 */
function readRawBody(req) {
  return new Promise((resolve, reject) => {
    /** @type {Buffer[]} */
    const chunks = [];

    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks));
    });

    req.on("error", reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = process.env.SHOPIFY_WEBHOOK_SECRET?.trim();

  if (!secret) {
    console.error("shopify_webhook missing SHOPIFY_WEBHOOK_SECRET");
    return res.status(503).json({ error: "Shopify webhook is not configured" });
  }

  const supabase = getServiceRoleClient();

  if (!supabase) {
    console.error("shopify_webhook missing Supabase service role");
    return res.status(503).json({ error: "Supabase service role is not configured" });
  }

  let rawBody;

  try {
    rawBody = await readRawBody(req);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to read body";
    console.error("shopify_webhook read body failed:", message);
    return res.status(400).json({ error: "Invalid request body" });
  }

  const hmacHeader = req.headers["x-shopify-hmac-sha256"];

  if (!verifyShopifyWebhookHmac(rawBody, hmacHeader, secret)) {
    return res.status(401).json({ error: "Invalid webhook signature" });
  }

  const topic = req.headers["x-shopify-topic"];

  if (topic !== "orders/paid") {
    return res.status(200).json({ ignored: true, topic });
  }

  let order;

  try {
    order = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Invalid JSON payload" });
  }

  try {
    const maps = loadShopifyCreditMaps();
    const result = await processShopifyPaidOrder(supabase, order, maps);

    console.info(
      "shopify_webhook orders/paid",
      JSON.stringify({
        status: result.status,
        shopifyOrderId: result.shopifyOrderId,
        credits: result.credits,
        email: result.email ?? null,
        userId: result.userId ?? null,
      }),
    );

    return res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to process Shopify order";
    console.error("shopify_webhook process failed:", message);
    return res.status(500).json({ error: message });
  }
}
