import {
  getCreditsUsed,
  getScoutBuySignal,
  getScoutConfidence,
  getScoutPsaEstimate,
} from "../lib/scoutPresentation.js";

/**
 * @param {{ credits?: { deducted?: number } } | null | undefined} grade
 */
export default function ScoutResult({ grade }) {
  if (!grade) {
    return null;
  }

  const buySignal = getScoutBuySignal(grade);
  const creditsUsed = getCreditsUsed(grade, "scout");

  return (
    <section className="grade-result grade-result--scout">
      <header className="grade-result__header">
        <p className="grade-result__eyebrow">Scout — Know what to buy</p>
        <h2 className="grade-result__score">{getScoutPsaEstimate(grade)}</h2>
      </header>

      <div className="scout-result__grid">
        <article className="grade-card">
          <h3>Confidence</h3>
          <p>{getScoutConfidence(grade)}</p>
        </article>

        <article className={`grade-card scout-result__signal scout-result__signal--${buySignal.tone}`}>
          <h3>Buy Signal</h3>
          <p className="scout-result__signal-label">{buySignal.label}</p>
          <p className="scout-result__signal-summary">{buySignal.summary}</p>
        </article>

        <article className="grade-card">
          <h3>Credits Used</h3>
          <p>{creditsUsed}</p>
        </article>
      </div>
    </section>
  );
}
