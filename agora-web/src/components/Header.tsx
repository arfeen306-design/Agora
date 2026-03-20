"use client";

import Link from "next/link";
import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/lib/auth";
import { getRoleTheme } from "@/lib/role-theme";

export default function Header({ title }: { title: string }) {
  const { user, logout } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const roleTheme = getRoleTheme(user?.roles || []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-[rgba(11,4,20,0.82)] px-6 py-4 backdrop-blur-xl">
      <div className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r ${roleTheme.accentClass}`} />
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">{title}</h1>
          <div className="mt-2 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70 shadow-sm">
            <span className={`h-2 w-2 rounded-full ${roleTheme.pillClass}`} />
            <span className="font-semibold text-white">{roleTheme.label}</span>
            <span className="text-white/[0.45]">workspace</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <Link
            href="/dashboard/notifications"
            className="relative rounded-2xl border border-white/10 bg-white/5 p-2.5 text-white/60 shadow-sm transition-colors hover:bg-white/10 hover:text-white"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
            </svg>
          </Link>

          <div className="relative" ref={menuRef}>
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 p-1.5 shadow-sm transition-colors hover:bg-white/10"
            >
              <div className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold ${roleTheme.avatarClass}`}>
                {user?.first_name?.[0] || "?"}
              </div>
              <svg className="h-4 w-4 text-white/[0.55]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {menuOpen && (
              <div className="absolute right-0 mt-2 w-56 rounded-2xl border border-white/10 bg-[rgba(16,8,30,0.96)] py-1 shadow-[0_24px_80px_rgba(8,3,18,0.45)] backdrop-blur-xl">
                <div className="border-b border-white/[0.08] px-4 py-3">
                  <p className="text-sm font-medium text-white">{user?.first_name} {user?.last_name}</p>
                  <p className="text-xs text-white/[0.55]">{user?.email}</p>
                </div>
                <button
                  onClick={logout}
                  className="group mx-2 my-2 flex w-[calc(100%-1rem)] items-center justify-between rounded-2xl border border-rose-100 bg-gradient-to-r from-rose-50 to-red-50 px-4 py-3 text-left transition-all hover:border-rose-200 hover:shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white text-rose-600 shadow-sm">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-rose-700">Sign out</p>
                      <p className="text-xs text-rose-500">Securely close this session</p>
                    </div>
                  </div>
                  <span className="flex h-7 w-14 items-center rounded-full bg-rose-200/80 p-1 shadow-inner">
                    <span className="flex h-5 w-5 items-center justify-center rounded-full bg-rose-600 text-white shadow transition-transform duration-200 group-hover:translate-x-6">
                      <span className="h-1.5 w-1.5 rounded-full bg-white" />
                    </span>
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
