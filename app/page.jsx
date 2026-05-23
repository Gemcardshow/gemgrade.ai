import GradeScanner from "../components/GradeScanner.jsx";

export default function HomePage() {
  return (
    <main className="page">
      <header className="page__header">
        <h1>GemGrade AI</h1>
        <p>Structured PSA-style grading powered by the rebuilt grading engine.</p>
      </header>

      <GradeScanner mode="free" />
    </main>
  );
}
