/**
 * Platform detection for Capacitor shells and browsers.
 * Used to gate App Store purchase UI on iOS only.
 */

/**
 * @returns {"ios"|"android"|"web"}
 */
export function getAppPlatform() {
  if (typeof window === "undefined") {
    return "web";
  }

  const capacitor = window.Capacitor;
  if (capacitor && typeof capacitor.getPlatform === "function") {
    const platform = capacitor.getPlatform();
    if (platform === "ios" || platform === "android") {
      return platform;
    }
  }

  return "web";
}

/**
 * True when running inside the GemGrade iOS Capacitor app.
 * @returns {boolean}
 */
export function isNativeIosApp() {
  return getAppPlatform() === "ios";
}

/**
 * Hide external digital-credit purchase CTAs on iOS App Store builds.
 * Web and Android keep Shopify purchase links.
 * @returns {boolean}
 */
export function shouldHideExternalCreditPurchases() {
  return isNativeIosApp();
}
