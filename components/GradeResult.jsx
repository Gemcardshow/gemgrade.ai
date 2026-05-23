const CATEGORY_LABELS = {
  corners: "Corners",
  edges: "Edges",
  surface: "Surface",
  centering: "Centering",
};

function formatCapAuditEntry(entry) {
  if (typeof entry.value === "number") {
    return `${entry.source}: ${entry.value}`;
  }
  if (typeof entry.cap === "number") {
    return `${entry.source}: cap ${entry.cap}`;
  }
  return entry.source;
}

export default function GradeResult({ grade }) {
  if (!grade) {
    return null;
  }

  return (
    <section className="grade-result">
      <header className="grade-result__header">
        <div>
          <p className="grade-result__eyebrow">Projected PSA Grade</p>
          <h2 className="grade-result__score">PSA {grade.psaGrade}</h2>
          <p className="grade-result__meta">
            Internal {grade.internalGrade} · {grade.likelyRange} · {grade.era} ({grade.eraSource})
          </p>
        </div>
      </header>

      <div className="grade-result__grid">
        <article className="grade-card">
          <h3>Category Scores</h3>
          <ul>
            {Object.entries(grade.categoryScores).map(([key, value]) => (
              <li key={key}>
                <span>{CATEGORY_LABELS[key] || key}</span>
                <strong>{value}</strong>
              </li>
            ))}
          </ul>
        </article>

        <article className="grade-card">
          <h3>Primary Limiter</h3>
          <p>{grade.primaryLimiter.label}</p>
          <p className="grade-result__tag">{grade.primaryLimiter.tag}</p>
        </article>

        <article className="grade-card">
          <h3>Scan Quality</h3>
          <p>
            {grade.scanQuality.level} · {grade.scanQuality.confidence} confidence
          </p>
          <p>Ceiling applied: {grade.scanQuality.ceilingApplied}</p>
        </article>
      </div>

      <article className="grade-card">
        <h3>Cap Audit</h3>
        <ul>
          {grade.capAudit.map((entry) => (
            <li key={`${entry.source}-${entry.cap ?? entry.value ?? "na"}`}>
              {formatCapAuditEntry(entry)}
            </li>
          ))}
        </ul>
      </article>

      {grade.verdict ? (
        <article className="grade-card grade-card--verdict">
          <h3>Verdict</h3>
          <pre className="grade-result__verdict">{grade.verdict}</pre>
        </article>
      ) : null}

      {grade.proUpsellText ? (
        <p className="grade-result__upsell">{grade.proUpsellText}</p>
      ) : null}
    </section>
  );
}
