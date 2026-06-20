import Link from "next/link";
import AdminCreditsTool from "../../../components/AdminCreditsTool.jsx";

export default function AdminCreditsPage() {
  return (
    <main className="page">
      <header className="page__header">
        <h1>Admin Credits</h1>
        <p>Search beta testers and adjust credit balances.</p>
      </header>

      <AdminCreditsTool />

      <p className="page__footer">
        <Link href="/">Back to grading</Link>
      </p>
    </main>
  );
}
