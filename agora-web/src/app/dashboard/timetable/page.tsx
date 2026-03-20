"use client";

import Link from "next/link";

import Header from "@/components/Header";

export default function TimetableDashboardPage() {
  const externalUrl = process.env.NEXT_PUBLIC_TIMETABLE_APP_URL?.trim();

  return (
    <>
      <Header title="Timetable" />
      <div className="space-y-6 p-6">
        <section className="overflow-hidden rounded-[32px] border border-white/10 bg-[linear-gradient(145deg,rgba(26,8,43,0.98),rgba(47,12,58,0.96)_52%,rgba(19,10,37,0.98))] shadow-[0_28px_60px_rgba(15,23,42,0.18)]">
          <div className="border-b border-white/10 px-6 py-6">
            <p className="text-[11px] uppercase tracking-[0.28em] text-white/60">Timetable managed externally</p>
            <h2 className="mt-2 text-3xl font-semibold text-white">Agora timetable workspace has been removed from the dashboard.</h2>
            <p className="mt-3 max-w-3xl text-sm text-white/80">
              Your live timetable app should be the only place where scheduling is created and edited. Agora can be connected back to that service through the API layer when you are ready.
            </p>
          </div>
          <div className="grid gap-4 px-6 py-6 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-[24px] border border-white/10 bg-white/5 p-5">
              <h3 className="text-lg font-semibold text-white">What changed</h3>
              <ul className="mt-4 space-y-3 text-sm text-white/80">
                <li>The embedded timetable planner has been removed from the Agora dashboard navigation.</li>
                <li>Principal and HM dashboards no longer push users into the in-app timetable workflow.</li>
                <li>The backend/API layer can still be connected later to your live timetable product.</li>
              </ul>
            </div>
            <div className="rounded-[24px] border border-white/10 bg-white/5 p-5">
              <h3 className="text-lg font-semibold text-white">Next integration step</h3>
              <p className="mt-3 text-sm text-white/80">
                Set your external timetable API endpoint and we can wire Agora to read from that service instead of hosting a second planner UI.
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                {externalUrl ? (
                  <Link href={externalUrl} target="_blank" className="rounded-full bg-fuchsia-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-fuchsia-400">
                    Open live timetable app
                  </Link>
                ) : null}
                <Link href="/dashboard/institution" className="rounded-full border border-white/15 bg-white/5 px-4 py-2 text-sm font-semibold text-white transition hover:bg-white/10">
                  Back to institution setup
                </Link>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}
