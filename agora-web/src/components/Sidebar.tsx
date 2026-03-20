"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/lib/auth";
import { formatRoleLabel, getRoleTheme } from "@/lib/role-theme";

const FAMILY_PRIORITY_ROLES = ["parent", "student"];

type NavItem = {
  label: string;
  href?: string;
  icon: React.ReactNode;
  roles: string[];
  children?: NavItem[];
};

function hasAnyRole(roles: string[] = [], allowed: string[]) {
  return allowed.some((role) => roles.includes(role));
}

function resolveSidebarRoles(roles: string[] = []) {
  if (hasAnyRole(roles, FAMILY_PRIORITY_ROLES)) {
    return FAMILY_PRIORITY_ROLES.filter((role) => roles.includes(role));
  }
  return roles;
}

function isPathMatch(pathname: string, href: string) {
  if (href === "/dashboard") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

const navItems: NavItem[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
      </svg>
    ),
    roles: ["school_admin", "principal", "vice_principal", "headmistress", "teacher", "accountant", "front_desk", "hr_admin", "parent", "student"],
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
    label: "Class Teacher",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 8h10M7 12h10M7 16h6" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 4h14a2 2 0 012 2v12a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z" />
      </svg>
    ),
    roles: ["school_admin", "principal", "vice_principal", "headmistress", "teacher"],
    children: [
      {
        label: "Overview",
        href: "/dashboard/class-teacher",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
          </svg>
        ),
        roles: ["school_admin", "principal", "vice_principal", "headmistress", "teacher"],
      },
      {
        label: "Timetable",
        href: "/dashboard/class-teacher/timetable",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        ),
        roles: ["school_admin", "principal", "vice_principal", "headmistress", "teacher"],
      },
      {
        label: "Class Attendance",
        href: "/dashboard/class-teacher/attendance",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 4h6m-7 4h8m-9 4h10m-11 4h12" />
          </svg>
        ),
        roles: ["school_admin", "principal", "vice_principal", "headmistress", "teacher"],
      },
      {
        label: "Class Results",
        href: "/dashboard/class-teacher/results",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 3v18m0 0h14m-14 0l4-8 4 4 6-10" />
          </svg>
        ),
        roles: ["school_admin", "principal", "vice_principal", "headmistress", "teacher"],
      },
      {
        label: "Report Cards",
        href: "/dashboard/class-teacher/report-cards",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 3h7l5 5v13a1 1 0 01-1 1H7a2 2 0 01-2-2V5a2 2 0 012-2z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 3v5h5M9 13h6M9 17h6M9 9h2" />
          </svg>
        ),
        roles: ["school_admin", "principal", "vice_principal", "headmistress", "teacher"],
      },
      {
        label: "Exam Terms",
        href: "/dashboard/exam-terms",
        icon: (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        ),
        roles: ["school_admin", "principal", "vice_principal", "headmistress", "teacher"],
      },
    ],
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
    label: "Setup Wizard",
    href: "/dashboard/setup-wizard",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3l8 4v6c0 5-3.5 7.5-8 8-4.5-.5-8-3-8-8V7l8-4z" />
      </svg>
    ),
    roles: ["school_admin", "principal", "vice_principal", "front_desk", "hr_admin"],
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
    label: "Documents",
    href: "/dashboard/documents",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 3h7l5 5v13a1 1 0 01-1 1H7a2 2 0 01-2-2V5a2 2 0 012-2z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 3v5h5M9 13h6M9 17h6M9 9h2" />
      </svg>
    ),
    roles: ["school_admin", "principal", "vice_principal", "headmistress", "teacher", "front_desk", "hr_admin", "accountant"],
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
    roles: ["school_admin", "principal", "vice_principal", "headmistress", "front_desk"],
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
    roles: ["school_admin", "principal", "vice_principal", "headmistress", "teacher", "accountant", "front_desk", "hr_admin", "parent", "student"],
  },
  {
    label: "Attendance",
    href: "/dashboard/attendance",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
      </svg>
    ),
    roles: ["school_admin", "principal", "vice_principal", "headmistress", "teacher", "parent", "student"],
  },
  {
    label: "Homework",
    href: "/dashboard/homework",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
      </svg>
    ),
    roles: ["school_admin", "principal", "vice_principal", "headmistress", "teacher", "parent", "student"],
  },
  {
    label: "AI Tutor",
    href: "/dashboard/tutor",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
      </svg>
    ),
    roles: ["school_admin", "student"],
  },
  {
    label: "Marks",
    href: "/dashboard/marks",
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
    roles: ["school_admin", "principal", "vice_principal", "headmistress", "teacher", "parent", "student"],
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
    roles: ["school_admin", "principal", "vice_principal", "headmistress", "teacher", "accountant", "front_desk", "hr_admin", "parent", "student"],
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
  const router = useRouter();
  const { user } = useAuth();
  const effectiveRoles = resolveSidebarRoles(user?.roles || []);
  const roleTheme = getRoleTheme(effectiveRoles);
  const [isPinned, setIsPinned] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const isExpanded = isPinned || isHovered;

  const visibleItems = useMemo(
    () =>
      navItems
        .map((item) => ({
          ...item,
          children: item.children?.filter((child) => {
            if (effectiveRoles.includes("super_admin")) return true;
            return child.roles.some((role) => effectiveRoles.includes(role));
          }),
        }))
        .filter((item) => {
        if (effectiveRoles.includes("super_admin")) return true;
        return item.roles.some((role) => effectiveRoles.includes(role));
      }),
    [effectiveRoles]
  );

  useEffect(() => {
    visibleItems.forEach((item) => {
      if (item.href) router.prefetch(item.href);
      item.children?.forEach((child) => {
        if (child.href) router.prefetch(child.href);
      });
    });
  }, [router, visibleItems]);

  return (
    <aside
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`fixed inset-y-0 left-0 z-30 flex flex-col overflow-hidden border-r border-white/10 bg-[linear-gradient(180deg,#2a0717_0%,#4a152c_38%,#220916_100%)] text-white shadow-[18px_0_45px_rgba(15,23,42,0.18)] transition-[width] duration-300 ${isExpanded ? "w-72" : "w-[92px]"}`}
    >
      <div className="border-b border-white/10 px-4 py-5">
        <div className={`flex items-center ${isExpanded ? "justify-between gap-3" : "justify-center"}`}>
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-rose-500 text-lg font-bold text-white shadow-lg shadow-violet-950/30">
              A
            </div>
            <div className={`overflow-hidden transition-all duration-300 ${isExpanded ? "max-w-[180px] opacity-100" : "max-w-0 opacity-0"}`}>
              <h1 className="text-lg font-bold text-white">Agora</h1>
              <p className="text-xs text-white/70">School Operating System</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsPinned((prev) => !prev)}
            aria-label={isPinned ? "Collapse navigation" : "Pin navigation open"}
            className={`rounded-full border border-white/[0.12] bg-white/[0.08] p-2 text-white/75 transition hover:bg-white/[0.12] hover:text-white ${isExpanded ? "opacity-100" : "pointer-events-none opacity-0"}`}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              {isPinned ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7-7-7 7" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7 7 7-7" />
              )}
            </svg>
          </button>
        </div>

        <div
          className={`mt-4 rounded-2xl border border-white/10 bg-white/[0.08] backdrop-blur transition-all duration-300 ${
            isExpanded ? "px-3 py-3 opacity-100" : "h-0 overflow-hidden border-transparent px-0 py-0 opacity-0"
          }`}
        >
          <p className="text-[11px] uppercase tracking-[0.24em] text-white/[0.52]">Active role</p>
          <div className="mt-2 flex items-center justify-between gap-3">
            <span className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${roleTheme.badgeClass}`}>
              {roleTheme.label}
            </span>
            <span className="text-[11px] text-white/[0.68]">{visibleItems.length} modules</span>
          </div>
        </div>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
        {visibleItems.map((item) => {
          const isSelfActive = item.href ? pathname === item.href : false;
          const hasActiveChild =
            item.children?.some((child) => (child.href ? isPathMatch(pathname, child.href) : false)) || false;
          const isParentActive = isSelfActive || hasActiveChild;
          return (
            <div key={item.href || item.label} className="space-y-1">
              {item.children?.length ? (
                <div
                  title={isExpanded ? undefined : item.label}
                  className={`group flex items-center rounded-2xl py-2.5 text-sm font-medium transition-all ${
                    hasActiveChild
                      ? "border border-white/[0.12] bg-white/[0.05] text-white"
                      : "border border-transparent text-white/[0.86] hover:bg-white/[0.04]"
                  } ${isExpanded ? "justify-start gap-3 px-3" : "justify-center px-0"}`}
                >
                  <span className={isParentActive ? "text-white" : "text-white/[0.72] group-hover:text-white"}>{item.icon}</span>
                  <span
                    className={`overflow-hidden whitespace-nowrap transition-all duration-300 ${
                      isExpanded ? "max-w-[190px] opacity-100" : "max-w-0 opacity-0"
                    }`}
                  >
                    {item.label}
                  </span>
                  {isExpanded ? (
                    <span
                      className={`ml-auto rounded-full px-2 py-0.5 text-[10px] uppercase tracking-[0.2em] ${
                        hasActiveChild
                          ? "border border-violet-200/30 bg-violet-300/15 text-violet-100"
                          : "border border-white/10 bg-white/[0.06] text-white/[0.58]"
                      }`}
                    >
                      {hasActiveChild ? "Open" : "Workspace"}
                    </span>
                  ) : null}
                </div>
              ) : (
                <Link
                  href={item.href || "#"}
                  title={isExpanded ? undefined : item.label}
                  className={`group flex items-center rounded-2xl py-2.5 text-sm font-medium transition-all ${
                    isSelfActive
                      ? "bg-white/[0.14] text-white shadow-[0_18px_32px_rgba(15,23,42,0.18)] ring-1 ring-white/10"
                      : "text-white/[0.86] hover:bg-white/[0.08] hover:text-white"
                  } ${isExpanded ? "justify-start gap-3 px-3" : "justify-center px-0"}`}
                >
                  <span className={isParentActive ? "text-white" : "text-white/[0.72] group-hover:text-white"}>{item.icon}</span>
                  <span
                    className={`overflow-hidden whitespace-nowrap transition-all duration-300 ${
                      isExpanded ? "max-w-[190px] opacity-100" : "max-w-0 opacity-0"
                    }`}
                  >
                    {item.label}
                  </span>
                </Link>
              )}

              {isExpanded && item.children?.length ? (
                <div className="ml-6 space-y-1 border-l border-white/10 pl-3">
                  {item.children.map((child) => {
                    if (!child.href) return null;
                    const isChildActive = child.href ? isPathMatch(pathname, child.href) : false;
                    return (
                      <Link
                        key={child.href}
                        href={child.href}
                        className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm transition-all ${
                          isChildActive
                            ? "bg-white/[0.14] text-white shadow-[0_12px_22px_rgba(15,23,42,0.16)] ring-1 ring-white/10"
                            : "text-white/[0.72] hover:bg-white/[0.08] hover:text-white"
                        }`}
                      >
                        <span className={isChildActive ? "text-white" : "text-white/[0.56]"}>{child.icon}</span>
                        <span className="truncate">{child.label}</span>
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>

      <div className="border-t border-white/10 px-4 py-4">
        <div
          className={`flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.07] py-3 backdrop-blur transition-all duration-300 ${
            isExpanded ? "px-3" : "justify-center px-0"
          }`}
        >
          <div className={`flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold shadow-sm ${roleTheme.avatarClass}`}>
            {user?.first_name?.[0] || "?"}
          </div>
          <div className={`min-w-0 flex-1 overflow-hidden transition-all duration-300 ${isExpanded ? "max-w-[180px] opacity-100" : "max-w-0 opacity-0"}`}>
            <p className="truncate text-sm font-medium text-white">
              {user?.first_name} {user?.last_name}
            </p>
            <p className="truncate text-xs text-white/[0.7]">
              {formatRoleLabel(effectiveRoles[0] || user?.roles?.[0] || "User")}
            </p>
          </div>
        </div>
      </div>
    </aside>
  );
}
