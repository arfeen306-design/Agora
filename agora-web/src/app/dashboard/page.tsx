"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Header from "@/components/Header";
import { useAuth } from "@/lib/auth";
import { getAttendance, getHomework, getEvents, getNotifications } from "@/lib/api";

interface Stats {
  todayAttendance: number;
  activeHomework: number;
  upcomingEvents: number;
  unreadNotifications: number;
}

export default function DashboardPage() {
  const { user, isAdmin } = useAuth();
  const router = useRouter();
  const [stats, setStats] = useState<Stats>({
    todayAttendance: 0,
    activeHomework: 0,
    upcomingEvents: 0,
    unreadNotifications: 0,
  });
  const [loading, setLoading] = useState(true);
  const isLeadership = user?.roles?.includes("principal") || user?.roles?.includes("vice_principal");
  const isSectionLeadership = user?.roles?.includes("headmistress");
  const isFrontDesk = user?.roles?.includes("front_desk");
  const isHrAdmin = user?.roles?.includes("hr_admin");

  useEffect(() => {
    if (isLeadership) {
      router.replace("/dashboard/principal");
      return;
    }
    if (isSectionLeadership) {
      router.replace("/dashboard/section");
      return;
    }
    if (isFrontDesk) {
      router.replace("/dashboard/admissions");
      return;
    }
    if (isHrAdmin) {
      router.replace("/dashboard/hr");
    }
  }, [isFrontDesk, isHrAdmin, isLeadership, isSectionLeadership, router]);

  useEffect(() => {
    if (isLeadership || isSectionLeadership || isFrontDesk || isHrAdmin) {
      setLoading(false);
      return;
    }

    async function loadStats() {
      try {
        const today = new Date().toISOString().split("T")[0];
        const [attendance, homework, events, notifications] = await Promise.allSettled([
          getAttendance({ date_from: today, date_to: today, page_size: "1" }),
          getHomework({ page_size: "1" }),
          getEvents({ date_from: today, page_size: "1" }),
          getNotifications({ page_size: "1" }),
        ]);

        setStats({
          todayAttendance:
            attendance.status === "fulfilled"
              ? (attendance.value.meta?.pagination?.total_items ?? 0)
              : 0,
          activeHomework:
            homework.status === "fulfilled"
              ? (homework.value.meta?.pagination?.total_items ?? 0)
              : 0,
          upcomingEvents:
            events.status === "fulfilled"
              ? (events.value.meta?.pagination?.total_items ?? 0)
              : 0,
          unreadNotifications:
            notifications.status === "fulfilled"
              ? (notifications.value.meta?.pagination?.total_items ?? 0)
              : 0,
        });
      } catch {
        // ignore - stats just show 0
      } finally {
        setLoading(false);
      }
    }
    loadStats();
  }, [isFrontDesk, isHrAdmin, isLeadership, isSectionLeadership]);

  if (isLeadership || isSectionLeadership || isFrontDesk || isHrAdmin) {
    return (
      <>
        <Header title="Dashboard" />
        <div className="p-6">
          <div className="card flex items-center gap-3">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary-600 border-t-transparent" />
            <p className="text-sm text-gray-600">
              {isLeadership
                ? "Opening Principal Dashboard..."
                : isSectionLeadership
                  ? "Opening Section Dashboard..."
                  : isFrontDesk
                    ? "Opening Admissions Dashboard..."
                    : "Opening HR Dashboard..."}
            </p>
          </div>
        </div>
      </>
    );
  }

  const statCards = [
    {
      label: "Today's Attendance",
      value: stats.todayAttendance,
      color: "bg-green-500",
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
      ),
    },
    {
      label: "Active Homework",
      value: stats.activeHomework,
      color: "bg-blue-500",
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
        </svg>
      ),
    },
    {
      label: "Upcoming Events",
      value: stats.upcomingEvents,
      color: "bg-purple-500",
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      ),
    },
    {
      label: "Notifications",
      value: stats.unreadNotifications,
      color: "bg-orange-500",
      icon: (
        <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
      ),
    },
  ];

  return (
    <>
      <Header title="Dashboard" />
      <div className="p-6">
        {/* Welcome */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900">
            Welcome back, {user?.first_name}!
          </h2>
          <p className="text-gray-500 mt-1">
            {isAdmin ? "Here's an overview of your school." : "Here's your classroom overview."}
          </p>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
          {statCards.map((card) => (
            <div key={card.label} className="card flex items-center gap-4">
              <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${card.color} text-white shrink-0`}>
                {card.icon}
              </div>
              <div>
                {loading ? (
                  <div className="h-7 w-12 animate-pulse rounded bg-gray-200" />
                ) : (
                  <p className="text-2xl font-bold text-gray-900">{card.value}</p>
                )}
                <p className="text-sm text-gray-500">{card.label}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Quick Actions */}
        <div className="card">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Quick Actions</h3>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Link href="/dashboard/attendance" className="flex flex-col items-center gap-2 rounded-lg border border-gray-200 p-4 hover:bg-gray-50 transition-colors">
              <svg className="w-8 h-8 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
              <span className="text-sm font-medium text-gray-700">Mark Attendance</span>
            </Link>
            <Link href="/dashboard/homework" className="flex flex-col items-center gap-2 rounded-lg border border-gray-200 p-4 hover:bg-gray-50 transition-colors">
              <svg className="w-8 h-8 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              <span className="text-sm font-medium text-gray-700">Add Homework</span>
            </Link>
            <Link href="/dashboard/marks" className="flex flex-col items-center gap-2 rounded-lg border border-gray-200 p-4 hover:bg-gray-50 transition-colors">
              <svg className="w-8 h-8 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <span className="text-sm font-medium text-gray-700">Enter Marks</span>
            </Link>
            <Link href="/dashboard/messaging" className="flex flex-col items-center gap-2 rounded-lg border border-gray-200 p-4 hover:bg-gray-50 transition-colors">
              <svg className="w-8 h-8 text-orange-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              <span className="text-sm font-medium text-gray-700">Messages</span>
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}
