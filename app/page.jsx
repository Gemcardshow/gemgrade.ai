import GradeScanner from "../components/GradeScanner.jsx";

export default function HomePage() {
  return (
    <main className="page page--home">
      <header className="page__header">
        <h1>GemGrade Scanner</h1>
        <p className="page__lead">
          Professional card grading estimates — Scout to buy, Pro to know what
          you have.
        </p>
      </header>

      <GradeScanner />
    </main>
  );
}
