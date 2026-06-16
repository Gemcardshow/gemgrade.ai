import GradeScanner from "../components/GradeScanner.jsx";

export default function HomePage() {
  return (
    <main className="page page--home">
      <header className="page__header">
        <h1>GemGrade AI</h1>
        <p className="page__lead">
          Professional PSA-style grading — Scout to buy, Pro to know what you have.
        </p>
      </header>

      <GradeScanner />
    </main>
  );
}
