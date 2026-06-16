import Link from "next/link";
import ScanHistoryDetail from "../../../components/ScanHistoryDetail.jsx";

/** @param {{ params: { id: string } }} props */
export default function ScanHistoryDetailPage({ params }) {
  return (
    <main className="page">
      <header className="page__header">
        <h1>Scan Detail</h1>
        <p>Saved grade snapshot from your account.</p>
      </header>

      <ScanHistoryDetail scanId={params.id} />

      <p>
        <Link href="/history">All scans</Link> · <Link href="/">Grade another card</Link>
      </p>
    </main>
  );
}
