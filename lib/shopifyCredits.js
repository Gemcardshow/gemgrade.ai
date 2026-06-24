import crypto from "node:crypto";
import { grantPurchaseCredits } from "./credits.js";

/**
 * @param {string} email
 * @returns {string}
 */
export function normalizeShopifyEmail(email) {
  return String(email ?? "").trim().toLowerCase();
}

/**
 * @param {unknown} raw
 * @returns {Record<string, number>}
 */
export function parseCreditMapEnv(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    return {};
  }

  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  /** @type {Record<string, number>} */
  const map = {};

  for (const [key, value] of Object.entries(parsed)) {
    const credits = Number(value);

    if (key && Number.isFinite(credits) && credits > 0) {
      map[String(key).trim()] = Math.floor(credits);
    }
  }

  return map;
}

/**
 * @returns {{ variantMap: Record<string, number>, skuMap: Record<string, number> }}
 */
export function loadShopifyCreditMaps() {
  return {
    variantMap: parseCreditMapEnv(process.env.SHOPIFY_CREDIT_VARIANT_MAP),
    skuMap: parseCreditMapEnv(process.env.SHOPIFY_CREDIT_SKU_MAP),
  };
}

/**
 * @param {Buffer | string} rawBody
 * @param {string | string[] | undefined} hmacHeader
 * @param {string} secret
 * @returns {boolean}
 */
export function verifyShopifyWebhookHmac(rawBody, hmacHeader, secret) {
  if (!secret || !hmacHeader) {
    return false;
  }

  const headerValue = Array.isArray(hmacHeader) ? hmacHeader[0] : hmacHeader;

  if (!headerValue) {
    return false;
  }

  const bodyBuffer = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(rawBody, "utf8");

  const digest = crypto
    .createHmac("sha256", secret)
    .update(bodyBuffer)
    .digest("base64");

  const digestBuffer = Buffer.from(digest);
  const headerBuffer = Buffer.from(headerValue);

  if (digestBuffer.length !== headerBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(digestBuffer, headerBuffer);
}

/**
 * @param {Array<Record<string, unknown>>} lineItems
 * @param {{ variantMap?: Record<string, number>, skuMap?: Record<string, number> }} maps
 * @returns {{ credits: number, matchedItems: Array<Record<string, unknown>> }}
 */
export function sumCreditsFromLineItems(lineItems, maps = {}) {
  const variantMap = maps.variantMap ?? {};
  const skuMap = maps.skuMap ?? {};
  let credits = 0;
  /** @type {Array<Record<string, unknown>>} */
  const matchedItems = [];

  for (const item of lineItems) {
    const quantity = Math.max(1, Number(item.quantity) || 1);
    const variantId =
      item.variant_id !== undefined && item.variant_id !== null
        ? String(item.variant_id)
        : "";
    const sku =
      typeof item.sku === "string" && item.sku.trim()
        ? item.sku.trim()
        : "";

    const perUnit =
      (variantId && variantMap[variantId]) ||
      (sku && skuMap[sku]) ||
      0;

    if (perUnit > 0) {
      const lineCredits = perUnit * quantity;
      credits += lineCredits;
      matchedItems.push({
        variant_id: variantId || null,
        sku: sku || null,
        quantity,
        credits_per_unit: perUnit,
        credits: lineCredits,
      });
    }
  }

  return { credits, matchedItems };
}

/**
 * @param {Record<string, unknown>} order
 * @param {{ variantMap?: Record<string, number>, skuMap?: Record<string, number> }} [maps]
 */
export function extractShopifyOrderCredits(order, maps) {
  const loadedMaps = maps ?? loadShopifyCreditMaps();
  const lineItems = Array.isArray(order.line_items) ? order.line_items : [];
  const { credits, matchedItems } = sumCreditsFromLineItems(lineItems, loadedMaps);

  const email = normalizeShopifyEmail(
    typeof order.email === "string"
      ? order.email
      : typeof order.customer === "object" &&
          order.customer &&
          typeof order.customer.email === "string"
        ? order.customer.email
        : "",
  );

  const orderId =
    order.id !== undefined && order.id !== null ? String(order.id) : "";

  const orderNumber =
    order.order_number !== undefined && order.order_number !== null
      ? String(order.order_number)
      : order.name !== undefined && order.name !== null
        ? String(order.name)
        : null;

  return {
    email,
    orderId,
    orderNumber,
    credits,
    matchedItems,
  };
}

/**
 * @typedef {"granted"|"pending"|"duplicate"|"ignored"} ShopifyOrderProcessStatus
 */

/**
 * @typedef {Object} ShopifyOrderProcessResult
 * @property {ShopifyOrderProcessStatus} status
 * @property {string} shopifyOrderId
 * @property {number} credits
 * @property {string} [transactionId]
 * @property {string} [pendingGrantId]
 * @property {number} [balance]
 * @property {string} [userId]
 * @property {string} [email]
 */

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} shopifyOrderId
 */
