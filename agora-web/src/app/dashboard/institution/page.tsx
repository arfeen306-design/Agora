"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import Header from "@/components/Header";
import {
  ApiError,
  createInstitutionClassroom,
  createInstitutionSection,
  getInstitutionClassrooms,
  getInstitutionProfile,
  getInstitutionSections,
  getLookupAcademicYears,
  getLookupSections,
  getLookupStaff,
  InstitutionClassroom,
  InstitutionProfile,
  InstitutionSection,
  updateInstitutionProfile,
} from "@/lib/api";

type StaffLookupRow = {
  id: string;
  user_id: string;
  staff_type: string;
  label: string;
  email: string;
  roles?: string[];
};

type AcademicYearLookup = {
  id: string;
  name: string;
  is_current: boolean;
  label: string;
};

function extractErrorMessage(err: unknown, fallback: string) {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

export default function InstitutionPage() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [profile, setProfile] = useState<InstitutionProfile | null>(null);
  const [sections, setSections] = useState<InstitutionSection[]>([]);
  const [classrooms, setClassrooms] = useState<InstitutionClassroom[]>([]);

  const [staffOptions, setStaffOptions] = useState<StaffLookupRow[]>([]);
  const [sectionOptions, setSectionOptions] = useState<Array<{ id: string; label: string }>>([]);
  const [yearOptions, setYearOptions] = useState<AcademicYearLookup[]>([]);

  const [savingProfile, setSavingProfile] = useState(false);
  const [creatingSection, setCreatingSection] = useState(false);
  const [creatingClassroom, setCreatingClassroom] = useState(false);

  const [profileForm, setProfileForm] = useState({
    name: "",
    branch_name: "",
    contact_phone: "",
    contact_email: "",
    academic_year_label: "",
    late_arrival_cutoff: "",
    address_line: "",
  });

  const [sectionForm, setSectionForm] = useState({
    name: "",
    code: "",
    section_type: "middle",
    head_user_id: "",
  });

  const [classroomForm, setClassroomForm] = useState({
    academic_year_id: "",
    grade_label: "",
    section_label: "",
    section_id: "",
    classroom_code: "",
    room_number: "",
    homeroom_teacher_user_id: "",
    capacity: "",
  });

  async function loadData() {
    setLoading(true);
    setError("");

    try {
      const [profileData, sectionRes, classroomRes, staffData, sectionLookup, yearLookup] = await Promise.all([
        getInstitutionProfile(),
        getInstitutionSections({ page_size: "80" }),
        getInstitutionClassrooms({ page_size: "120" }),
        getLookupStaff({ page_size: 200 }),
        getLookupSections({ page_size: 200 }),
        getLookupAcademicYears({ page_size: 30 }),
      ]);

      const sectionsData = sectionRes.data;
      const classroomsData = classroomRes.data;

      setProfile(profileData);
      setSections(sectionsData);
      setClassrooms(classroomsData);
      setStaffOptions(staffData as StaffLookupRow[]);
      setSectionOptions(sectionLookup);
      setYearOptions(yearLookup as AcademicYearLookup[]);

      setProfileForm({
        name: profileData.name || "",
        branch_name: profileData.branch_name || "",
        contact_phone: profileData.contact_phone || "",
        contact_email: profileData.contact_email || "",
        academic_year_label: profileData.academic_year_label || "",
        late_arrival_cutoff: profileData.late_arrival_cutoff || "",
        address_line: profileData.address_line || "",
      });

      setClassroomForm((prev) => ({
        ...prev,
        academic_year_id: prev.academic_year_id || yearLookup.find((row) => row.is_current)?.id || yearLookup[0]?.id || "",
      }));
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to load institution data"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  const leadershipOptions = useMemo(
    () =>
      staffOptions.filter((staff) => {
        const roles = staff.roles || [];
        return (
          roles.includes("headmistress") ||
          roles.includes("principal") ||
          roles.includes("vice_principal") ||
          roles.includes("teacher")
        );
      }),
    [staffOptions]
  );

  const teacherOptions = useMemo(
    () => staffOptions.filter((staff) => (staff.roles || []).includes("teacher") || staff.staff_type === "teacher"),
    [staffOptions]
  );

  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault();
    setSavingProfile(true);
    setError("");
    setNotice("");

    try {
      const updated = await updateInstitutionProfile({
        name: profileForm.name,
        branch_name: profileForm.branch_name,
        contact_phone: profileForm.contact_phone,
        contact_email: profileForm.contact_email,
        academic_year_label: profileForm.academic_year_label,
        late_arrival_cutoff: profileForm.late_arrival_cutoff || null,
        address_line: profileForm.address_line,
      });
      setProfile(updated);
      setNotice("Institution profile updated.");
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to save institution profile"));
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleCreateSection(e: FormEvent) {
    e.preventDefault();
    setCreatingSection(true);
    setError("");
    setNotice("");

    try {
      await createInstitutionSection({
        name: sectionForm.name,
        code: sectionForm.code,
        section_type: sectionForm.section_type as
          | "pre_school"
          | "junior"
          | "middle"
          | "senior"
          | "high_school"
          | "general",
        head_user_id: sectionForm.head_user_id || null,
      });

      setSectionForm({
        name: "",
        code: "",
        section_type: "middle",
        head_user_id: "",
      });

      await loadData();
      setNotice("Section created.");
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to create section"));
    } finally {
      setCreatingSection(false);
    }
  }

  async function handleCreateClassroom(e: FormEvent) {
    e.preventDefault();
    setCreatingClassroom(true);
    setError("");
    setNotice("");

    try {
      await createInstitutionClassroom({
        academic_year_id: classroomForm.academic_year_id,
        grade_label: classroomForm.grade_label,
        section_label: classroomForm.section_label,
        section_id: classroomForm.section_id || null,
        classroom_code: classroomForm.classroom_code || null,
        room_number: classroomForm.room_number || null,
        homeroom_teacher_user_id: classroomForm.homeroom_teacher_user_id || null,
        capacity: classroomForm.capacity ? Number(classroomForm.capacity) : null,
      });

      setClassroomForm((prev) => ({
        ...prev,
        grade_label: "",
        section_label: "",
        section_id: "",
        classroom_code: "",
        room_number: "",
        homeroom_teacher_user_id: "",
        capacity: "",
      }));

      await loadData();
      setNotice("Classroom created.");
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to create classroom"));
    } finally {
      setCreatingClassroom(false);
    }
  }

  return (
    <>
      <Header title="Institution Setup" />
      <div className="p-6 space-y-6">
        <section className="rounded-2xl bg-gradient-to-r from-cyan-600 via-blue-600 to-indigo-600 text-white p-6 shadow-lg">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-cyan-100 text-sm font-semibold uppercase tracking-wider">Agora ERP Layer</p>
              <h2 className="text-2xl lg:text-3xl font-bold">School Structure Management</h2>
              <p className="mt-2 text-cyan-100 max-w-2xl">
                Configure institutional structure, section ownership, and class allocation from one command center.
              </p>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 min-w-[280px]">
              <MetricCard label="Sections" value={profile?.active_sections ?? 0} />
              <MetricCard label="Classrooms" value={profile?.active_classrooms ?? 0} />
              <MetricCard label="Staff" value={profile?.active_staff ?? 0} />
              <MetricCard label="Students" value={profile?.active_students ?? 0} />
            </div>
          </div>
        </section>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

        {loading ? (
          <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">Loading institution setup...</div>
        ) : (
          <>
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              <form onSubmit={handleSaveProfile} className="xl:col-span-2 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-gray-900">School Profile</h3>
                  <button className="btn-primary" type="submit" disabled={savingProfile}>
                    {savingProfile ? "Saving..." : "Save Profile"}
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="School Name">
                    <input className="input-field" value={profileForm.name} onChange={(e) => setProfileForm((p) => ({ ...p, name: e.target.value }))} required />
                  </Field>
                  <Field label="Branch Name">
                    <input className="input-field" value={profileForm.branch_name} onChange={(e) => setProfileForm((p) => ({ ...p, branch_name: e.target.value }))} />
                  </Field>
                  <Field label="Contact Phone">
                    <input className="input-field" value={profileForm.contact_phone} onChange={(e) => setProfileForm((p) => ({ ...p, contact_phone: e.target.value }))} />
                  </Field>
                  <Field label="Contact Email">
                    <input className="input-field" type="email" value={profileForm.contact_email} onChange={(e) => setProfileForm((p) => ({ ...p, contact_email: e.target.value }))} />
                  </Field>
                  <Field label="Academic Year Label">
                    <input className="input-field" value={profileForm.academic_year_label} onChange={(e) => setProfileForm((p) => ({ ...p, academic_year_label: e.target.value }))} placeholder="e.g. 2025-2026" />
                  </Field>
                  <Field label="Late Cutoff (HH:MM)">
                    <input className="input-field" value={profileForm.late_arrival_cutoff} onChange={(e) => setProfileForm((p) => ({ ...p, late_arrival_cutoff: e.target.value }))} placeholder="08:05" />
                  </Field>
                </div>

                <Field label="Address">
                  <input className="input-field" value={profileForm.address_line} onChange={(e) => setProfileForm((p) => ({ ...p, address_line: e.target.value }))} />
                </Field>
              </form>

              <form onSubmit={handleCreateSection} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
                <h3 className="text-lg font-semibold text-gray-900">Create Section</h3>
                <Field label="Section Name">
                  <input className="input-field" value={sectionForm.name} onChange={(e) => setSectionForm((p) => ({ ...p, name: e.target.value }))} required />
                </Field>
                <Field label="Section Code">
                  <input className="input-field" value={sectionForm.code} onChange={(e) => setSectionForm((p) => ({ ...p, code: e.target.value.toUpperCase() }))} required />
                </Field>
                <Field label="Section Type">
                  <select className="input-field" value={sectionForm.section_type} onChange={(e) => setSectionForm((p) => ({ ...p, section_type: e.target.value }))}>
                    <option value="pre_school">Pre School</option>
                    <option value="junior">Junior</option>
                    <option value="middle">Middle</option>
                    <option value="senior">Senior</option>
                    <option value="high_school">High School</option>
                    <option value="general">General</option>
                  </select>
                </Field>
                <Field label="Head (Optional)">
                  <select className="input-field" value={sectionForm.head_user_id} onChange={(e) => setSectionForm((p) => ({ ...p, head_user_id: e.target.value }))}>
                    <option value="">Unassigned</option>
                    {leadershipOptions.map((staff) => (
                      <option key={staff.user_id} value={staff.user_id}>
                        {staff.label} ({staff.staff_type})
                      </option>
                    ))}
                  </select>
                </Field>
                <button className="btn-primary w-full" type="submit" disabled={creatingSection}>
                  {creatingSection ? "Creating..." : "Create Section"}
                </button>
              </form>
            </div>

            <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Sections Overview</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 text-left text-gray-500">
                      <th className="py-2 pr-3">Section</th>
                      <th className="py-2 pr-3">Type</th>
                      <th className="py-2 pr-3">Head</th>
                      <th className="py-2 pr-3">Classes</th>
                      <th className="py-2 pr-3">Students</th>
                      <th className="py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sections.map((section) => (
                      <tr key={section.id} className="border-b border-gray-100 last:border-0">
                        <td className="py-2 pr-3 font-medium text-gray-800">{section.name} <span className="text-xs text-gray-400">({section.code})</span></td>
                        <td className="py-2 pr-3 capitalize">{section.section_type.replaceAll("_", " ")}</td>
                        <td className="py-2 pr-3">{[section.head_first_name, section.head_last_name].filter(Boolean).join(" ") || "Unassigned"}</td>
                        <td className="py-2 pr-3">{section.class_count ?? 0}</td>
                        <td className="py-2 pr-3">{section.active_students ?? 0}</td>
                        <td className="py-2">
                          <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${section.is_active ? "bg-emerald-100 text-emerald-700" : "bg-gray-100 text-gray-600"}`}>
                            {section.is_active ? "Active" : "Inactive"}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              <form onSubmit={handleCreateClassroom} className="xl:col-span-1 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm space-y-4">
                <h3 className="text-lg font-semibold text-gray-900">Create Classroom</h3>

                <Field label="Academic Year">
                  <select className="input-field" value={classroomForm.academic_year_id} onChange={(e) => setClassroomForm((p) => ({ ...p, academic_year_id: e.target.value }))} required>
                    <option value="">Select year</option>
                    {yearOptions.map((year) => (
                      <option key={year.id} value={year.id}>{year.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Grade Label">
                  <input className="input-field" value={classroomForm.grade_label} onChange={(e) => setClassroomForm((p) => ({ ...p, grade_label: e.target.value }))} placeholder="Grade 7" required />
                </Field>
                <Field label="Section Label">
                  <input className="input-field" value={classroomForm.section_label} onChange={(e) => setClassroomForm((p) => ({ ...p, section_label: e.target.value }))} placeholder="A" required />
                </Field>
                <Field label="Section Mapping">
                  <select className="input-field" value={classroomForm.section_id} onChange={(e) => setClassroomForm((p) => ({ ...p, section_id: e.target.value }))}>
                    <option value="">No section mapping</option>
                    {sectionOptions.map((section) => (
                      <option key={section.id} value={section.id}>{section.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Classroom Code">
                  <input className="input-field" value={classroomForm.classroom_code} onChange={(e) => setClassroomForm((p) => ({ ...p, classroom_code: e.target.value }))} placeholder="G7-A" />
                </Field>
                <Field label="Room Number">
                  <input className="input-field" value={classroomForm.room_number} onChange={(e) => setClassroomForm((p) => ({ ...p, room_number: e.target.value }))} placeholder="201" />
                </Field>
                <Field label="Homeroom Teacher">
                  <select className="input-field" value={classroomForm.homeroom_teacher_user_id} onChange={(e) => setClassroomForm((p) => ({ ...p, homeroom_teacher_user_id: e.target.value }))}>
                    <option value="">Unassigned</option>
                    {teacherOptions.map((staff) => (
                      <option key={staff.user_id} value={staff.user_id}>{staff.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Capacity">
                  <input className="input-field" type="number" min={1} max={200} value={classroomForm.capacity} onChange={(e) => setClassroomForm((p) => ({ ...p, capacity: e.target.value }))} />
                </Field>

                <button className="btn-primary w-full" type="submit" disabled={creatingClassroom}>
                  {creatingClassroom ? "Creating..." : "Create Classroom"}
                </button>
              </form>

              <div className="xl:col-span-2 rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Classroom Allocation</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-left text-gray-500">
                        <th className="py-2 pr-3">Classroom</th>
                        <th className="py-2 pr-3">Section</th>
                        <th className="py-2 pr-3">Homeroom</th>
                        <th className="py-2 pr-3">Room</th>
                        <th className="py-2 pr-3">Capacity</th>
                        <th className="py-2">Students</th>
                      </tr>
                    </thead>
                    <tbody>
                      {classrooms.map((room) => (
                        <tr key={room.id} className="border-b border-gray-100 last:border-0">
                          <td className="py-2 pr-3 font-medium text-gray-800">
                            {room.grade_label} - {room.section_label}
                            <span className="ml-1 text-xs text-gray-400">{room.classroom_code ? `(${room.classroom_code})` : ""}</span>
                          </td>
                          <td className="py-2 pr-3">{room.section_name || "Unassigned"}</td>
                          <td className="py-2 pr-3">
                            {[room.homeroom_teacher_first_name, room.homeroom_teacher_last_name].filter(Boolean).join(" ") || "Unassigned"}
                          </td>
                          <td className="py-2 pr-3">{room.room_number || "-"}</td>
                          <td className="py-2 pr-3">{room.capacity || "-"}</td>
                          <td className="py-2 font-semibold text-primary-700">{room.active_student_count ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="label-text">{label}</span>
      {children}
    </label>
  );
}

function MetricCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-white/15 backdrop-blur px-3 py-2 border border-white/20">
      <p className="text-xs text-cyan-100">{label}</p>
      <p className="text-lg font-semibold text-white">{value}</p>
    </div>
  );
}
