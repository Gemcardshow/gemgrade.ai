import { Cormorant_Garamond, Inter } from "next/font/google";
import "./globals.css";
import AuthStatus from "../components/AuthStatus.jsx";
import { GEMGRADE_DISCLAIMER } from "../lib/gradePresentation.js";

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
  description: "Independent sports card grading estimates",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className={body.className}>
        <AuthStatus />
        {children}
        <footer className="site-footer">
          <p>{GEMGRADE_DISCLAIMER}</p>
        </footer>
      </body>
    </html>
  );
}
