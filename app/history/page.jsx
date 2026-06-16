import Link from "next/link";
import ScanHistoryList from "../../components/ScanHistoryList.jsx";

export default function HistoryPage() {
  return (
    <main className="page">
      <header className="page__header">
        <h1>Scan History</h1>
        <p>Your recent GemGrade Scout and Pro scans.</p>
      </header>

      <ScanHistoryList />

      <p className="page__footer">
        <Link href="/">Back to grading</Link>
      </p>
    </main>
  );
}
