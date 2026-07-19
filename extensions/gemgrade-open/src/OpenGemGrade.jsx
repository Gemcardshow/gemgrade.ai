import "@shopify/ui-extensions/preact";
import { render } from "preact";
import { useState } from "preact/hooks";

// Must NOT use the Shopify app application_url host (app.gemcardshow.com).
// Customer Account UI collapses absolute links on that host to the App URL root,
// which strips /api/... path + token and lands users unsigned on /.
const HANDOFF_ORIGIN = "https://sso.gemcardshow.com";
const HANDOFF_PATH = "/api/auth/shopify/customer-account-handoff";
const HANDOFF_BASE = `${HANDOFF_ORIGIN}${HANDOFF_PATH}`;
const FALLBACK_URL = "https://gemcardshow.com/apps/gghandoff/handoff?next=/";

/**
 * Build the exact GET handoff URL the button must open.
 * Format:
 * https://sso.gemcardshow.com/api/auth/shopify/customer-account-handoff?token=[REDACTED]&next=%2F
 *
 * @param {string} sessionToken
 */
function buildHandoffHref(sessionToken) {
  return (
    `${HANDOFF_BASE}` +
    `?token=${encodeURIComponent(sessionToken)}` +
    `&next=${encodeURIComponent("/")}`
  );
}

/**
 * @param {string} href
 */
function redactHandoffHref(href) {
  return String(href).replace(/([?&]token=)[^&]*/i, "$1[REDACTED]");
}

/**
 * @param {string} href
 */
function describeHref(href) {
  try {
    const url = new URL(href);
    return {
      href_redacted: redactHandoffHref(href),
      href_origin: url.origin,
      href_path: url.pathname,
      href_has_token: url.searchParams.has("token"),
      href_token_length: (url.searchParams.get("token") || "").length,
      href_next: url.searchParams.get("next"),
      href_is_app_origin_only:
        url.pathname === "/" && !url.searchParams.has("token"),
      href_is_full_handoff:
        url.origin === HANDOFF_ORIGIN &&
        url.pathname === HANDOFF_PATH &&
        url.searchParams.has("token") &&
        url.searchParams.get("next") === "/" &&
        !/app\.gemcardshow\.com$/i.test(url.host),
    };
  } catch {
    return {
      href_redacted: "[unparseable]",
      href_is_full_handoff: false,
    };
  }
}

/**
 * Safe JWT claim peek for diagnostics (never log the token).
 * @param {string} token
 */
function peekJwtMeta(token) {
  try {
    const parts = String(token).split(".");
    if (parts.length !== 3) {
      return { jwt_parts: parts.length, peek_ok: false };
    }
    const padded = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padLength = (4 - (padded.length % 4)) % 4;
    const json = JSON.parse(atob(`${padded}${"=".repeat(padLength)}`));
    return {
      peek_ok: true,
      jwt_parts: 3,
      has_sub: Boolean(json.sub),
      sub_is_customer_gid: /^gid:\/\/shopify\/Customer\/\d+/i.test(
        String(json.sub ?? ""),
      ),
      aud_present: Boolean(json.aud),
      dest: json.dest ? String(json.dest).slice(0, 80) : null,
      exp: typeof json.exp === "number" ? json.exp : null,
      jti_prefix: json.jti ? String(json.jti).slice(0, 8) : null,
    };
  } catch {
    return { peek_ok: false };
  }
}

/**
 * @param {string} step
 * @param {Record<string, unknown>} [fields]
 */
function logClient(step, fields = {}) {
  console.info(
    JSON.stringify({
      event: "gemgrade_open_client",
      step,
      ts: new Date().toISOString(),
      ...fields,
    }),
  );
}

export default async () => {
  render(<OpenGemGrade />, document.body);
};

function OpenGemGrade() {
  const [status, setStatus] = useState("ready");
  const [message, setMessage] = useState("");
  async function onOpenClick() {
    if (status === "opening") return;
    setStatus("opening");
    setMessage("");

    try {
      // Shopify requires a session token request for every backend request.
      // Fetching here also prevents a token prepared at render time from expiring.
      const sessionToken = await shopify.sessionToken.get();
      const meta = peekJwtMeta(sessionToken || "");
      logClient("session_token_at_click", {
        token_present: Boolean(sessionToken),
        token_length: sessionToken ? sessionToken.length : 0,
        ...meta,
      });
      if (!sessionToken) throw new Error("missing_session_token");

      const href = buildHandoffHref(sessionToken);
      const described = describeHref(href);
      logClient("click_open", {
        ...described,
        navigate_via: "open_external_new_tab",
      });
      if (!described.href_is_full_handoff) {
        throw new Error("handoff_href_incomplete");
      }

      open(href, "_blank");
      setStatus("ready");
    } catch (error) {
      setStatus("error");
      setMessage("Could not prepare GemGrade sign-in. Try the fallback link.");
      logClient("click_failed", {
        error_name: error instanceof Error ? error.name : "unknown",
        error_message:
          error instanceof Error ? error.message.slice(0, 80) : "unknown",
      });
      console.error("gemgrade_open_click_failed", error);
    }
  }

  return (
    <s-section heading="GemGrade">
      <s-stack direction="block" gap="base">
        <s-text>
          Continue to GemGrade signed in with your Gem Card Show account.
        </s-text>
        <s-button
          variant="primary"
          loading={status === "opening"}
          disabled={status === "opening"}
          onClick={onOpenClick}
        >
          Open GemGrade
        </s-button>
        {status === "error" ? (
          <s-banner tone="critical">
            <s-text>{message}</s-text>
            <s-link href={FALLBACK_URL} target="_blank">
              Open GemGrade fallback
            </s-link>
          </s-banner>
        ) : null}
      </s-stack>
    </s-section>
  );
}
