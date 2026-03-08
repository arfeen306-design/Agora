"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useAuth } from "@/lib/auth";

const navItems = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
    roles: ["school_admin", "principal", "vice_principal", "headmistress", "teacher", "accountant", "front_desk", "hr_admin"],
  },
  {
    label: "Principal Dashboard",
    href: "/dashboard/principal",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.185 3.647a1 1 0 00.95.69h3.835c.969 0 1.371 1.24.588 1.81l-3.103 2.254a1 1 0 00-.364 1.118l1.185 3.647c.3.921-.755 1.688-1.539 1.118l-3.103-2.254a1 1 0 00-1.176 0l-3.103 2.254c-.783.57-1.838-.197-1.539-1.118l1.185-3.647a1 1 0 00-.364-1.118L2.64 9.074c-.783-.57-.38-1.81.588-1.81h3.835a1 1 0 00.95-.69l1.185-3.647z" />
      </svg>
    ),
    roles: ["school_admin", "principal", "vice_principal"],
  },
  {
    label: "Section Dashboard",
    href: "/dashboard/section",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6M9 12h6M9 17h4" />
      </svg>
    ),
    roles: ["headmistress"],
  },
  {
    label: "Admissions",
    href: "/dashboard/admissions",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6l4 2m5-2a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    roles: ["school_admin", "principal", "vice_principal", "front_desk"],
  },
  {
    label: "Admission Pipeline",
    href: "/dashboard/admissions/pipeline",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 7h10M7 12h10M7 17h6" />
      </svg>
    ),
    roles: ["school_admin", "principal", "vice_principal", "front_desk"],
  },
  {
    label: "New Applicant",
    href: "/dashboard/admissions/applicants/new",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
      </svg>
    ),
    roles: ["school_admin", "front_desk"],
  },
  {
    label: "Institution",
    href: "/dashboard/institution",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 21h18M5 21V7l7-4 7 4v14M9 10h6M9 14h6" />
      </svg>
    ),
    roles: ["school_admin", "principal", "vice_principal", "headmistress", "hr_admin"],
  },
  {
    label: "People",
    href: "/dashboard/people",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-1a4 4 0 00-5-3.87M9 20H4v-1a4 4 0 015-3.87m8-6a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>
    ),
    roles: ["school_admin", "principal", "vice_principal", "headmistress", "hr_admin"],
  },
  {
    label: "HR & Payroll",
    href: "/dashboard/hr",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 4h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9h8M8 13h5M15 13h1" />
      </svg>
    ),
    roles: ["school_admin", "principal", "vice_principal", "hr_admin", "accountant"],
  },
  {
    label: "Payroll Runs",
    href: "/dashboard/hr/payroll",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16v12H4z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 10h16M8 14h3M8 17h5M16 14h2M15 17h3" />
      </svg>
    ),
    roles: ["school_admin", "principal", "vice_principal", "hr_admin", "accountant"],
  },
  {
    label: "My HR & Finance",
    href: "/dashboard/hr/self-service",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 20h14a1 1 0 001-1V7l-5-4H5a1 1 0 00-1 1v15a1 1 0 001 1z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 3v4h4M8 12h8M8 16h6" />
      </svg>
    ),
    roles: ["teacher"],
  },
  {
    label: "Parents",
    href: "/dashboard/people/parents",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 14a4 4 0 10-8 0v1a4 4 0 008 0v-1z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 20h12a2 2 0 002-2v-2a6 6 0 00-6-6h-4a6 6 0 00-6 6v2a2 2 0 002 2z" />
      </svg>
    ),
    roles: ["school_admin", "principal", "vice_principal", "headmistress", "teacher", "front_desk"],
  },
  {
    label: "Access Control",
    href: "/dashboard/access-control",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c1.657 0 3-1.343 3-3a3 3 0 00-6 0c0 1.657 1.343 3 3 3z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 12.414a2 2 0 00-2.828 0l-4.243 4.243a8 8 0 1111.314 0z" />
      </svg>
    ),
    roles: ["school_admin", "principal", "vice_principal"],
  },
  {
    label: "Notifications",
    href: "/dashboard/notifications",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
      </svg>
    ),
    roles: ["school_admin", "principal", "vice_principal", "headmistress", "teacher", "accountant", "front_desk", "hr_admin"],
  },
  {
    label: "Attendance",
    href: "/dashboard/attendance",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
    roles: ["school_admin", "principal", "vice_principal", "headmistress", "teacher"],
  },
  {
    label: "Timetable",
    href: "/dashboard/timetable",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M4 20h16a2 2 0 002-2V8a2 2 0 00-2-2H4a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ),
    roles: ["school_admin", "principal", "vice_principal", "headmistress", "teacher"],
  },
  {
    label: "Homework",
    href: "/dashboard/homework",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    ),
    roles: ["school_admin", "principal", "vice_principal", "headmistress", "teacher"],
  },
  {
    label: "Marks",
    href: "/dashboard/marks",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
    roles: ["school_admin", "principal", "vice_principal", "headmistress", "teacher"],
  },
  {
    label: "Discipline",
    href: "/dashboard/discipline",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3l7 4v5c0 5-3.2 8.5-7 9-3.8-.5-7-4-7-9V7l7-4z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4" />
      </svg>
    ),
    roles: ["school_admin", "principal", "vice_principal", "headmistress", "teacher"],
  },
  {
    label: "Students",
    href: "/dashboard/students",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
      </svg>
    ),
    roles: ["school_admin", "principal", "vice_principal", "headmistress", "front_desk", "hr_admin"],
  },
  {
    label: "Messaging",
    href: "/dashboard/messaging",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
      </svg>
    ),
    roles: ["school_admin", "principal", "vice_principal", "headmistress", "teacher", "accountant", "front_desk", "hr_admin"],
  },
  {
    label: "Reports",
    href: "/dashboard/reports",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l4.414 4.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
      </svg>
    ),
    roles: ["school_admin", "principal", "vice_principal", "headmistress", "teacher", "accountant"],
  },
  {
    label: "Fees",
    href: "/dashboard/fees",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
      </svg>
    ),
    roles: ["school_admin", "principal", "vice_principal", "accountant"],
  },
  {
    label: "Events",
    href: "/dashboard/events",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    ),
    roles: ["school_admin", "principal", "vice_principal", "headmistress", "teacher", "front_desk"],
  },
  {
    label: "Audit Logs",
    href: "/dashboard/admin-audit",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5l5 5v11a2 2 0 01-2 2z" />
      </svg>
    ),
    roles: ["school_admin"],
  },
  {
    label: "Observability",
    href: "/dashboard/observability",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19V6l12-3v13M9 19c0 1.105-1.79 2-4 2s-4-.895-4-2 1.79-2 4-2 4 .895 4 2zm12-3c0 1.105-1.79 2-4 2s-4-.895-4-2 1.79-2 4-2 4 .895 4 2z" />
      </svg>
    ),
    roles: ["school_admin"],
  },
];

