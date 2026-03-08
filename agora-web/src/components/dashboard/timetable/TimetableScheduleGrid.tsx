"use client";

import type { TimetableEntryRow, TimetableSlotRow } from "@/lib/api";

interface TimetableScheduleGridProps {
  title: string;
  subtitle: string;
  slots: TimetableSlotRow[];
  entries: TimetableEntryRow[];
}

function formatTime(value?: string) {
  if (!value) return "";
  return value.slice(0, 5);
}

function typePill(entryType: TimetableEntryRow["entry_type"]) {
  if (entryType === "activity") return "bg-amber-100 text-amber-800";
  if (entryType === "study_hall") return "bg-indigo-100 text-indigo-800";
  if (entryType === "break") return "bg-zinc-100 text-zinc-700";
  return "bg-blue-100 text-blue-800";
}

export default function TimetableScheduleGrid({
  title,
  subtitle,
  slots,
  entries,
}: TimetableScheduleGridProps) {
  const days = Array.from(new Set(slots.map((row) => row.day_of_week))).sort((a, b) => a - b);
  const periods = Array.from(new Set(slots.map((row) => row.period_number))).sort((a, b) => a - b);

  const slotByDayPeriod = new Map<string, TimetableSlotRow>();
  for (const slot of slots) {
    slotByDayPeriod.set(`${slot.day_of_week}-${slot.period_number}`, slot);
  }

  const entryBySlot = new Map<string, TimetableEntryRow>();
  for (const entry of entries) {
    entryBySlot.set(entry.slot_id, entry);
  }

  if (slots.length === 0) {
    return (
      <section className="rounded-xl border border-dashed border-gray-300 bg-white p-6">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
        <div className="mt-4 rounded-lg bg-blue-50 p-4 text-sm text-blue-800">
          No timetable slots yet. Generate slots for this Academic Year first.
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-gray-200 bg-white shadow-sm">
      <div className="border-b border-gray-100 px-5 py-4">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        <p className="mt-1 text-sm text-gray-500">{subtitle}</p>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="sticky left-0 z-10 border-b border-r border-gray-200 bg-gray-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-600">
                Period
              </th>
              {days.map((day) => {
                const anySlot = slots.find((slot) => slot.day_of_week === day);
                return (
                  <th
                    key={day}
                    className="border-b border-r border-gray-200 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-600"
                  >
                    {anySlot?.day_name || `Day ${day}`}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {periods.map((period) => {
              const sampleSlot = slots.find((slot) => slot.period_number === period);
              return (
                <tr key={period} className="align-top">
                  <td className="sticky left-0 z-10 min-w-[140px] border-b border-r border-gray-200 bg-white px-4 py-3">
                    <p className="text-sm font-semibold text-gray-900">{sampleSlot?.period_label || `Period ${period}`}</p>
                    <p className="text-xs text-gray-500">
                      {formatTime(sampleSlot?.starts_at)} - {formatTime(sampleSlot?.ends_at)}
                    </p>
                  </td>
                  {days.map((day) => {
                    const slot = slotByDayPeriod.get(`${day}-${period}`);
                    const entry = slot ? entryBySlot.get(slot.id) : null;

                    if (!slot) {
                      return (
                        <td key={`${day}-${period}`} className="min-w-[210px] border-b border-r border-gray-200 px-4 py-3">
                          <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-400">
                            Not configured
                          </div>
                        </td>
                      );
                    }

                    if (!entry) {
                      return (
                        <td key={`${day}-${period}`} className="min-w-[210px] border-b border-r border-gray-200 px-4 py-3">
                          <div className="rounded-lg border border-dashed border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                            Slot open
                          </div>
                        </td>
                      );
                    }

                    return (
                      <td key={`${day}-${period}`} className="min-w-[210px] border-b border-r border-gray-200 px-4 py-3">
                        <div className="space-y-2 rounded-lg border border-blue-100 bg-blue-50/60 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-semibold text-gray-900">{entry.subject_name || "General Session"}</p>
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase ${typePill(entry.entry_type)}`}>
                              {entry.entry_type.replace("_", " ")}
                            </span>
                          </div>
                          <p className="text-xs text-gray-600">{entry.teacher_name || "Teacher not assigned"}</p>
                          <p className="text-xs text-gray-500">
                            Room: {entry.room_number || "Unassigned"}
                          </p>
                          {entry.notes ? <p className="text-xs text-gray-500">{entry.notes}</p> : null}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
