"use client";

import { useEffect } from "react";
import { isNativeIosApp } from "../lib/platform.js";
import { createSupabaseBrowserClient } from "../lib/supabase/browser.js";
import { hasUsableSupabasePublicConfig } from "../lib/supabase/env.js";

/**
 * Finishes StoreKit transactions that were interrupted before credits were granted.
 * Renders nothing. Web and Android do not call StoreKit.
 */
export default function AppleIapTransactionSync() {
  useEffect(() => {
    if (!hasUsableSupabasePublicConfig() || !isNativeIosApp()) {
      return undefined;
    }

    let active = true;
    /** @type {undefined | (() => void)} */
    let removeListener;

    async function start() {
      const {
        getAppleIapPlugin,
        processAppleSignedTransaction,
        syncUnfinishedAppleTransactions,
      } = await import("../lib/appleIapClient.js");

      if (!active) {
        return;
      }

      const nativePlugin = getAppleIapPlugin();
      if (!nativePlugin) {
        console.info("[apple-iap] native plugin unavailable");
        return;
      }

      const supabase = createSupabaseBrowserClient();
      if (supabase) {
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (active && user) {
          await syncUnfinishedAppleTransactions();
        }
      }

      const handle = await nativePlugin.addListener?.(
        "transactionUpdated",
        (event) => {
          if (!active || !event?.signedTransaction || !event?.transactionId) {
            return;
          }

          processAppleSignedTransaction(
            event.signedTransaction,
            event.transactionId,
          ).catch((error) => {
            console.error(
              "[apple-iap] transaction update failed",
              event.transactionId,
              error,
            );
          });
        },
      );

      removeListener = () => {
        handle?.remove?.();
      };
    }

    start().catch((error) => {
      console.error("[apple-iap] unfinished transaction sync failed", error);
    });

    return () => {
      active = false;
      removeListener?.();
    };
  }, []);

  return null;
}
