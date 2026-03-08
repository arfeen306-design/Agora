"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

import Header from "@/components/Header";
import {
  ApiError,
  createDelegation,
  getDelegations,
  getLookupClassrooms,
  getLookupSections,
  getLookupStaff,
  getRbacTemplates,
  revokeDelegation,
  RoleTemplate,
  updateRbacTemplate,
} from "@/lib/api";

type EditablePermission = {
  code: string;
  module: string;
  description: string;
  scope_level: "school" | "section" | "classroom";
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
};

function extractErrorMessage(err: unknown, fallback: string) {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return fallback;
}

export default function AccessControlPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [creatingDelegation, setCreatingDelegation] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [templates, setTemplates] = useState<RoleTemplate[]>([]);
  const [delegations, setDelegations] = useState<any[]>([]);
  const [staffOptions, setStaffOptions] = useState<Array<{ user_id: string; label: string; email: string }>>([]);
  const [sectionOptions, setSectionOptions] = useState<Array<{ id: string; label: string }>>([]);
  const [classroomOptions, setClassroomOptions] = useState<Array<{ id: string; label: string }>>([]);

  const [selectedRole, setSelectedRole] = useState<string>("");
  const [editablePermissions, setEditablePermissions] = useState<EditablePermission[]>([]);

  const [delegationForm, setDelegationForm] = useState({
    granted_to_user_id: "",
    permission_code: "",
    scope_type: "school",
    scope_id: "",
    grant_reason: "",
  });

  const permissionCatalog = useMemo(() => {
    const map = new Map<string, { code: string; module: string; description: string }>();
    for (const role of templates) {
      for (const permission of role.permissions) {
        if (!map.has(permission.code)) {
          map.set(permission.code, {
            code: permission.code,
            module: permission.module,
            description: permission.description,
          });
        }
      }
    }
    return Array.from(map.values()).sort((a, b) => `${a.module}.${a.code}`.localeCompare(`${b.module}.${b.code}`));
  }, [templates]);

  async function loadData() {
    setLoading(true);
    setError("");

    try {
      const [templateData, delegationRes, staffData, sectionData, classroomData] = await Promise.all([
        getRbacTemplates(),
        getDelegations({ page_size: "80", active_only: "true" }),
        getLookupStaff({ page_size: 200 }),
        getLookupSections({ page_size: 200 }),
        getLookupClassrooms({ page_size: 200 }),
      ]);

      setTemplates(templateData);
      setDelegations(delegationRes.data);
      setStaffOptions(staffData.map((row) => ({ user_id: row.user_id, label: row.label, email: row.email })));
      setSectionOptions(sectionData);
      setClassroomOptions(classroomData.map((row) => ({ id: row.id, label: row.label })));

      const firstRole = templateData.find((row) => row.code !== "super_admin")?.code || templateData[0]?.code || "";
      setSelectedRole((prev) => prev || firstRole);
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to load access control data"));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!selectedRole) return;
    const role = templates.find((row) => row.code === selectedRole);
    if (!role) return;

    const base = new Map<string, EditablePermission>();

    for (const permission of permissionCatalog) {
      base.set(permission.code, {
        code: permission.code,
        module: permission.module,
        description: permission.description,
        scope_level: "school",
        can_view: false,
        can_create: false,
        can_edit: false,
        can_delete: false,
      });
    }

    for (const permission of role.permissions) {
      base.set(permission.code, {
        code: permission.code,
        module: permission.module,
        description: permission.description,
        scope_level: (permission.scope_level as "school" | "section" | "classroom") || "school",
        can_view: permission.can_view,
        can_create: permission.can_create,
        can_edit: permission.can_edit,
        can_delete: permission.can_delete,
      });
    }

    setEditablePermissions(Array.from(base.values()));
  }, [selectedRole, templates, permissionCatalog]);

  async function handleSaveTemplate(e: FormEvent) {
    e.preventDefault();
    if (!selectedRole) return;
    setSaving(true);
    setError("");
    setNotice("");

    try {
      await updateRbacTemplate(selectedRole, {
        permissions: editablePermissions
          .filter((row) => row.can_view || row.can_create || row.can_edit || row.can_delete)
          .map((row) => ({
            code: row.code,
            scope_level: row.scope_level,
            can_view: row.can_view,
            can_create: row.can_create,
            can_edit: row.can_edit,
            can_delete: row.can_delete,
          })),
      });

      await loadData();
      setNotice(`Template updated for ${selectedRole}.`);
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to update template"));
    } finally {
      setSaving(false);
    }
  }

  async function handleCreateDelegation(e: FormEvent) {
    e.preventDefault();
    setCreatingDelegation(true);
    setError("");
    setNotice("");

    try {
      await createDelegation({
        granted_to_user_id: delegationForm.granted_to_user_id,
        permission_code: delegationForm.permission_code,
        scope_type: delegationForm.scope_type as "school" | "section" | "classroom",
        scope_id: delegationForm.scope_type === "school" ? undefined : delegationForm.scope_id || undefined,
        grant_reason: delegationForm.grant_reason || undefined,
      });

      setDelegationForm({
        granted_to_user_id: "",
        permission_code: "",
        scope_type: "school",
        scope_id: "",
        grant_reason: "",
      });
      await loadData();
      setNotice("Delegation granted.");
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to create delegation"));
    } finally {
      setCreatingDelegation(false);
    }
  }

  async function handleRevoke(id: string) {
    setError("");
    setNotice("");

    try {
      await revokeDelegation(id);
      await loadData();
      setNotice("Delegation revoked.");
    } catch (err: unknown) {
      setError(extractErrorMessage(err, "Failed to revoke delegation"));
    }
  }

  return (
    <>
      <Header title="Access Control" />
      <div className="p-6 space-y-6">
        <section className="rounded-2xl bg-gradient-to-r from-violet-700 via-indigo-700 to-blue-700 text-white p-6 shadow-lg">
          <p className="text-indigo-100 text-sm font-semibold uppercase tracking-wider">Security Layer</p>
          <h2 className="text-2xl lg:text-3xl font-bold">Role Templates and Delegation Engine</h2>
          <p className="mt-2 text-indigo-100 max-w-2xl">
            Configure role permissions, assign scoped authority, and keep institutional governance auditable.
          </p>
        </section>

        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        {notice && <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">{notice}</div>}

        {loading ? (
          <div className="rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">Loading access control data...</div>
        ) : (
          <>
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm xl:col-span-1">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Role Templates</h3>
                <div className="space-y-3">
                  {templates.map((role) => (
                    <button
                      type="button"
                      key={role.code}
                      onClick={() => setSelectedRole(role.code)}
                      className={`w-full text-left rounded-xl border px-4 py-3 transition ${
                        selectedRole === role.code
                          ? "border-indigo-300 bg-indigo-50"
                          : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                      }`}
                    >
                      <p className="font-semibold text-gray-900 capitalize">{role.code.replaceAll("_", " ")}</p>
                      <p className="text-xs text-gray-500">{role.assigned_users} user(s) assigned</p>
                      <p className="mt-1 text-xs text-indigo-600">{role.permissions.length} permission rows</p>
                    </button>
                  ))}
                </div>
              </div>

              <form onSubmit={handleSaveTemplate} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm xl:col-span-2">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900">Template Editor</h3>
                  <button className="btn-primary" type="submit" disabled={saving || !selectedRole}>
                    {saving ? "Saving..." : "Save Template"}
                  </button>
                </div>
                <div className="overflow-x-auto max-h-[460px]">
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 bg-white border-b border-gray-200">
                      <tr className="text-left text-gray-500">
                        <th className="py-2 pr-3">Permission</th>
                        <th className="py-2 pr-3">Scope</th>
                        <th className="py-2 pr-3">View</th>
                        <th className="py-2 pr-3">Create</th>
                        <th className="py-2 pr-3">Edit</th>
                        <th className="py-2">Delete</th>
                      </tr>
                    </thead>
                    <tbody>
                      {editablePermissions.map((permission, idx) => (
                        <tr key={permission.code} className="border-b border-gray-100">
                          <td className="py-2 pr-3">
                            <p className="font-medium text-gray-900">{permission.code}</p>
                            <p className="text-xs text-gray-500">{permission.description}</p>
                          </td>
                          <td className="py-2 pr-3">
                            <select
                              className="input-field"
                              value={permission.scope_level}
                              onChange={(e) => {
                                const next = [...editablePermissions];
                                next[idx] = {
                                  ...permission,
                                  scope_level: e.target.value as "school" | "section" | "classroom",
                                };
                                setEditablePermissions(next);
                              }}
                            >
                              <option value="school">school</option>
                              <option value="section">section</option>
                              <option value="classroom">classroom</option>
                            </select>
                          </td>
                          {(["can_view", "can_create", "can_edit", "can_delete"] as const).map((field) => (
                            <td key={field} className="py-2 pr-3">
                              <input
                                type="checkbox"
                                checked={Boolean(permission[field])}
                                onChange={(e) => {
                                  const next = [...editablePermissions];
                                  next[idx] = {
                                    ...permission,
                                    [field]: e.target.checked,
                                  };
                                  setEditablePermissions(next);
                                }}
                              />
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </form>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              <form onSubmit={handleCreateDelegation} className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm xl:col-span-1 space-y-4">
                <h3 className="text-lg font-semibold text-gray-900">Grant Delegation</h3>

                <Field label="Target Staff">
                  <select className="input-field" value={delegationForm.granted_to_user_id} onChange={(e) => setDelegationForm((p) => ({ ...p, granted_to_user_id: e.target.value }))} required>
                    <option value="">Select staff</option>
                    {staffOptions.map((staff) => (
                      <option key={staff.user_id} value={staff.user_id}>{staff.label} ({staff.email})</option>
                    ))}
                  </select>
                </Field>

                <Field label="Permission">
                  <select className="input-field" value={delegationForm.permission_code} onChange={(e) => setDelegationForm((p) => ({ ...p, permission_code: e.target.value }))} required>
                    <option value="">Select permission</option>
                    {permissionCatalog.map((permission) => (
                      <option key={permission.code} value={permission.code}>{permission.code}</option>
                    ))}
                  </select>
                </Field>

                <Field label="Scope Type">
                  <select className="input-field" value={delegationForm.scope_type} onChange={(e) => setDelegationForm((p) => ({ ...p, scope_type: e.target.value, scope_id: "" }))}>
                    <option value="school">School</option>
                    <option value="section">Section</option>
                    <option value="classroom">Classroom</option>
                  </select>
                </Field>

                {delegationForm.scope_type !== "school" && (
                  <Field label="Scope">
                    <select className="input-field" value={delegationForm.scope_id} onChange={(e) => setDelegationForm((p) => ({ ...p, scope_id: e.target.value }))} required>
                      <option value="">Select scope</option>
                      {delegationForm.scope_type === "section"
                        ? sectionOptions.map((section) => (
                            <option key={section.id} value={section.id}>{section.label}</option>
                          ))
                        : classroomOptions.map((room) => (
                            <option key={room.id} value={room.id}>{room.label}</option>
                          ))}
                    </select>
                  </Field>
                )}

                <Field label="Reason">
                  <input className="input-field" value={delegationForm.grant_reason} onChange={(e) => setDelegationForm((p) => ({ ...p, grant_reason: e.target.value }))} placeholder="Operational delegation note" />
                </Field>

                <button className="btn-primary w-full" type="submit" disabled={creatingDelegation}>
                  {creatingDelegation ? "Granting..." : "Grant Delegation"}
                </button>
              </form>

              <div className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm xl:col-span-2">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Active Delegations</h3>
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-left text-gray-500">
                        <th className="py-2 pr-3">Permission</th>
                        <th className="py-2 pr-3">Target</th>
                        <th className="py-2 pr-3">Scope</th>
                        <th className="py-2 pr-3">Granted By</th>
                        <th className="py-2 pr-3">Reason</th>
                        <th className="py-2">Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {delegations.map((row) => (
                        <tr key={row.id} className="border-b border-gray-100 last:border-0">
                          <td className="py-2 pr-3">
                            <p className="font-medium text-gray-900">{row.permission_code}</p>
                            <p className="text-xs text-gray-500 capitalize">{row.permission_module}</p>
                          </td>
                          <td className="py-2 pr-3">{[row.granted_to_first_name, row.granted_to_last_name].filter(Boolean).join(" ")}</td>
                          <td className="py-2 pr-3 capitalize">{row.scope_type}{row.scope_id ? ` (${row.scope_id.slice(0, 8)}...)` : ""}</td>
                          <td className="py-2 pr-3">{[row.granted_by_first_name, row.granted_by_last_name].filter(Boolean).join(" ")}</td>
                          <td className="py-2 pr-3">{row.grant_reason || "-"}</td>
                          <td className="py-2">
                            <button className="btn-secondary" type="button" onClick={() => handleRevoke(row.id)}>
                              Revoke
                            </button>
                          </td>
                        </tr>
                      ))}
                      {delegations.length === 0 && (
                        <tr>
                          <td colSpan={6} className="py-6 text-center text-gray-500">No active delegations found.</td>
                        </tr>
                      )}
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
