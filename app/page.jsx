import GradeScanner from "../components/GradeScanner.jsx";

export default function HomePage() {
  return (
    <main className="page">
      <header className="page__header">
        <h1>GemGrade AI</h1>
        <p>Professional PSA-style grading — same engine and breakdown for every scan.</p>
      </header>

      <GradeScanner />
    </main>
  );
}
