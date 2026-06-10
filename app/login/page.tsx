"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Mode = "signin" | "signup" | "magic";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirect = params.get("redirect") ?? "/";

  const [mode, setMode] = useState<Mode>("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const supabase = createClient();

  async function submit() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setMsg("Account created. If email confirmation is on, check your inbox, then sign in.");
        setMode("signin");
      } else if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (error) throw error;
        router.replace(redirect);
        router.refresh();
      } else {
        const { error } = await supabase.auth.signInWithOtp({
          email,
          options: {
            emailRedirectTo: `${window.location.origin}/auth/callback?redirect=${encodeURIComponent(redirect)}`,
          },
        });
        if (error) throw error;
        setMsg("Magic link sent. Check your email to finish signing in.");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/activant-logo-blue.png"
            alt="Activant"
            width={888}
            height={150}
            className="mb-5 h-6 w-auto"
          />
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            DEFROST
          </h1>
          <p className="mt-1 text-sm text-ink-faint">
            Delivering Emails to Founders Really Often, Somewhat Targetedly.
          </p>
        </div>

        <div className="rounded-lg border border-line bg-panel p-5 shadow-sm">
          <div className="mb-4 flex gap-1 rounded border border-line p-0.5 text-sm">
            {(["signin", "signup", "magic"] as Mode[]).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m);
                  setErr(null);
                  setMsg(null);
                }}
                className={`flex-1 rounded px-2 py-1 capitalize transition-colors ${
                  mode === m
                    ? "bg-accent text-white"
                    : "text-ink-soft hover:bg-accent-soft"
                }`}
              >
                {m === "magic" ? "Magic link" : m === "signin" ? "Sign in" : "Sign up"}
              </button>
            ))}
          </div>

          <label className="field-label mb-1 block">Email</label>
          <input
            type="email"
            className="inp mb-3"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            autoComplete="email"
          />

          {mode !== "magic" && (
            <>
              <label className="field-label mb-1 block">Password</label>
              <input
                type="password"
                className="inp mb-3"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                onKeyDown={(e) => e.key === "Enter" && submit()}
              />
            </>
          )}

          <button
            className="btn btn-primary mt-1 w-full"
            disabled={busy || !email || (mode !== "magic" && !password)}
            onClick={submit}
          >
            {busy
              ? "Working…"
              : mode === "signup"
                ? "Create account"
                : mode === "magic"
                  ? "Send magic link"
                  : "Sign in"}
          </button>

          {err && <p className="mt-3 text-sm text-flag">{err}</p>}
          {msg && <p className="mt-3 text-sm text-accent-ink">{msg}</p>}
        </div>

        <p className="mt-4 text-center text-xs text-ink-faint">
          The signed-in user is the <strong>owner</strong>. Writers (senders)
          are managed inside the app.
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<main className="min-h-screen" />}>
      <LoginForm />
    </Suspense>
  );
}
