export type RoleThemeKey =
  | "school_admin"
  | "principal"
  | "vice_principal"
  | "headmistress"
  | "teacher"
  | "accountant"
  | "front_desk"
  | "hr_admin"
  | "parent"
  | "student"
  | "default";

const ROLE_PRIORITY: RoleThemeKey[] = [
  "school_admin",
  "principal",
  "vice_principal",
  "headmistress",
  "teacher",
  "accountant",
  "front_desk",
  "hr_admin",
  "parent",
  "student",
];

const ROLE_THEME_MAP = {
  school_admin: {
    label: "School Admin",
    badgeClass: "border-white/[0.15] bg-white/10 text-white",
    pillClass: "bg-gradient-to-r from-fuchsia-500 to-rose-500 text-white",
    avatarClass: "bg-gradient-to-br from-fuchsia-500 to-rose-500 text-white",
    accentClass: "from-fuchsia-500/50 via-rose-500/35 to-transparent",
  },
  principal: {
    label: "Principal",
    badgeClass: "border-white/[0.15] bg-white/10 text-white",
    pillClass: "bg-gradient-to-r from-violet-500 to-indigo-500 text-white",
    avatarClass: "bg-gradient-to-br from-violet-500 to-indigo-500 text-white",
    accentClass: "from-violet-500/50 via-indigo-500/35 to-transparent",
  },
  vice_principal: {
    label: "Vice Principal",
    badgeClass: "border-white/[0.15] bg-white/10 text-white",
    pillClass: "bg-gradient-to-r from-indigo-500 to-cyan-500 text-white",
    avatarClass: "bg-gradient-to-br from-indigo-500 to-cyan-500 text-white",
    accentClass: "from-indigo-500/50 via-cyan-500/30 to-transparent",
  },
  headmistress: {
    label: "Headmistress",
    badgeClass: "border-white/[0.15] bg-white/10 text-white",
    pillClass: "bg-gradient-to-r from-emerald-500 to-teal-500 text-white",
    avatarClass: "bg-gradient-to-br from-emerald-500 to-teal-500 text-white",
    accentClass: "from-emerald-500/[0.45] via-teal-500/30 to-transparent",
  },
  teacher: {
    label: "Teacher",
    badgeClass: "border-white/[0.15] bg-white/10 text-white",
    pillClass: "bg-gradient-to-r from-cyan-500 to-blue-500 text-white",
    avatarClass: "bg-gradient-to-br from-cyan-500 to-blue-500 text-white",
    accentClass: "from-cyan-500/[0.45] via-blue-500/30 to-transparent",
  },
  accountant: {
    label: "Accountant",
    badgeClass: "border-white/[0.15] bg-white/10 text-white",
    pillClass: "bg-gradient-to-r from-amber-500 to-orange-500 text-white",
    avatarClass: "bg-gradient-to-br from-amber-500 to-orange-500 text-white",
    accentClass: "from-amber-500/40 via-orange-500/30 to-transparent",
  },
  front_desk: {
    label: "Front Desk",
    badgeClass: "border-white/[0.15] bg-white/10 text-white",
    pillClass: "bg-gradient-to-r from-pink-500 to-rose-500 text-white",
    avatarClass: "bg-gradient-to-br from-pink-500 to-rose-500 text-white",
    accentClass: "from-pink-500/[0.45] via-rose-500/30 to-transparent",
  },
  hr_admin: {
    label: "HR Admin",
    badgeClass: "border-white/[0.15] bg-white/10 text-white",
    pillClass: "bg-gradient-to-r from-purple-500 to-fuchsia-500 text-white",
    avatarClass: "bg-gradient-to-br from-purple-500 to-fuchsia-500 text-white",
    accentClass: "from-purple-500/[0.45] via-fuchsia-500/30 to-transparent",
  },
  parent: {
    label: "Parent",
    badgeClass: "border-white/[0.15] bg-white/10 text-white",
    pillClass: "bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white",
    avatarClass: "bg-gradient-to-br from-violet-500 to-fuchsia-500 text-white",
    accentClass: "from-violet-500/[0.45] via-fuchsia-500/30 to-transparent",
  },
  student: {
    label: "Student",
    badgeClass: "border-white/[0.15] bg-white/10 text-white",
    pillClass: "bg-gradient-to-r from-indigo-500 to-violet-500 text-white",
    avatarClass: "bg-gradient-to-br from-indigo-500 to-violet-500 text-white",
    accentClass: "from-indigo-500/[0.45] via-violet-500/30 to-transparent",
  },
  default: {
    label: "Workspace",
    badgeClass: "border-white/[0.15] bg-white/10 text-white",
    pillClass: "bg-gradient-to-r from-slate-700 to-slate-900 text-white",
    avatarClass: "bg-slate-800 text-white",
    accentClass: "from-slate-500/40 via-slate-400/20 to-transparent",
  },
} as const;

export function getPrimaryRole(roles: string[] = []): RoleThemeKey {
  const matched = ROLE_PRIORITY.find((role) => roles.includes(role));
  return matched || "default";
}

export function getRoleTheme(roles: string[] = []) {
  return ROLE_THEME_MAP[getPrimaryRole(roles)];
}

export function formatRoleLabel(role?: string | null) {
  if (!role) return ROLE_THEME_MAP.default.label;
  return role.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
}
