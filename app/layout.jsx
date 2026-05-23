import "./globals.css";

export const metadata = {
  title: "GemGrade AI",
  description: "PSA-style sports card grading",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
