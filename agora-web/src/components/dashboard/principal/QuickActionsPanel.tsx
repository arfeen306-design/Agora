import Link from "next/link";

interface QuickAction {
  label: string;
  description: string;
  href: string;
  color: string;
}

const actions: QuickAction[] = [
  {
    label: "People Directory",
    description: "Review staff and student profiles",
    href: "/dashboard/people",
    color: "from-indigo-500 to-blue-500",
  },
  {
    label: "Section Setup",
    description: "Inspect sections and classroom allocations",
    href: "/dashboard/institution",
    color: "from-cyan-500 to-teal-500",
  },
  {
    label: "Reports",
    description: "Open leadership report summaries",
    href: "/dashboard/reports",
    color: "from-amber-500 to-orange-500",
  },
  {
    label: "Finance View",
    description: "Monitor invoices and defaulters",
    href: "/dashboard/fees",
    color: "from-emerald-500 to-lime-500",
  },
];

export default function QuickActionsPanel() {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900">Quick Actions</h3>
      <p className="mt-1 text-sm text-gray-500">Fast leadership navigation to high-impact modules.</p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {actions.map((action) => (
          <Link
            key={action.href}
            href={action.href}
            className="group rounded-xl border border-gray-200 bg-gray-50 p-3 transition hover:border-transparent hover:shadow-md"
          >
            <div className={`h-1.5 w-full rounded-full bg-gradient-to-r ${action.color}`} />
            <p className="mt-3 text-sm font-semibold text-gray-900 group-hover:text-blue-700">{action.label}</p>
            <p className="mt-1 text-xs text-gray-600">{action.description}</p>
          </Link>
        ))}
      </div>
    </section>
  );
}
