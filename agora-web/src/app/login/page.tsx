"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { getSavedSchoolCode, login } from "@/lib/api";

const SCHOOL_DISPLAY_NAME = process.env.NEXT_PUBLIC_SCHOOL_DISPLAY_NAME || "Agora";
const SCHOOL_MARK = process.env.NEXT_PUBLIC_SCHOOL_MARK || "A";

export default function LoginPage() {
  const router = useRouter();
  const [schoolCode] = useState(() => getSavedSchoolCode() || "agora_demo");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      await login(schoolCode, email, password);
      router.push("/dashboard");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "Login failed";
      setError(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-slate-950 px-6 py-12">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(96,165,250,0.22),_transparent_32%),radial-gradient(circle_at_80%_20%,_rgba(168,85,247,0.24),_transparent_24%),linear-gradient(135deg,_#020617_0%,_#0f1d4a_45%,_#3b0764_100%)]" />
      <div className="pointer-events-none absolute left-1/2 top-14 h-56 w-56 -translate-x-1/2 rounded-full bg-violet-500/20 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 left-0 h-72 w-72 bg-blue-500/10 blur-3xl" />

      <div className="relative w-full max-w-md rounded-[32px] border border-white/10 bg-white/[0.08] p-8 shadow-[0_30px_120px_rgba(2,6,23,0.65)] backdrop-blur-2xl sm:p-10">
        <div className="flex flex-col items-center text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-[28px] border border-white/20 bg-white/10 text-3xl font-semibold text-white shadow-[0_18px_35px_rgba(37,99,235,0.28)]">
            {SCHOOL_MARK}
          </div>
          <h1 className="mt-5 text-3xl font-semibold tracking-tight text-white sm:text-4xl">{SCHOOL_DISPLAY_NAME}</h1>
          <p className="mt-2 text-sm text-slate-300">School workspace sign in</p>
        </div>

        {error && (
          <div className="mt-8 rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-100">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-8 space-y-5">
          <div>
            <label htmlFor="email" className="mb-2 block text-sm font-medium text-slate-200">
              Email
            </label>
            <input
              id="email"
              type="email"
              className="w-full rounded-2xl border border-white/[0.12] bg-white/[0.08] px-4 py-3 text-base text-white placeholder:text-slate-300 focus:border-blue-300/60 focus:outline-none focus:ring-2 focus:ring-blue-400/20"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-2 block text-sm font-medium text-slate-200">
              Password
            </label>
            <input
              id="password"
              type="password"
              className="w-full rounded-2xl border border-white/[0.12] bg-white/[0.08] px-4 py-3 text-base text-white placeholder:text-slate-300 focus:border-violet-300/60 focus:outline-none focus:ring-2 focus:ring-violet-400/20"
              placeholder="Enter your password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex w-full items-center justify-center rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 px-4 py-3.5 text-base font-semibold text-white shadow-[0_18px_45px_rgba(59,130,246,0.28)] transition hover:from-blue-500 hover:via-indigo-500 hover:to-violet-500 disabled:cursor-not-allowed disabled:opacity-70"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                Signing in...
              </span>
            ) : (
              "Sign in"
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
