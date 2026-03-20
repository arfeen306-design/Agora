"use client";

import { useEffect, useMemo, useState } from "react";

import Header from "@/components/Header";
import ClassroomWeeklyTimetableBoard from "@/components/timetable/ClassroomWeeklyTimetableBoard";
import { useAuth } from "@/lib/auth";
import {
  createClassTeacherTimetableColumn,
  createClassTeacherTimetableRow,
  getClassTeacherMyClassroom,
  getClassTeacherTimetableBoard,
  getLookupClassrooms,
  type ClassroomWeeklyTimetableBoardPayload,
  type LookupClassroom,
  updateClassTeacherTimetableCell,
} from "@/lib/api";

const CLASS_TEACHER_ROLES = ["school_admin", "principal", "vice_principal", "headmistress", "teacher"];
const LEADERSHIP_VIEWER_ROLES = ["school_admin", "principal", "vice_principal", "headmistress"];

function hasAnyRole(roles: string[] = [], allowed: string[]) {
  return allowed.some((role) => roles.includes(role));
}

export default function ClassTeacherTimetablePage() {
  const { user } = useAuth();
  const roles = useMemo(() => user?.roles ?? [], [user?.roles]);
  const allowed = hasAnyRole(roles, CLASS_TEACHER_ROLES);
  const canSelectClassroom = hasAnyRole(roles, LEADERSHIP_VIEWER_ROLES);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [board, setBoard] = useState<ClassroomWeeklyTimetableBoardPayload | null>(null);
  const [classroomOptions, setClassroomOptions] = useState<LookupClassroom[]>([]);
  const [selectedClassroomId, setSelectedClassroomId] = useState("");
  const [teacherClassroomId, setTeacherClassroomId] = useState("");

  useEffect(() => {
    if (!allowed) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function bootstrap() {
      setLoading(true);
      setError("");
      try {
        const [classrooms, myClassroom] = await Promise.all([
          canSelectClassroom ? getLookupClassrooms({ page_size: 100 }).catch(() => []) : Promise.resolve([]),
          getClassTeacherMyClassroom().catch(() => null),
        ]);

        if (cancelled) return;

        setClassroomOptions(classrooms);
        const ownClassroomId = myClassroom?.classroom?.id || "";
        setTeacherClassroomId(ownClassroomId);

        if (canSelectClassroom) {
          const nextClassroomId = ownClassroomId || classrooms[0]?.id || "";
          setSelectedClassroomId((current) => current || nextClassroomId);
        } else {
          setSelectedClassroomId(ownClassroomId);
        }
      } catch (err: unknown) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load timetable workspace");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    bootstrap();
    return () => {
      cancelled = true;
    };
  }, [allowed, canSelectClassroom]);

  useEffect(() => {
    if (!allowed || !selectedClassroomId) return;

    let cancelled = false;

    async function loadBoard() {
      setLoading(true);
      setError("");
      try {
        const nextBoard = await getClassTeacherTimetableBoard({
          classroom_id: canSelectClassroom ? selectedClassroomId : undefined,
        });
        if (!cancelled) setBoard(nextBoard);
      } catch (err: unknown) {
        if (!cancelled) {
          setBoard(null);
          setError(err instanceof Error ? err.message : "Failed to load classroom timetable");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadBoard();
    return () => {
      cancelled = true;
    };
  }, [allowed, canSelectClassroom, selectedClassroomId]);

  const canEditBoard = useMemo(() => {
    if (!allowed) return false;
    if (roles.includes("teacher")) {
      return Boolean(!canSelectClassroom || selectedClassroomId === teacherClassroomId);
    }
    return true;
  }, [allowed, roles, canSelectClassroom, selectedClassroomId, teacherClassroomId]);

  async function withBoardUpdate(task: () => Promise<ClassroomWeeklyTimetableBoardPayload>) {
    setSaving(true);
    setError("");
    try {
      const nextBoard = await task();
      setBoard(nextBoard);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Unable to update timetable");
    } finally {
      setSaving(false);
    }
  }

  if (!allowed) {
    return (
      <>
        <Header title="Class Teacher Timetable" />
        <div className="p-6">
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-900">Access restricted</h2>
            <p className="mt-2 text-sm text-slate-600">
              This timetable workspace is available for class teachers and leadership roles only.
            </p>
          </section>
        </div>
      </>
    );
  }

  return (
    <>
      <Header title="Class Teacher Timetable" />
      <div className="space-y-6 p-6">
        {error ? (
          <div className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{error}</div>
        ) : null}

        <section className="rounded-[32px] bg-gradient-to-r from-[#2447f9] via-[#5b21b6] to-[#e11d8a] p-8 text-white shadow-2xl shadow-violet-950/20">
          <div className="grid gap-6 xl:grid-cols-[1.35fr_0.95fr]">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-white/70">Class teacher domain</p>
              <h1 className="mt-3 text-4xl font-bold tracking-tight">Weekly timetable board</h1>
              <p className="mt-3 max-w-3xl text-sm text-white/85">
                Edit one classroom timetable in a clean weekly grid. The same board becomes visible to students, parents,
                headmistress, and principal for the same class.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-slate-950">
              <div className="rounded-3xl bg-white px-4 py-4 shadow-lg shadow-slate-950/10">
                <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Rows</p>
                <p className="mt-2 text-3xl font-bold text-slate-950">{board?.rows.length || 0}</p>
                <p className="mt-1 text-xs text-slate-500">Teaching days or custom lines</p>
              </div>
              <div className="rounded-3xl bg-white px-4 py-4 shadow-lg shadow-slate-950/10">
                <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Slots</p>
                <p className="mt-2 text-3xl font-bold text-slate-950">{board?.columns.length || 0}</p>
                <p className="mt-1 text-xs text-slate-500">Periods or custom time blocks</p>
              </div>
              <div className="rounded-3xl bg-white px-4 py-4 shadow-lg shadow-slate-950/10">
                <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Editable</p>
                <p className="mt-2 text-3xl font-bold text-slate-950">{canEditBoard ? "Yes" : "View"}</p>
                <p className="mt-1 text-xs text-slate-500">Teachers edit only their own classroom board</p>
              </div>
              <div className="rounded-3xl bg-white px-4 py-4 shadow-lg shadow-slate-950/10">
                <p className="text-xs uppercase tracking-[0.25em] text-slate-500">Subjects</p>
                <p className="mt-2 text-3xl font-bold text-slate-950">{board?.available_subjects.length || 0}</p>
                <p className="mt-1 text-xs text-slate-500">Pulled from active classroom subject mapping</p>
              </div>
            </div>
          </div>
        </section>

        {canSelectClassroom ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <label className="label-text">Select classroom</label>
            <select
              className="input-field mt-2 max-w-md"
              value={selectedClassroomId}
              onChange={(e) => setSelectedClassroomId(e.target.value)}
            >
              {classroomOptions.map((classroom) => (
                <option key={classroom.id} value={classroom.id}>
                  {classroom.label}
                </option>
              ))}
            </select>
          </section>
        ) : null}

        {loading ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="h-96 animate-pulse rounded-2xl bg-slate-100" />
          </section>
        ) : board ? (
          <ClassroomWeeklyTimetableBoard
            board={board}
            editable={canEditBoard}
            busy={saving}
            title="Class teacher weekly grid"
            subtitle="Click a cell to edit the subject, teacher, room, and notes. Add rows or time slots when your classroom needs them."
            onAddRow={
              canEditBoard
                ? async (payload) =>
                    withBoardUpdate(() =>
                      createClassTeacherTimetableRow({
                        classroom_id: selectedClassroomId || null,
                        label: payload.label,
                        day_of_week: payload.day_of_week ?? null,
                      })
                    )
                : undefined
            }
            onAddColumn={
              canEditBoard
                ? async (payload) =>
                    withBoardUpdate(() =>
                      createClassTeacherTimetableColumn({
                        classroom_id: selectedClassroomId || null,
                        label: payload.label,
                        starts_at: payload.starts_at ?? null,
                        ends_at: payload.ends_at ?? null,
                      })
                    )
                : undefined
            }
            onSaveCell={
              canEditBoard
                ? async (cellId, payload) =>
                    withBoardUpdate(() =>
                      updateClassTeacherTimetableCell(cellId, {
                        classroom_id: selectedClassroomId || null,
                        subject_id: payload.subject_id || null,
                        teacher_id: payload.teacher_id || null,
                        title: payload.title || null,
                        subtitle: payload.subtitle || null,
                        room_number: payload.room_number || null,
                        notes: payload.notes || null,
                        color_hex: payload.color_hex || null,
                      })
                    )
                : undefined
            }
          />
        ) : (
          <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold text-slate-900">No timetable board yet</h2>
            <p className="mt-2 text-sm text-slate-600">
              Assign a classroom and active subjects first, then the weekly board will be created automatically.
            </p>
          </section>
        )}
      </div>
    </>
  );
}
