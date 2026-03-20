"use client";

import { useEffect, useMemo, useState } from "react";

import type {
  ClassroomWeeklyTimetableBoardPayload,
  ClassroomWeeklyTimetableCell,
} from "@/lib/api";

const SUBJECT_COLORS = [
  "#ef4444",
  "#8b5cf6",
  "#10b981",
  "#f59e0b",
  "#06b6d4",
  "#14b8a6",
  "#f97316",
  "#22c55e",
  "#ec4899",
  "#64748b",
];

type CellDraft = {
  subject_id: string;
  teacher_id: string;
  title: string;
  subtitle: string;
  room_number: string;
  notes: string;
  color_hex: string;
};

type Props = {
  board: ClassroomWeeklyTimetableBoardPayload;
  editable?: boolean;
  busy?: boolean;
  onAddRow?: (payload: { label: string; day_of_week?: number | null }) => Promise<void>;
  onAddColumn?: (payload: { label: string; starts_at?: string | null; ends_at?: string | null }) => Promise<void>;
  onSaveCell?: (cellId: string, payload: CellDraft) => Promise<void>;
  title?: string;
  subtitle?: string;
};

function buildEmptyDraft(): CellDraft {
  return {
    subject_id: "",
    teacher_id: "",
    title: "",
    subtitle: "",
    room_number: "",
    notes: "",
    color_hex: "",
  };
}

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "");
  if (normalized.length !== 6) return null;
  const value = Number.parseInt(normalized, 16);
  if (Number.isNaN(value)) return null;
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
}

function textColorForHex(hex?: string | null) {
  if (!hex) return "#1f2937";
  const rgb = hexToRgb(hex);
  if (!rgb) return "#1f2937";
  const brightness = (rgb.r * 299 + rgb.g * 587 + rgb.b * 114) / 1000;
  return brightness > 150 ? "#111827" : "#ffffff";
}

function displayCellTitle(cell: ClassroomWeeklyTimetableCell) {
  return cell.title || cell.subject_code || cell.subject_name || "Free slot";
}

function displayCellSubtitle(cell: ClassroomWeeklyTimetableCell) {
  return cell.subtitle || cell.teacher_name || "";
}

