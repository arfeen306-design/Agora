import Link from "next/link";

import type { PendingItem } from "./types";

const toneStyles: Record<PendingItem["tone"], string> = {
  primary: "border-blue-200 bg-blue-50 text-blue-800",
  warning: "border-amber-200 bg-amber-50 text-amber-800",
  danger: "border-red-200 bg-red-50 text-red-800",
};

export default function PendingItemsPanel({ items }: { items: PendingItem[] }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <h3 className="text-lg font-semibold text-gray-900">Pending Items</h3>
      <p className="mt-1 text-sm text-gray-500">Operational items that need leadership follow-up today.</p>

      <div className="mt-4 space-y-3">
        {items.map((item) => (
          <div key={item.id} className={`rounded-lg border p-3 ${toneStyles[item.tone]}`}>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide">{item.label}</p>
                <p className="mt-1 text-xl font-bold">{item.value}</p>
              </div>
              {item.href && (
                <Link href={item.href} className="text-xs font-semibold underline">
                  Open
                </Link>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
