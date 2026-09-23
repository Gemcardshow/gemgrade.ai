"use client";

import { useCallback, useEffect, useState } from "react";
import { APPLE_IAP_PRODUCTS } from "../lib/appleIap.js";
import {
  getAppleIapPlugin,
  processAppleSignedTransaction,
} from "../lib/appleIapClient.js";
import { createSupabaseBrowserClient } from "../lib/supabase/browser.js";

/**
 * @param {{ onBalance?: (balance: number) => void }} props
 */
export default function AppleCreditsPurchase({ onBalance }) {
  const [products, setProducts] = useState([]);
  const [missingCount, setMissingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [pluginReady, setPluginReady] = useState(true);
  const [purchasingId, setPurchasingId] = useState("");
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [purchaseError, setPurchaseError] = useState("");

  const loadProducts = useCallback(async () => {
    setLoading(true);
    setLoadError("");
    const nativePlugin = getAppleIapPlugin();

    if (!nativePlugin) {
      setPluginReady(false);
      setProducts([]);
      setLoading(false);
      console.error("[apple-iap] StoreKit plugin is not available in this build");
      return;
    }

    setPluginReady(true);

    try {
      const result = await nativePlugin.getProducts();
      const loaded = Array.isArray(result?.products) ? result.products : [];
      const ordered = Object.keys(APPLE_IAP_PRODUCTS)
        .map((productId) => loaded.find((product) => product?.productId === productId))
        .filter(Boolean);
      const missing = Array.isArray(result?.missingProductIds)
        ? result.missingProductIds.length
        : Object.keys(APPLE_IAP_PRODUCTS).length - ordered.length;

      setProducts(ordered);
      setMissingCount(missing);
      console.info(
        "[apple-iap]",
        JSON.stringify({
          event: "products_loaded",
          count: ordered.length,
          missing,
        }),
      );

      if (ordered.length === 0) {
        setLoadError(
          "App Store credit packs are unavailable. Confirm the products are cleared for sale, then try again.",
        );
      }
    } catch (productError) {
      console.error("[apple-iap] product load failed", productError);
      setProducts([]);
      setLoadError("Unable to load App Store prices. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProducts();
  }, [loadProducts]);

  /**
   * @param {string} productId
   */
  async function purchase(productId) {
    const nativePlugin = getAppleIapPlugin();
    if (!nativePlugin || purchasingId) {
      return;
    }

    const supabase = createSupabaseBrowserClient();
    const {
      data: { user },
    } = (await supabase?.auth.getUser()) ?? { data: { user: null } };

    if (!user) {
      setPurchaseError("Sign in before purchasing credits.");
      return;
    }

    setPurchasingId(productId);
    setPurchaseError("");
    setMessage("");

    try {
      console.info("[apple-iap]", JSON.stringify({ event: "purchase_start", productId }));
      const result = await nativePlugin.purchase({
        productId,
        appAccountToken: user.id,
      });
      const status = result?.status;

      if (status === "cancelled") {
        setMessage("Purchase cancelled.");
        return;
      }

      if (status === "pending") {
        setMessage(
          "This purchase is waiting for approval. Credits will be added when Apple completes it.",
        );
        return;
      }

      if (status !== "purchased" || !result.signedTransaction || !result.transactionId) {
        throw new Error("Apple did not return a completed purchase.");
      }

      const body = await processAppleSignedTransaction(
        result.signedTransaction,
        result.transactionId,
      );

      if (!body) {
        return;
      }

      if (typeof body.balance === "number") {
        onBalance?.(body.balance);
      }

      if (body.status === "already_processed") {
        setMessage("This purchase was already added to your balance.");
        return;
      }

      if (body.status === "revoked") {
        setPurchaseError("Apple refunded this purchase, so credits were not added.");
        return;
      }

      const granted = Number(body.creditsGranted) || APPLE_IAP_PRODUCTS[productId] || 0;
      setMessage(`${granted} credits added to your GemGrade account.`);
    } catch (failure) {
      console.error("[apple-iap] purchase failed", productId, failure);
      setPurchaseError(
        failure instanceof Error
          ? failure.message
          : "The App Store purchase could not be completed.",
      );
    } finally {
      setPurchasingId("");
    }
  }

  if (!pluginReady) {
    return (
      <p className="credits-page__error" role="alert">
        This iOS build does not include App Store purchases yet. Install the latest TestFlight build and reopen Credits.
      </p>
    );
  }

  return (
    <div className="credits-page__store">
      <p className="credits-page__note">
        Prices come from the App Store and are charged to your Apple ID. Credits are added to this GemGrade account after the purchase is verified.
      </p>

      {loading ? <p className="credits-page__note">Loading App Store prices...</p> : null}

      {products.length > 0 ? (
        <div className="credits-page__packs">
          {products.map((product) => {
            const credits = APPLE_IAP_PRODUCTS[product.productId];
            const price = typeof product.displayPrice === "string"
              ? product.displayPrice.trim()
              : "";
            const busy = purchasingId === product.productId;
            const disabled = Boolean(purchasingId) || !price;

            return (
              <article className="purchase-pack" key={product.productId}>
                <h2>{credits} credits</h2>
                <p className="purchase-pack__price">{price || "Price unavailable"}</p>
                <button
                  type="button"
                  className="purchase-pack__buy"
                  disabled={disabled}
                  aria-busy={busy}
                  onClick={() => purchase(product.productId)}
                >
                  {busy ? "Processing..." : price ? `Buy ${price}` : "Unavailable"}
                </button>
              </article>
            );
          })}
        </div>
      ) : null}

      {missingCount > 0 && products.length > 0 ? (
        <p className="credits-page__note">
          Some credit packs are not available from the App Store yet.
        </p>
      ) : null}

      {!loading && loadError ? (
        <div className="credits-page__store-status">
          <p className="credits-page__error" role="alert">{loadError}</p>
          <button type="button" className="purchase-pack__retry" onClick={loadProducts}>
            Try again
          </button>
        </div>
      ) : null}

      {purchaseError ? (
        <p className="credits-page__error" role="alert">{purchaseError}</p>
      ) : null}

      {message ? (
        <p className="credits-page__message" role="status">{message}</p>
      ) : null}
    </div>
  );
}
