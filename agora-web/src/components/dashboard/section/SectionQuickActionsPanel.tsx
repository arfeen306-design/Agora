import Link from "next/link";

const actions = [
  {
    label: "People in Section",
    description: "Review staff and students linked to your section",
    href: "/dashboard/people",
    color: "from-cyan-500 to-blue-500",
  },
  {
    label: "Section Attendance",
    description: "Inspect and follow up attendance records",
    href: "/dashboard/attendance",
    color: "from-emerald-500 to-teal-500",
  },
  {
    label: "Section Homework",
    description: "Track submission completion and missing work",
    href: "/dashboard/homework",
    color: "from-amber-500 to-orange-500",
  },
  {
    label: "Section Marks",
    description: "Monitor marks upload progress",
    href: "/dashboard/marks",
    color: "from-indigo-500 to-violet-500",
  },
];

export default function SectionQuickActionsPanel() {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900">Quick Actions</h3>
      <p className="mt-1 text-sm text-gray-500">Section operations shortcuts for today.</p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {actions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="group rounded-xl border border-gray-200 bg-gray-50 p-3 transition hover:border-transparent hover:shadow-md"
          >
            <div className={`h-1.5 w-full rounded-full bg-gradient-to-r ${action.color}`} />
            <p className="mt-3 text-sm font-semibold text-gray-900 group-hover:text-emerald-700">{action.label}</p>
            <p className="mt-1 text-xs text-gray-600">{action.description}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
