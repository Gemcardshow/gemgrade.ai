import Link from "next/link";
import AdminDashboard from "../../components/AdminDashboard.jsx";

export default function AdminPage() {
  return (
    <main className="page">
      <header className="page__header">
        <h1>Admin Dashboard</h1>
        <p>Platform activity overview for beta operations.</p>
      </header>

      <AdminDashboard />

      <p className="page__footer">
        <Link href="/">Back to grading</Link>
      </p>
    </main>
  );
}
