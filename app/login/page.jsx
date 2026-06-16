import Link from "next/link";
import LoginForm from "../../components/LoginForm.jsx";
import { hasSupabasePublicConfig } from "../../lib/supabase/env.js";

/** @param {{ searchParams?: { error?: string } }} props */
export default function LoginPage({ searchParams }) {
  const configured = hasSupabasePublicConfig();

  return (
    <main className="page">
      <header className="page__header">
        <h1>Sign in</h1>
        <p>Use your email to receive a magic link.</p>
      </header>

      {!configured ? (
        <p className="login-form__error">
          Supabase auth is not configured. Set{" "}
          <code>NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code>.
        </p>
      ) : (
        <LoginForm callbackError={searchParams?.error} />
      )}

      <p>
        <Link href="/">Back to grading</Link>
      </p>
    </main>
  );
}
