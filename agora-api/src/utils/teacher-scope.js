const pool = require("../db");
const AppError = require("./app-error");
const { ensureTeacherProjectionForUser } = require("./teacher-projection");

async function getTeacherIdentityByUser({
  schoolId,
  userId,
  client = null,
}) {
  if (!schoolId || !userId) {
    return {
      teacherId: null,
      staffProfileId: null,
      isActive: false,
    };
  }

  const db = client || pool;

  const teacherProjection = await ensureTeacherProjectionForUser({
    schoolId,
    userId,
    roles: ["teacher"],
    client: db,
  });

  let staffProfile = null;
  try {
    const profileResult = await db.query(
      `
        SELECT
          sp.id,
          sp.staff_type,
          sp.employment_status
        FROM staff_profiles sp
        WHERE sp.school_id = $1
          AND sp.user_id = $2
        LIMIT 1
      `,
      [schoolId, userId]
    );
    staffProfile = profileResult.rows[0] || null;
  } catch (error) {
    // Backward compatibility where staff_profiles does not exist yet.
    if (error?.code !== "42P01") {
      throw error;
    }
  }

  const isActiveStaff =
    !staffProfile ||
    (staffProfile.staff_type === "teacher" && staffProfile.employment_status === "active");

  return {
    teacherId: teacherProjection?.id || null,
    staffProfileId: staffProfile?.id || null,
    isActive: Boolean(teacherProjection?.id) && Boolean(isActiveStaff),
  };
}

async function listTeacherClassroomIds({
  schoolId,
  userId,
  client = null,
}) {
  if (!schoolId || !userId) return [];
  const db = client || pool;

  const teacherIdentity = await getTeacherIdentityByUser({
    schoolId,
    userId,
    client: db,
  });
  if (!teacherIdentity.teacherId && !teacherIdentity.staffProfileId) {
    return [];
  }
  if (!teacherIdentity.isActive) {
    return [];
  }

  const params = [schoolId, userId];
  const whereTeacher = teacherIdentity.teacherId
    ? `
      OR EXISTS (
        SELECT 1
        FROM teachers t
        WHERE t.id = c.homeroom_teacher_id
          AND t.school_id = c.school_id
          AND t.id = $3
      )
      OR EXISTS (
        SELECT 1
        FROM classroom_subjects cs
        WHERE cs.school_id = c.school_id
          AND cs.classroom_id = c.id
          AND cs.teacher_id = $3
      )
    `
    : "";

  if (teacherIdentity.teacherId) {
    params.push(teacherIdentity.teacherId);
  }

  let result;
  try {
    result = await db.query(
      `
        SELECT DISTINCT c.id AS classroom_id
        FROM classrooms c
        WHERE c.school_id = $1
          AND (
            EXISTS (
              SELECT 1
              FROM staff_profiles sp
              JOIN staff_classroom_assignments sca
                ON sca.staff_profile_id = sp.id
               AND sca.school_id = c.school_id
               AND sca.classroom_id = c.id
               AND sca.is_active = TRUE
               AND sca.starts_on <= CURRENT_DATE
               AND (sca.ends_on IS NULL OR sca.ends_on >= CURRENT_DATE)
              WHERE sp.school_id = c.school_id
                AND sp.user_id = $2
                AND sp.staff_type = 'teacher'
                AND sp.employment_status = 'active'
            )
            ${whereTeacher}
          )
      `,
      params
    );
  } catch (error) {
    // Backward compatibility for environments that have not applied institution tables yet.
    if (error?.code !== "42P01") {
      throw error;
    }

    if (!teacherIdentity.teacherId) {
      return [];
    }

    result = await db.query(
      `
        SELECT DISTINCT c.id AS classroom_id
        FROM classrooms c
        WHERE c.school_id = $1
          AND (
            EXISTS (
              SELECT 1
              FROM classroom_subjects cs
              WHERE cs.school_id = c.school_id
                AND cs.classroom_id = c.id
                AND cs.teacher_id = $2
            )
            OR EXISTS (
              SELECT 1
              FROM teachers t
              WHERE t.id = c.homeroom_teacher_id
                AND t.school_id = c.school_id
                AND t.id = $2
            )
          )
      `,
      [schoolId, teacherIdentity.teacherId]
    );
  }

  return result.rows.map((row) => row.classroom_id);
}

async function teacherCanManageClassroom({
  schoolId,
  userId,
  classroomId,
  client = null,
}) {
  if (!schoolId || !userId || !classroomId) return false;
  const classroomIds = await listTeacherClassroomIds({
    schoolId,
    userId,
    client,
  });
  return classroomIds.includes(classroomId);
}

async function ensureTeacherCanManageClassroom({
  schoolId,
  userId,
  classroomId,
  client = null,
  message = "Teacher is not assigned to this classroom",
}) {
  const allowed = await teacherCanManageClassroom({
    schoolId,
    userId,
    classroomId,
    client,
  });
  if (!allowed) {
    throw new AppError(403, "FORBIDDEN", message);
  }
}

module.exports = {
  getTeacherIdentityByUser,
  listTeacherClassroomIds,
  teacherCanManageClassroom,
  ensureTeacherCanManageClassroom,
};
