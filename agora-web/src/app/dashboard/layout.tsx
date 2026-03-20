"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { AuthProvider, useAuth } from "@/lib/auth";
import Sidebar from "@/components/Sidebar";

function DashboardGuard({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace("/login");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary-600 border-t-transparent" />
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="flex min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(236,72,153,0.14),_transparent_18%),radial-gradient(circle_at_top_right,_rgba(124,58,237,0.18),_transparent_22%),linear-gradient(180deg,#090312_0%,#12051d_52%,#190825_100%)]">
      <Sidebar />
      <main className="ml-[92px] min-h-screen flex-1 transition-[margin] duration-300 bg-[radial-gradient(circle_at_top_left,_rgba(236,72,153,0.10),_transparent_18%),radial-gradient(circle_at_top_right,_rgba(124,58,237,0.12),_transparent_20%),linear-gradient(180deg,_rgba(17,8,29,0.92)_0%,_rgba(20,10,34,0.88)_12%,_rgba(246,243,252,0.98)_35%,_rgba(248,245,250,1)_100%)]">{children}</main>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <DashboardGuard>{children}</DashboardGuard>
    </AuthProvider>
  );
}