async function findExistingShopifyFulfillment(supabase, shopifyOrderId) {
  const { data: transaction, error: transactionError } = await supabase
    .from("credit_transactions")
    .select("id")
    .eq("shopify_order_id", shopifyOrderId)
    .maybeSingle();

  if (transactionError) {
    throw new Error(transactionError.message);
  }

  if (transaction) {
    return { kind: "transaction", id: String(transaction.id) };
  }

  const { data: pending, error: pendingError } = await supabase
    .from("pending_credit_grants")
    .select("id, fulfilled_at")
    .eq("shopify_order_id", shopifyOrderId)
    .maybeSingle();

  if (pendingError) {
    throw new Error(pendingError.message);
  }

  if (pending) {
    return {
      kind: "pending",
      id: String(pending.id),
      fulfilled: Boolean(pending.fulfilled_at),
    };
  }

  return null;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} email
 */
async function findProfileIdByEmail(supabase, email) {
  const normalizedEmail = normalizeShopifyEmail(email);

  if (!normalizedEmail) {
    return null;
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, email")
    .ilike("email", normalizedEmail)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return profile ? { id: String(profile.id), email: String(profile.email) } : null;
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {Record<string, unknown>} order
 * @param {{ variantMap?: Record<string, number>, skuMap?: Record<string, number> }} [options]
 * @returns {Promise<ShopifyOrderProcessResult>}
 */
export async function processShopifyPaidOrder(supabase, order, options = {}) {
  const extracted = extractShopifyOrderCredits(order, options);

  if (!extracted.orderId) {
    throw new Error("Shopify order id is required");
  }

  if (extracted.credits <= 0) {
    return {
      status: "ignored",
      shopifyOrderId: extracted.orderId,
      credits: 0,
    };
  }

  const existing = await findExistingShopifyFulfillment(
    supabase,
    extracted.orderId,
  );

  if (existing) {
    return {
      status: "duplicate",
      shopifyOrderId: extracted.orderId,
      credits: extracted.credits,
      transactionId: existing.kind === "transaction" ? existing.id : undefined,
      pendingGrantId: existing.kind === "pending" ? existing.id : undefined,
    };
  }

  const metadata = {
    source: "shopify",
    shopify_order_id: extracted.orderId,
    shopify_order_number: extracted.orderNumber,
    customer_email: extracted.email,
    matched_line_items: extracted.matchedItems,
  };

  const profile = extracted.email
    ? await findProfileIdByEmail(supabase, extracted.email)
    : null;

  if (profile) {
    const grant = await grantPurchaseCredits(
      supabase,
      profile.id,
      extracted.credits,
      metadata,
      { shopifyOrderId: extracted.orderId },
    );

    return {
      status: "granted",
      shopifyOrderId: extracted.orderId,
      credits: extracted.credits,
      transactionId: grant.transactionId,
      balance: grant.balance,
      userId: profile.id,
      email: profile.email,
    };
  }

  if (!extracted.email) {
    throw new Error("Shopify order is missing customer email");
  }

  const { data: pendingGrant, error: pendingError } = await supabase
    .from("pending_credit_grants")
    .insert({
      email: extracted.email,
      credits: extracted.credits,
      shopify_order_id: extracted.orderId,
      shopify_order_number: extracted.orderNumber,
      metadata,
    })
    .select("id")
    .single();

  if (pendingError) {
    if (pendingError.code === "23505") {
      return {
        status: "duplicate",
        shopifyOrderId: extracted.orderId,
        credits: extracted.credits,
      };
    }

    throw new Error(pendingError.message);
  }

  return {
    status: "pending",
    shopifyOrderId: extracted.orderId,
    credits: extracted.credits,
    pendingGrantId: String(pendingGrant.id),
    email: extracted.email,
  };
}

/**
 * @typedef {Object} FulfillPendingGrantsResult
 * @property {number} fulfilledCount
 * @property {number} creditsGranted
 * @property {number} balance
 * @property {string[]} transactionIds
 */

/**
 * Fulfill unclaimed Shopify pending grants for a user email (signup/login/balance read).
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} userId
 * @param {string} email
 * @returns {Promise<FulfillPendingGrantsResult>}
 */
export async function fulfillPendingGrantsForEmail(supabase, userId, email) {
  const normalizedEmail = normalizeShopifyEmail(email);

  if (!normalizedEmail) {
    return {
      fulfilledCount: 0,
      creditsGranted: 0,
      balance: await readProfileBalance(supabase, userId),
      transactionIds: [],
    };
  }

  const { data: pendingRows, error: pendingError } = await supabase
    .from("pending_credit_grants")
    .select("id, credits, shopify_order_id, shopify_order_number, metadata")
    .is("fulfilled_at", null)
    .ilike("email", normalizedEmail)
    .order("created_at", { ascending: true });

  if (pendingError) {
    throw new Error(pendingError.message);
  }

  let fulfilledCount = 0;
  let creditsGranted = 0;
  /** @type {string[]} */
  const transactionIds = [];

  for (const row of pendingRows ?? []) {
    const shopifyOrderId = String(row.shopify_order_id);
    const existing = await findExistingShopifyFulfillment(supabase, shopifyOrderId);

    if (existing?.kind === "transaction") {
      await supabase
        .from("pending_credit_grants")
        .update({
          fulfilled_at: new Date().toISOString(),
          fulfilled_user_id: userId,
        })
        .eq("id", row.id)
        .is("fulfilled_at", null);
      continue;
    }

    const metadata =
      row.metadata && typeof row.metadata === "object"
        ? { ...row.metadata, fulfilled_via: "pending_grant" }
        : {
            source: "shopify",
            shopify_order_id: shopifyOrderId,
            shopify_order_number: row.shopify_order_number,
            fulfilled_via: "pending_grant",
          };

    try {
      const grant = await grantPurchaseCredits(
        supabase,
        userId,
        Number(row.credits),
        metadata,
        { shopifyOrderId },
      );

      const fulfilledAt = new Date().toISOString();
      const { error: markError } = await supabase
        .from("pending_credit_grants")
        .update({
          fulfilled_at: fulfilledAt,
          fulfilled_user_id: userId,
        })
        .eq("id", row.id)
        .is("fulfilled_at", null);

      if (markError) {
        throw new Error(markError.message);
      }

      fulfilledCount += 1;
      creditsGranted += Number(row.credits);
      transactionIds.push(grant.transactionId);
    } catch (error) {
      if (
        error instanceof Error &&
        /duplicate|unique|already/i.test(error.message)
      ) {
        await supabase
          .from("pending_credit_grants")
          .update({
            fulfilled_at: new Date().toISOString(),
            fulfilled_user_id: userId,
          })
          .eq("id", row.id)
          .is("fulfilled_at", null);
        continue;
      }

      throw error;
    }
  }

  return {
    fulfilledCount,
    creditsGranted,
    balance: await readProfileBalance(supabase, userId),
    transactionIds,
  };
}

/**
 * @param {import("@supabase/supabase-js").SupabaseClient} supabase
 * @param {string} userId
 */
async function readProfileBalance(supabase, userId) {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("credit_balance")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return Number(profile?.credit_balance ?? 0);
}
