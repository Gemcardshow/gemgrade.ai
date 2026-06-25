import { Cormorant_Garamond, Inter } from "next/font/google";
import "./globals.css";
import AuthStatus from "../components/AuthStatus.jsx";
import {
  GEMGRADE_DISCLAIMER,
  GEMGRADE_FOOTER_TAGLINE,
  SITE_TITLE,
} from "../lib/gradePresentation.js";

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
  title: {
    default: SITE_TITLE,
    template: `%s · ${SITE_TITLE}`,
  },
  description:
    "Professional AI pre-grade estimates from Gem Card Show — Scout to buy, Pro to know what you have.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className={body.className}>
        <AuthStatus />
        {children}
        <footer className="site-footer">
          <p>{GEMGRADE_DISCLAIMER}</p>
          <p className="site-footer__tagline">{GEMGRADE_FOOTER_TAGLINE}</p>
        </footer>
      </body>
    </html>
  );
}
