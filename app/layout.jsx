import "./globals.css";
import AuthStatus from "../components/AuthStatus.jsx";

export const metadata = {
  title: "GemGrade AI",
  description: "PSA-style sports card grading",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AuthStatus />
        {children}
      </body>
    </html>
  );
}