export default function ClassroomWeeklyTimetableBoard({
  board,
  editable = false,
  busy = false,
  onAddRow,
  onAddColumn,
  onSaveCell,
  title,
  subtitle,
}: Props) {
  const [selectedCellId, setSelectedCellId] = useState<string>("");
  const [draft, setDraft] = useState<CellDraft>(buildEmptyDraft);
  const [rowLabel, setRowLabel] = useState("");
  const [rowDay, setRowDay] = useState("");
  const [columnLabel, setColumnLabel] = useState("");
  const [columnStart, setColumnStart] = useState("");
  const [columnEnd, setColumnEnd] = useState("");
  const [localBusy, setLocalBusy] = useState(false);

  const subjectColorMap = useMemo(() => {
    const map = new Map<string, string>();
    board.available_subjects.forEach((subject, index) => {
      map.set(subject.id, SUBJECT_COLORS[index % SUBJECT_COLORS.length]);
    });
    return map;
  }, [board.available_subjects]);

  const cellMap = useMemo(() => {
    const map = new Map<string, ClassroomWeeklyTimetableCell>();
    board.cells.forEach((cell) => {
      map.set(`${cell.row_id}:${cell.column_id}`, cell);
    });
    return map;
  }, [board.cells]);

  const selectedCell = useMemo(
    () => board.cells.find((cell) => cell.id === selectedCellId) || null,
    [board.cells, selectedCellId]
  );

  useEffect(() => {
    if (!selectedCellId && board.cells[0]) {
      setSelectedCellId(board.cells[0].id);
    }
  }, [board.cells, selectedCellId]);

  useEffect(() => {
    if (!selectedCell) {
      setDraft(buildEmptyDraft());
      return;
    }
    setDraft({
      subject_id: selectedCell.subject_id || "",
      teacher_id: selectedCell.teacher_id || "",
      title: selectedCell.title || "",
      subtitle: selectedCell.subtitle || "",
      room_number: selectedCell.room_number || "",
      notes: selectedCell.notes || "",
      color_hex: selectedCell.color_hex || "",
    });
  }, [selectedCell]);

  async function handleAddRow() {
    if (!onAddRow || !rowLabel.trim()) return;
    setLocalBusy(true);
    try {
      await onAddRow({
        label: rowLabel.trim(),
        day_of_week: rowDay ? Number(rowDay) : null,
      });
      setRowLabel("");
      setRowDay("");
    } finally {
      setLocalBusy(false);
    }
  }

  async function handleAddColumn() {
    if (!onAddColumn || !columnLabel.trim()) return;
    setLocalBusy(true);
    try {
      await onAddColumn({
        label: columnLabel.trim(),
        starts_at: columnStart || null,
        ends_at: columnEnd || null,
      });
      setColumnLabel("");
      setColumnStart("");
      setColumnEnd("");
    } finally {
      setLocalBusy(false);
    }
  }

  async function handleSaveCell() {
    if (!selectedCell || !onSaveCell) return;
    setLocalBusy(true);
    try {
      await onSaveCell(selectedCell.id, draft);
    } finally {
      setLocalBusy(false);
    }
  }

  return (
    <section className="rounded-[28px] border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900">{title || "Weekly Timetable"}</h2>
          <p className="mt-1 text-sm text-slate-500">
            {subtitle || "Days are vertical and time slots are horizontal so teachers and families see the same weekly plan."}
          </p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
          <div className="font-semibold text-slate-900">{board.classroom.label}</div>
          <div className="mt-1">
            {board.classroom.academic_year_name || "Academic year"} {board.classroom.classroom_code ? `• ${board.classroom.classroom_code}` : ""}
          </div>
        </div>
      </div>

      {editable ? (
        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Add row</p>
            <div className="mt-3 grid gap-3 md:grid-cols-[1fr_180px_auto]">
              <input
                className="input-field"
                placeholder="e.g. Saturday, Activity, Special"
                value={rowLabel}
                onChange={(e) => setRowLabel(e.target.value)}
              />
              <select className="input-field" value={rowDay} onChange={(e) => setRowDay(e.target.value)}>
                <option value="">Custom row</option>
                <option value="1">Monday</option>
                <option value="2">Tuesday</option>
                <option value="3">Wednesday</option>
                <option value="4">Thursday</option>
                <option value="5">Friday</option>
                <option value="6">Saturday</option>
                <option value="7">Sunday</option>
              </select>
              <button
                type="button"
                className="btn-secondary"
                onClick={handleAddRow}
                disabled={!rowLabel.trim() || localBusy || busy}
              >
                Add row
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">Add column</p>
            <div className="mt-3 grid gap-3 md:grid-cols-[1fr_140px_140px_auto]">
              <input
                className="input-field"
                placeholder="e.g. Period 8, Club, Zero Period"
                value={columnLabel}
                onChange={(e) => setColumnLabel(e.target.value)}
              />
              <input className="input-field" type="time" value={columnStart} onChange={(e) => setColumnStart(e.target.value)} />
              <input className="input-field" type="time" value={columnEnd} onChange={(e) => setColumnEnd(e.target.value)} />
              <button
                type="button"
                className="btn-secondary"
                onClick={handleAddColumn}
                disabled={!columnLabel.trim() || localBusy || busy}
              >
                Add column
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className="mt-6 overflow-x-auto">
        <table className="min-w-full border-separate border-spacing-0">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 min-w-[120px] rounded-tl-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-left text-xs font-semibold uppercase tracking-[0.25em] text-slate-500">
                Day
              </th>
              {board.columns.map((column, index) => (
                <th
                  key={column.id}
                  className={`min-w-[170px] border border-slate-200 bg-slate-50 px-4 py-3 text-center ${
                    index === board.columns.length - 1 ? "rounded-tr-2xl" : ""
                  }`}
                >
                  <div className="text-sm font-semibold text-slate-900">{column.label}</div>
                  <div className="mt-1 text-xs text-slate-500">
                    {column.starts_at && column.ends_at ? `${column.starts_at} to ${column.ends_at}` : "Time flexible"}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {board.rows.map((row, rowIndex) => (
              <tr key={row.id}>
                <th
                  className={`sticky left-0 z-10 border border-slate-200 bg-white px-4 py-4 text-left align-top ${
                    rowIndex === board.rows.length - 1 ? "rounded-bl-2xl" : ""
                  }`}
                >
                  <div className="font-semibold text-slate-900">{row.label}</div>
                  <div className="mt-1 text-xs text-slate-500">{row.day_name || "Custom row"}</div>
                </th>
                {board.columns.map((column, columnIndex) => {
                  const cell = cellMap.get(`${row.id}:${column.id}`);
                  const background = cell?.color_hex || "#ffffff";
                  const textColor = textColorForHex(cell?.color_hex);
                  const isSelected = cell?.id === selectedCellId;
                  const body = (
                    <div
                      className="min-h-[108px] rounded-2xl border px-3 py-3 text-left shadow-sm transition"
                      style={{
                        background,
                        color: textColor,
                        borderColor: isSelected ? "#8b5cf6" : "#e2e8f0",
                        boxShadow: isSelected ? "0 0 0 2px rgba(139, 92, 246, 0.18)" : undefined,
                      }}
                    >
                      <div className="text-sm font-semibold">{cell ? displayCellTitle(cell) : editable ? "Add slot" : "Free slot"}</div>
                      <div className="mt-2 text-xs opacity-90">{cell ? displayCellSubtitle(cell) || "Teacher not assigned" : "No class scheduled"}</div>
                      {cell?.room_number ? <div className="mt-2 text-xs opacity-80">Room {cell.room_number}</div> : null}
                    </div>
                  );

                  return (
                    <td
                      key={column.id}
                      className={`border border-slate-200 bg-white p-2 align-top ${
                        rowIndex === board.rows.length - 1 && columnIndex === board.columns.length - 1 ? "rounded-br-2xl" : ""
                      }`}
                    >
                      {editable && cell ? (
                        <button type="button" className="block w-full" onClick={() => setSelectedCellId(cell.id)}>
                          {body}
                        </button>
                      ) : (
                        body
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editable && selectedCell ? (
        <div className="mt-6 rounded-[24px] border border-violet-200 bg-violet-50/60 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.3em] text-violet-600">Edit cell</p>
              <h3 className="mt-2 text-lg font-semibold text-slate-900">
                {board.rows.find((row) => row.id === selectedCell.row_id)?.label} • {board.columns.find((column) => column.id === selectedCell.column_id)?.label}
              </h3>
            </div>
            <button type="button" className="btn-primary" onClick={handleSaveCell} disabled={busy || localBusy}>
              Save cell
            </button>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            <label className="space-y-2">
              <span className="label-text">Subject</span>
              <select
                className="input-field"
                value={draft.subject_id}
                onChange={(e) => {
                  const nextSubjectId = e.target.value;
                  const subject = board.available_subjects.find((item) => item.id === nextSubjectId);
                  setDraft((current) => ({
                    ...current,
                    subject_id: nextSubjectId,
                    teacher_id: subject?.teacher_id || current.teacher_id,
                    title: subject?.subject_code || subject?.subject_name || current.title,
                    subtitle: subject?.teacher_name || current.subtitle,
                    color_hex: subject ? subjectColorMap.get(subject.id) || current.color_hex : current.color_hex,
                  }));
                }}
              >
                <option value="">Free slot</option>
                {board.available_subjects.map((subject) => (
                  <option key={subject.id} value={subject.id}>
                    {subject.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2">
              <span className="label-text">Teacher</span>
              <select
                className="input-field"
                value={draft.teacher_id}
                onChange={(e) => setDraft((current) => ({ ...current, teacher_id: e.target.value }))}
              >
                <option value="">Select teacher</option>
                {board.available_teachers.map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>
                    {teacher.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="space-y-2">
              <span className="label-text">Title</span>
              <input className="input-field" value={draft.title} onChange={(e) => setDraft((current) => ({ ...current, title: e.target.value }))} />
            </label>

            <label className="space-y-2">
              <span className="label-text">Subtitle</span>
              <input className="input-field" value={draft.subtitle} onChange={(e) => setDraft((current) => ({ ...current, subtitle: e.target.value }))} />
            </label>

            <label className="space-y-2">
              <span className="label-text">Room</span>
              <input className="input-field" value={draft.room_number} onChange={(e) => setDraft((current) => ({ ...current, room_number: e.target.value }))} />
            </label>

            <label className="space-y-2">
              <span className="label-text">Color</span>
              <div className="flex items-center gap-3">
                <input
                  type="color"
                  className="h-11 w-16 rounded-xl border border-slate-200 bg-white p-1"
                  value={draft.color_hex || "#8b5cf6"}
                  onChange={(e) => setDraft((current) => ({ ...current, color_hex: e.target.value }))}
                />
                <input
                  className="input-field"
                  value={draft.color_hex}
                  onChange={(e) => setDraft((current) => ({ ...current, color_hex: e.target.value }))}
                  placeholder="#8b5cf6"
                />
              </div>
            </label>

            <label className="space-y-2 xl:col-span-2">
              <span className="label-text">Notes</span>
              <textarea
                className="min-h-[96px] w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-violet-400 focus:ring-4 focus:ring-violet-100"
                value={draft.notes}
                onChange={(e) => setDraft((current) => ({ ...current, notes: e.target.value }))}
              />
            </label>
          </div>
        </div>
      ) : null}
    </section>
  );
}
