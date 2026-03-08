"use client";

import Link from "next/link";

import type { AdmissionPipelineData, AdmissionPipelineStudent, AdmissionStatus } from "@/lib/api";

import AdmissionStatusPill from "./AdmissionStatusPill";
import { ADMISSION_STAGE_LABEL, ADMISSION_STAGE_ORDER } from "./admission-utils";

interface AdmissionsStageBoardProps {
  stages: AdmissionPipelineData["stages"];
  compact?: boolean;
}

export default function AdmissionsStageBoard({ stages, compact = false }: AdmissionsStageBoardProps) {
  return (
    <section className="grid grid-cols-1 gap-4 lg:grid-cols-2 2xl:grid-cols-4">
      {ADMISSION_STAGE_ORDER.map((stage) => {
        const bucket = stages?.[stage];
        const students = (bucket?.students || []).slice(0, compact ? 3 : 8);
        return (
          <article key={stage} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900">{ADMISSION_STAGE_LABEL[stage]}</h3>
              <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold text-gray-700">
                {bucket?.count || 0}
              </span>
            </div>

            <div className="mt-3 space-y-2">
              {students.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 px-3 py-3 text-xs text-gray-500">
                  No applicants in this stage.
                </div>
              ) : (
                students.map((student) => <StudentRow key={student.student_id} student={student} stage={stage} />)
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}

function StudentRow({ student, stage }: { student: AdmissionPipelineStudent; stage: AdmissionStatus }) {
  return (
    <Link
      href={`/dashboard/admissions/applicants/${student.student_id}`}
      className="block rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 transition hover:border-indigo-200 hover:bg-indigo-50"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-gray-900">
            {[student.first_name, student.last_name].filter(Boolean).join(" ")}
          </p>
          <p className="truncate text-xs text-gray-500">{student.student_code}</p>
          {(student.guardian_name || student.guardian_phone) && (
            <p className="mt-1 truncate text-xs text-gray-600">
              {student.guardian_name || "Guardian"} {student.guardian_phone ? `• ${student.guardian_phone}` : ""}
            </p>
          )}
        </div>
        <AdmissionStatusPill status={stage} />
      </div>
    </Link>
  );
}
