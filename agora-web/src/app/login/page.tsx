"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { getSavedSchoolCode, hasPresetSchoolCode, login } from "@/lib/api";

const previewStats = [
  { label: "Attendance", value: "96%", tone: "emerald" },
  { label: "Fee Recovery", value: "82%", tone: "violet" },
  { label: "Homework", value: "128", tone: "sky" },
  { label: "Alerts", value: "04", tone: "rose" },
] as const;

const previewModules = [
  "Attendance command",
  "Result cards",
  "Admissions pipeline",
  "Parent communication",
  "HR & payroll",
  "Document vault",
] as const;

const chartBars = [
  { label: "Mon", height: "48%" },
  { label: "Tue", height: "68%" },
  { label: "Wed", height: "54%" },
  { label: "Thu", height: "82%" },
  { label: "Fri", height: "72%" },
] as const;

export default function LoginPage() {
  const router = useRouter();
  const schoolCodeIsPreset = hasPresetSchoolCode();
  const [schoolCode, setSchoolCode] = useState(() => getSavedSchoolCode());
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
    <div className="relative min-h-screen overflow-hidden bg-slate-950">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(129,140,248,0.22),_transparent_34%),radial-gradient(circle_at_80%_20%,_rgba(147,51,234,0.24),_transparent_28%),linear-gradient(135deg,_#071126_0%,_#121f49_45%,_#35105b_100%)]" />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[linear-gradient(180deg,_rgba(255,255,255,0.12),_transparent)]" />
      <div className="pointer-events-none absolute left-10 top-20 h-56 w-56 rounded-full bg-violet-500/20 blur-3xl" />
      <div className="pointer-events-none absolute bottom-0 right-0 h-72 w-72 rounded-full bg-blue-500/20 blur-3xl" />

      <div className="relative mx-auto flex min-h-screen max-w-7xl flex-col justify-center gap-10 px-6 py-10 lg:grid lg:grid-cols-[1.1fr_0.9fr] lg:gap-14 lg:px-10">
        <section className="text-white">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/8 px-4 py-2 text-xs font-semibold uppercase tracking-[0.28em] text-slate-200 backdrop-blur">
            <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_14px_rgba(74,222,128,0.9)]" />
            Agora School OS
          </div>

          <div className="mt-8 max-w-2xl">
            <h1 className="text-4xl font-semibold leading-tight text-white sm:text-5xl lg:text-6xl">
              Minimal surface,
              <span className="bg-gradient-to-r from-blue-200 via-violet-200 to-fuchsia-200 bg-clip-text text-transparent">
                {" "}complete school control.
              </span>
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-300 sm:text-lg">
              Attendance, academics, finance, admissions, and parent visibility in one calm command center built for
              daily school operations.
            </p>
          </div>

          <div className="mt-8 flex flex-wrap gap-3">
            {previewModules.map((module) => (
              <span
                key={module}
                className="rounded-full border border-white/12 bg-white/8 px-4 py-2 text-sm text-slate-100 shadow-[0_10px_25px_rgba(15,23,42,0.18)] backdrop-blur-sm"
              >
                {module}
              </span>
            ))}
          </div>

          <div className="mt-10 rounded-[30px] border border-white/10 bg-white/6 p-5 shadow-[0_24px_80px_rgba(2,6,23,0.45)] backdrop-blur-xl">
            <div className="flex items-start justify-between gap-6">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-slate-300">Live preview</p>
                <h2 className="mt-2 text-2xl font-semibold text-white">Inside your software</h2>
                <p className="mt-2 max-w-md text-sm leading-6 text-slate-300">
                  A quick look at the command layer your team sees after sign in: real-time graphs, school-wide metrics,
                  alerts, and role-based workflows.
                </p>
              </div>
              <div className="hidden rounded-2xl border border-white/10 bg-slate-950/40 px-4 py-3 text-right text-sm text-slate-300 md:block">
                <p className="text-xs uppercase tracking-[0.22em] text-slate-400">Sync</p>
                <p className="mt-1 font-medium text-emerald-300">Every 15 min</p>
              </div>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              {previewStats.map((item, index) => (
                <div
                  key={item.label}
                  className={`login-stat-card login-stat-card--${item.tone}`}
                  style={{ animationDelay: `${index * 120}ms` }}
                >
                  <p className="text-xs font-semibold uppercase tracking-[0.24em] text-white/75">{item.label}</p>
                  <div className="mt-3 flex items-end justify-between">
                    <p className="text-3xl font-semibold text-white">{item.value}</p>
                    <span className="rounded-full bg-white/12 px-2.5 py-1 text-xs text-white/80">Live</span>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-6 grid gap-5 lg:grid-cols-[1.4fr_0.9fr]">
              <div className="rounded-[26px] border border-white/10 bg-slate-950/40 p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">Academic heartbeat</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.22em] text-slate-400">Weekly completion</p>
                  </div>
                  <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-xs font-medium text-emerald-200">
                    Stable growth
                  </span>
                </div>

                <div className="mt-5 rounded-[22px] border border-white/8 bg-gradient-to-br from-white/8 to-white/3 p-5">
                  <div className="flex items-end gap-4">
                    {chartBars.map((bar, index) => (
                      <div key={bar.label} className="flex flex-1 flex-col items-center gap-3">
                        <div className="flex h-40 w-full items-end rounded-2xl bg-white/6 px-2 py-2">
                          <div
                            className="login-chart-bar w-full rounded-xl bg-gradient-to-t from-blue-500 via-violet-500 to-fuchsia-400"
                            style={{
                              height: bar.height,
                              animationDelay: `${index * 140}ms`,
                            }}
                          />
                        </div>
                        <span className="text-xs uppercase tracking-[0.22em] text-slate-400">{bar.label}</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 flex items-center gap-3 text-xs text-slate-300">
                    <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
                    Report cards, homework, and attendance trends move together here.
                  </div>
                </div>
              </div>

              <div className="rounded-[26px] border border-white/10 bg-slate-950/40 p-5">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-white">Operational pulse</p>
                    <p className="mt-1 text-xs uppercase tracking-[0.22em] text-slate-400">What teams handle daily</p>
                  </div>
                  <span className="rounded-full bg-white/10 px-3 py-1 text-xs text-slate-200">Roles aware</span>
                </div>
                <div className="mt-5 space-y-3">
                  {[
                    ["Front desk", "Admissions under review", "12"],
                    ["Class teacher", "Comments pending", "08"],
                    ["Principal", "Critical alerts", "03"],
                    ["Finance", "Fee recovery today", "PKR 4.8M"],
                  ].map(([role, label, value], index) => (
                    <div
                      key={role}
                      className="login-activity-row"
                      style={{ animationDelay: `${index * 120}ms` }}
                    >
                      <div>
                        <p className="text-sm font-medium text-white">{role}</p>
                        <p className="mt-1 text-xs text-slate-400">{label}</p>
                      </div>
                      <span className="text-sm font-semibold text-violet-100">{value}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center">
          <div className="w-full max-w-md rounded-[30px] border border-white/12 bg-white/95 p-6 shadow-[0_25px_90px_rgba(15,23,42,0.45)] backdrop-blur-xl sm:p-8">
            <div className="mb-8 flex items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary-600">Secure sign in</p>
                <h2 className="mt-3 text-3xl font-semibold text-slate-950">Welcome back</h2>
                <p className="mt-2 text-sm leading-6 text-slate-500">Sign in to continue into your school workspace.</p>
              </div>
              <div className="rounded-2xl bg-slate-950 px-4 py-3 text-white shadow-lg shadow-slate-900/25">
                <p className="text-xs uppercase tracking-[0.24em] text-slate-300">Agora</p>
                <p className="mt-1 text-sm font-semibold">Control center</p>
              </div>
            </div>

            {error && (
              <div className="mb-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              {schoolCodeIsPreset ? (
                <div className="rounded-2xl border border-primary-100 bg-gradient-to-r from-primary-50 to-violet-50 px-4 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary-700">School profile</p>
                      <p className="mt-2 text-lg font-semibold text-slate-900">{schoolCode}</p>
                      <p className="mt-1 text-xs leading-5 text-slate-600">
                        This device is already linked to your school. Staff only need email and password.
                      </p>
                    </div>
                    <span className="rounded-full bg-slate-950 px-3 py-1 text-xs font-medium text-white">Locked in</span>
                  </div>
                </div>
              ) : (
                <div>
                  <label htmlFor="schoolCode" className="label-text">School Code</label>
                  <input
                    id="schoolCode"
                    type="text"
                    className="input-field"
                    placeholder="e.g. agora_demo"
                    value={schoolCode}
                    onChange={(e) => setSchoolCode(e.target.value)}
                    autoCapitalize="none"
                    autoCorrect="off"
                    required
                  />
                  <p className="mt-2 text-xs text-slate-500">
                    This school code is remembered on this device after a successful sign in.
                  </p>
                </div>
              )}

              <div>
                <label htmlFor="email" className="label-text">Email</label>
                <input
                  id="email"
                  type="email"
                  className="input-field"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div>
                <label htmlFor="password" className="label-text">Password</label>
                <input
                  id="password"
                  type="password"
                  className="input-field"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              <button type="submit" disabled={loading} className="btn-primary w-full rounded-2xl py-3 text-base">
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

            <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Demo access</p>
                  <p className="mt-1 text-sm text-slate-600">Use these until your school accounts are seeded.</p>
                </div>
                <span className="rounded-full bg-white px-3 py-1 text-xs font-medium text-slate-600 shadow-sm">Preview</span>
              </div>
              <div className="mt-4 space-y-2 text-sm text-slate-700">
                <p><span className="font-semibold">Admin:</span> admin@agora.com / admin123</p>
                <p><span className="font-semibold">Teacher:</span> teacher1@agora.com / teach123</p>
                <p><span className="font-semibold">Front Desk:</span> frontdesk1@agora.com / front123</p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
