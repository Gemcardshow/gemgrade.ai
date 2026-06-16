import Link from "next/link";
import CreditsPurchase from "../../components/CreditsPurchase.jsx";

export default function CreditsPage() {
  return (
    <main className="page">
      <header className="page__header">
        <h1>Credits</h1>
        <p>Purchase placeholder credits for GemGrade scans.</p>
      </header>

      <CreditsPurchase />

      <p className="page__footer">
        <Link href="/">Back to grading</Link>
      </p>
    </main>
  );
}
