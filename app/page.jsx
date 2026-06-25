import GradeScanner from "../components/GradeScanner.jsx";

const HOW_IT_WORKS_STEPS = [
  {
    title: "Upload",
    description: "Front and back images.",
  },
  {
    title: "Estimate",
    description:
      "GemGrade analyzes corners, edges, surface, and centering.",
  },
  {
    title: "Decide",
    description:
      "Know whether it's worth submitting for professional grading.",
  },
];

export default function HomePage() {
  return (
    <main className="page page--home">
      <header className="page__header page__header--home">
        <h1>GemGrade Pre-Grade Estimator</h1>
        <p className="page__tagline">Know what to buy. Know what you have.</p>
        <p className="page__intro">
          Professional AI-powered pre-grade estimates to help you make smarter
          grading decisions before submitting your cards.
        </p>
      </header>

      <GradeScanner />

      <section className="how-it-works" aria-labelledby="how-it-works-title">
        <h2 id="how-it-works-title" className="how-it-works__title">
          How It Works
        </h2>
        <ol className="how-it-works__steps">
          {HOW_IT_WORKS_STEPS.map((step, index) => (
            <li key={step.title} className="how-it-works__step">
              <span className="how-it-works__step-number">{index + 1}</span>
              <div className="how-it-works__step-copy">
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>
    </main>
  );
}
