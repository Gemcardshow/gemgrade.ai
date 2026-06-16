"use client";

/**
 * @param {{
 *   packKey: string,
 *   label: string,
 *   credits: number,
 *   disabled?: boolean,
 *   loading?: boolean,
 *   onPurchase: (packKey: string) => void,
 * }} props
 */
export default function PurchasePackCard({
  packKey,
  label,
  credits,
  disabled = false,
  loading = false,
  onPurchase,
}) {
  return (
    <article className="purchase-pack">
      <h2>{label}</h2>
      <p className="purchase-pack__credits">{credits} credits</p>
      <button
        type="button"
        disabled={disabled || loading}
        onClick={() => onPurchase(packKey)}
      >
        {loading ? "Purchasing..." : "Purchase (placeholder)"}
      </button>
    </article>
  );
}
