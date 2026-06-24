/**
 * @param {{
 *   label: string,
 *   credits: number,
 *   checkoutUrl: string,
 * }} props
 */
export default function PurchasePackCard({ label, credits, checkoutUrl }) {
  return (
    <article className="purchase-pack">
      <h2>{label}</h2>
      <p className="purchase-pack__credits">{credits} credits</p>
      <a
        href={checkoutUrl}
        className="btn btn--primary"
        target="_blank"
        rel="noopener noreferrer"
      >
        Buy on Gem Card Show
      </a>
    </article>
  );
}