export default function Sidebar() {
  const pathname = usePathname();
  const { user, isAdmin } = useAuth();

  const visibleItems = navItems.filter((item) => {
    if (isAdmin) return true;
    return item.roles.some((role) => user?.roles?.includes(role));
  });

  return (
    <aside className="fixed inset-y-0 left-0 z-30 w-64 bg-white border-r border-gray-200 flex flex-col">
      <div className="flex items-center gap-3 px-6 py-5 border-b border-gray-200">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary-600 text-white font-bold text-lg">A</div>
        <div>
          <h1 className="text-lg font-bold text-gray-900">Agora</h1>
          <p className="text-xs text-gray-500">School Operating System</p>
        </div>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
        {visibleItems.map((item) => {
          const isActive = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                isActive ? "bg-primary-50 text-primary-700" : "text-gray-600 hover:bg-gray-50 hover:text-gray-900"
              }`}
            >
              <span className={isActive ? "text-primary-600" : "text-gray-400"}>{item.icon}</span>
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-gray-200 px-4 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-100 text-primary-700 text-sm font-semibold">
            {user?.first_name?.[0] || "?"}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">
              {user?.first_name} {user?.last_name}
            </p>
            <p className="text-xs text-gray-500 truncate capitalize">
              {user?.roles?.[0]?.replace("_", " ") || "User"}
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}
