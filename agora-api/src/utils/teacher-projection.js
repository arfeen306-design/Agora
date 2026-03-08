const pool = require("../db");

function makeFallbackTeacherCode(userId) {
  const compact = String(userId || "")
    .replace(/-/g, "")
    .toUpperCase();
  const prefix = compact.slice(0, 12) || Date.now().toString(36).toUpperCase();
  return `TEA-${prefix}`;
}

/**
 * Ensure legacy `teachers` projection exists for teacher-role users.
 * Source of truth remains `staff_profiles`; this utility prevents route breakage
 * while older modules still reference `teachers`.
 */
async function ensureTeacherProjectionForUser({
  schoolId,
  userId,
  roles = [],
  client = null,
}) {
  if (!schoolId || !userId) return null;
  if (!Array.isArray(roles) || !roles.includes("teacher")) return null;

  const db = client || pool;

  const existing = await db.query(
    `
      SELECT id, user_id, employee_code, designation, joined_on
      FROM teachers
      WHERE school_id = $1
        AND user_id = $2
      LIMIT 1
    `,
    [schoolId, userId]
  );
  if (existing.rows[0]) {
    return existing.rows[0];
  }

  let source;
  try {
    source = await db.query(
      `
        SELECT
          u.id AS user_id,
          sp.staff_code,
          sp.designation,
          sp.joining_date
        FROM users u
        LEFT JOIN staff_profiles sp
          ON sp.school_id = u.school_id
         AND sp.user_id = u.id
        WHERE u.school_id = $1
          AND u.id = $2
        LIMIT 1
      `,
      [schoolId, userId]
    );
  } catch (error) {
    // Backward compatibility for environments where institution migration
    // hasn't introduced staff_profiles yet.
    if (error?.code === "42P01") {
      source = await db.query(
        `
          SELECT
            u.id AS user_id,
            NULL::text AS staff_code,
            NULL::text AS designation,
            NULL::date AS joining_date
          FROM users u
          WHERE u.school_id = $1
            AND u.id = $2
          LIMIT 1
        `,
        [schoolId, userId]
      );
    } else {
      throw error;
    }
  }

  const row = source.rows[0];
  if (!row?.user_id) return null;

  const employeeCode = row.staff_code || makeFallbackTeacherCode(userId);

  const inserted = await db.query(
    `
      INSERT INTO teachers (
        school_id,
        user_id,
        employee_code,
        designation,
        joined_on
      )
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id)
      DO UPDATE SET
        school_id = EXCLUDED.school_id,
        employee_code = EXCLUDED.employee_code,
        designation = EXCLUDED.designation,
        joined_on = EXCLUDED.joined_on,
        updated_at = NOW()
      RETURNING id, user_id, employee_code, designation, joined_on
    `,
    [schoolId, userId, employeeCode, row.designation || null, row.joining_date || null]
  );

  return inserted.rows[0] || null;
}

/**
 * Sync teacher projection from staff profile lifecycle updates.
 */
async function syncTeacherProjectionForStaffProfile(client, { schoolId, staffProfileId }) {
  const profileQuery = await client.query(
    `
      SELECT
        sp.id,
        sp.school_id,
        sp.user_id,
        sp.staff_code,
        sp.staff_type,
        sp.designation,
        sp.joining_date,
        EXISTS (
          SELECT 1
          FROM user_roles ur
          JOIN roles r ON r.id = ur.role_id
          WHERE ur.user_id = sp.user_id
            AND r.code = 'teacher'
        ) AS has_teacher_role
      FROM staff_profiles sp
      WHERE sp.school_id = $1
        AND sp.id = $2
      LIMIT 1
    `,
    [schoolId, staffProfileId]
  );

  const profile = profileQuery.rows[0];
  if (!profile) return null;
  if (!profile.has_teacher_role && profile.staff_type !== "teacher") return null;

  const inserted = await client.query(
    `
      INSERT INTO teachers (
        school_id,
        user_id,
        employee_code,
        designation,
        joined_on
      )
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (user_id)
      DO UPDATE SET
        school_id = EXCLUDED.school_id,
        employee_code = EXCLUDED.employee_code,
        designation = EXCLUDED.designation,
        joined_on = EXCLUDED.joined_on,
        updated_at = NOW()
      RETURNING id, user_id, employee_code, designation, joined_on
    `,
    [
      profile.school_id,
      profile.user_id,
      profile.staff_code || makeFallbackTeacherCode(profile.user_id),
      profile.designation || null,
      profile.joining_date || null,
    ]
  );

  return inserted.rows[0] || null;
}

module.exports = {
  ensureTeacherProjectionForUser,
  syncTeacherProjectionForStaffProfile,
};
