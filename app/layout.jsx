import { Cormorant_Garamond, Inter } from "next/font/google";
import "./globals.css";
import AuthStatus from "../components/AuthStatus.jsx";

const display = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
});

const body = Inter({
  subsets: ["latin"],
  variable: "--font-body",
});

export const metadata = {
  title: "GemGrade AI",
  description: "PSA-style sports card grading",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className={body.className}>
        <AuthStatus />
        {children}
      </body>
    </html>
  );
}
