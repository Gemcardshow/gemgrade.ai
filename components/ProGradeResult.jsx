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

export default function ProGradeResult({ grade }) {
  const categoryNotes = grade.categoryNotes || {};

  return (
    <section className="grade-result grade-result--pro">
      <header className="grade-result__header">
        <div>
          <p className="grade-result__eyebrow">Pro — Know what you have</p>
          <h2 className="grade-result__score">PSA {grade.psaGrade}</h2>
          <p className="grade-result__meta">
            Internal {grade.internalGrade} · {grade.likelyRange} · Detected era:{" "}
            {grade.era} ({grade.eraSource})
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

      {Object.keys(categoryNotes).length > 0 ? (
        <article className="grade-card">
          <h3>Category Notes</h3>
          <ul>
            {Object.entries(categoryNotes).map(([key, value]) =>
              value ? (
                <li key={key}>
                  <span>{CATEGORY_LABELS[key] || key}</span>
                  <span>{value}</span>
                </li>
              ) : null,
            )}
          </ul>
        </article>
      ) : null}

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

      {typeof grade.credits?.deducted === "number" ? (
        <p className="grade-result__meta">Credits used: {grade.credits.deducted}</p>
      ) : null}
    </section>
  );
}
