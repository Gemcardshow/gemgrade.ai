import Link from "next/link";
import LoginForm from "../../components/LoginForm.jsx";
import { hasUsableSupabasePublicConfig } from "../../lib/supabase/env.js";

/** @param {{ searchParams?: { error?: string } }} props */
export default function LoginPage({ searchParams }) {
  const configured = hasUsableSupabasePublicConfig();

  return (
    <main className="page">
      <header className="page__header">
        <h1>Sign in</h1>
        <p>Use your email to receive a magic link.</p>
      </header>

      {!configured ? (
        <p className="login-form__error">
          Supabase auth is not configured correctly. Set{" "}
          <code>NEXT_PUBLIC_SUPABASE_URL</code> to your project URL (for example{" "}
          <code>https://abcdefgh.supabase.co</code>) and{" "}
          <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> to your anon JWT (
          <code>eyJ...</code>) or publishable key (<code>sb_publishable_...</code>
          ). Redeploy after updating Vercel env vars.
        </p>
      ) : (
        <LoginForm callbackError={searchParams?.error} />
      )}

      <p className="page__footer">
        <Link href="/">Back to grading</Link>
      </p>
    </main>
  );
}
