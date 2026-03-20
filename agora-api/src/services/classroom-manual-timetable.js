const pool = require("../db");
const AppError = require("../utils/app-error");

const DEFAULT_DAY_ROWS = [
  { day_of_week: 1, label: "Mon" },
  { day_of_week: 2, label: "Tue" },
  { day_of_week: 3, label: "Wed" },
  { day_of_week: 4, label: "Thu" },
  { day_of_week: 5, label: "Fri" },
];

const DAY_NAME_MAP = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
};

const COLOR_PALETTE = [
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

function dayName(dayOfWeek) {
  return DAY_NAME_MAP[dayOfWeek] || "Custom";
}

function formatTeacherName(row) {
  return [row.teacher_first_name, row.teacher_last_name].filter(Boolean).join(" ").trim();
}

function pickColor(index) {
  return COLOR_PALETTE[index % COLOR_PALETTE.length];
}

async function ensureClassroomExists(schoolId, classroomId) {
  const result = await pool.query(
    `
      SELECT
        c.id,
        c.school_id,
        c.academic_year_id,
        c.grade_label,
        c.section_label,
        COALESCE(c.classroom_code, CONCAT(c.grade_label, '-', c.section_label)) AS classroom_code,
        ay.name AS academic_year_name
      FROM classrooms c
      JOIN academic_years ay
        ON ay.id = c.academic_year_id
       AND ay.school_id = c.school_id
      WHERE c.school_id = $1
        AND c.id = $2
      LIMIT 1
    `,
    [schoolId, classroomId]
  );

  if (!result.rows[0]) {
    throw new AppError(404, "NOT_FOUND", "Classroom not found");
  }

  return result.rows[0];
}

async function listSeedPeriods(client, schoolId, academicYearId) {
  const periods = await client.query(
    `
      SELECT
        id,
        period_number,
        label,
        starts_at,
        ends_at
      FROM timetable_periods
      WHERE school_id = $1
        AND academic_year_id = $2
        AND is_active = TRUE
      ORDER BY period_number ASC
    `,
    [schoolId, academicYearId]
  );

  if (periods.rows.length > 0) {
    return periods.rows.map((row) => ({
      period_id: row.id,
      label: row.label || `Period ${row.period_number}`,
      starts_at: row.starts_at ? String(row.starts_at).slice(0, 5) : null,
      ends_at: row.ends_at ? String(row.ends_at).slice(0, 5) : null,
    }));
  }

  return Array.from({ length: 7 }).map((_, index) => ({
    period_id: null,
    label: `Period ${index + 1}`,
    starts_at: null,
    ends_at: null,
  }));
}

async function listSeedDays(client, schoolId, academicYearId) {
  const days = await client.query(
    `
      SELECT DISTINCT ts.day_of_week
      FROM timetable_slots ts
      WHERE ts.school_id = $1
        AND ts.academic_year_id = $2
        AND ts.is_active = TRUE
      ORDER BY ts.day_of_week ASC
    `,
    [schoolId, academicYearId]
  );

  if (days.rows.length > 0) {
    return days.rows.map((row) => ({
      day_of_week: Number(row.day_of_week),
      label: dayName(Number(row.day_of_week)).slice(0, 3),
    }));
  }

  return DEFAULT_DAY_ROWS;
}

async function listSeedEntries(client, schoolId, classroomId, academicYearId) {
  const entries = await client.query(
    `
      SELECT
        te.subject_id,
        te.teacher_id,
        te.room_number,
        te.notes,
        ts.day_of_week,
        ts.period_id,
        tp.period_number,
        s.code AS subject_code,
        s.name AS subject_name,
        u.first_name AS teacher_first_name,
        u.last_name AS teacher_last_name
      FROM timetable_entries te
      JOIN timetable_slots ts
        ON ts.id = te.slot_id
       AND ts.school_id = te.school_id
       AND ts.academic_year_id = te.academic_year_id
      JOIN timetable_periods tp
        ON tp.id = ts.period_id
       AND tp.school_id = ts.school_id
       AND tp.academic_year_id = ts.academic_year_id
      LEFT JOIN subjects s
        ON s.id = te.subject_id
       AND s.school_id = te.school_id
      LEFT JOIN teachers t
        ON t.id = te.teacher_id
       AND t.school_id = te.school_id
      LEFT JOIN users u
        ON u.id = t.user_id
       AND u.school_id = t.school_id
      WHERE te.school_id = $1
        AND te.classroom_id = $2
        AND te.academic_year_id = $3
        AND te.is_active = TRUE
      ORDER BY ts.day_of_week ASC, tp.period_number ASC
    `,
    [schoolId, classroomId, academicYearId]
  );

  return entries.rows;
}

async function listSeedLessons(client, schoolId, classroomId) {
  const lessons = await client.query(
    `
      SELECT
        cs.subject_id,
        cs.teacher_id,
        GREATEST(COALESCE(cs.periods_per_week, 0), 1) AS periods_per_week,
        s.code AS subject_code,
        s.name AS subject_name,
        u.first_name AS teacher_first_name,
        u.last_name AS teacher_last_name
      FROM classroom_subjects cs
      JOIN subjects s
        ON s.id = cs.subject_id
       AND s.school_id = cs.school_id
      LEFT JOIN teachers t
        ON t.id = cs.teacher_id
       AND t.school_id = cs.school_id
      LEFT JOIN users u
        ON u.id = t.user_id
       AND u.school_id = t.school_id
      WHERE cs.school_id = $1
        AND cs.classroom_id = $2
      ORDER BY s.name ASC
    `,
    [schoolId, classroomId]
  );

  return lessons.rows;
}

async function ensureCellsForBoard(client, boardId, rows, columns, seedEntries = [], seedLessons = []) {
  const seededBySlot = new Map();
  seedEntries.forEach((entry, index) => {
    const key = `${entry.day_of_week}:${entry.period_id || entry.period_number}`;
    seededBySlot.set(key, { ...entry, index });
  });

  const fallbackLessonQueue = [];
  seedLessons.forEach((lesson, index) => {
    const repeats = Number(lesson.periods_per_week || 0);
    for (let count = 0; count < repeats; count += 1) {
      fallbackLessonQueue.push({ ...lesson, index });
    }
  });

  let fallbackPointer = 0;

  for (const row of rows) {
    for (const column of columns) {
      const key = `${row.day_of_week || row.position}:${column.period_id || column.position}`;
      const seeded = seededBySlot.get(key) || fallbackLessonQueue[fallbackPointer] || null;
      if (!seededBySlot.has(key) && fallbackLessonQueue[fallbackPointer]) {
        fallbackPointer += 1;
      }

      const title = seeded?.subject_code || seeded?.subject_name || null;
      const subtitle = seeded ? formatTeacherName(seeded) || null : null;
      const colorHex = seeded ? pickColor(seeded.index || 0) : null;

      await client.query(
        `
          INSERT INTO classroom_weekly_timetable_cells (
            board_id,
            row_id,
            column_id,
            subject_id,
            teacher_id,
            title,
            subtitle,
            room_number,
            notes,
            color_hex
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          ON CONFLICT (board_id, row_id, column_id) DO NOTHING
        `,
        [
          boardId,
          row.id,
          column.id,
          seeded?.subject_id || null,
          seeded?.teacher_id || null,
          title,
          subtitle,
          seeded?.room_number || null,
          seeded?.notes || null,
          colorHex,
        ]
      );
    }
  }
}

async function fetchBoardPayload(schoolId, classroomId) {
  const classroom = await ensureClassroomExists(schoolId, classroomId);
  const boardResult = await pool.query(
    `
      SELECT id, classroom_id, academic_year_id, created_at, updated_at
      FROM classroom_weekly_timetable_boards
      WHERE school_id = $1
        AND classroom_id = $2
      LIMIT 1
    `,
    [schoolId, classroomId]
  );

  if (!boardResult.rows[0]) {
    return null;
  }

  const board = boardResult.rows[0];
  const [rowsResult, columnsResult, cellsResult, subjectResult] = await Promise.all([
    pool.query(
      `
        SELECT id, position, label, day_of_week, is_active
        FROM classroom_weekly_timetable_rows
        WHERE board_id = $1
          AND is_active = TRUE
        ORDER BY position ASC, created_at ASC
      `,
      [board.id]
    ),
    pool.query(
      `
        SELECT id, position, label, starts_at, ends_at, period_id, is_active
        FROM classroom_weekly_timetable_columns
        WHERE board_id = $1
          AND is_active = TRUE
        ORDER BY position ASC, created_at ASC
      `,
      [board.id]
    ),
    pool.query(
      `
        SELECT
          c.id,
          c.row_id,
          c.column_id,
          c.subject_id,
          c.teacher_id,
          c.title,
          c.subtitle,
          c.room_number,
          c.notes,
          c.color_hex,
          s.name AS subject_name,
          s.code AS subject_code,
          u.first_name AS teacher_first_name,
          u.last_name AS teacher_last_name
        FROM classroom_weekly_timetable_cells c
        LEFT JOIN subjects s
          ON s.id = c.subject_id
         AND s.school_id = $2
        LEFT JOIN teachers t
          ON t.id = c.teacher_id
         AND t.school_id = $2
        LEFT JOIN users u
          ON u.id = t.user_id
         AND u.school_id = $2
        WHERE c.board_id = $1
        ORDER BY c.created_at ASC
      `,
      [board.id, schoolId]
    ),
    pool.query(
      `
        SELECT
          cs.subject_id,
          cs.teacher_id,
          s.name AS subject_name,
          s.code AS subject_code,
          u.first_name AS teacher_first_name,
          u.last_name AS teacher_last_name
        FROM classroom_subjects cs
        JOIN subjects s
          ON s.id = cs.subject_id
         AND s.school_id = cs.school_id
        LEFT JOIN teachers t
          ON t.id = cs.teacher_id
         AND t.school_id = cs.school_id
        LEFT JOIN users u
          ON u.id = t.user_id
         AND u.school_id = t.school_id
        WHERE cs.school_id = $1
          AND cs.classroom_id = $2
        ORDER BY s.name ASC
      `,
      [schoolId, classroomId]
    ),
  ]);

  const teacherOptionMap = new Map();
  subjectResult.rows.forEach((row) => {
    if (row.teacher_id && !teacherOptionMap.has(row.teacher_id)) {
      teacherOptionMap.set(row.teacher_id, {
        id: row.teacher_id,
        label: formatTeacherName(row) || "Assigned teacher",
      });
    }
  });

  return {
    board_id: board.id,
    classroom: {
      id: classroom.id,
      academic_year_id: classroom.academic_year_id,
      academic_year_name: classroom.academic_year_name,
      grade_label: classroom.grade_label,
      section_label: classroom.section_label,
      classroom_code: classroom.classroom_code,
      label: `${classroom.grade_label} - ${classroom.section_label}`,
    },
    rows: rowsResult.rows.map((row) => ({
      ...row,
      day_name: row.day_of_week ? dayName(Number(row.day_of_week)) : row.label,
    })),
    columns: columnsResult.rows.map((row) => ({
      ...row,
      starts_at: row.starts_at ? String(row.starts_at).slice(0, 5) : null,
      ends_at: row.ends_at ? String(row.ends_at).slice(0, 5) : null,
    })),
    cells: cellsResult.rows.map((row) => ({
      ...row,
      teacher_name: formatTeacherName(row),
    })),
    available_subjects: subjectResult.rows.map((row) => ({
      id: row.subject_id,
      label: row.subject_code ? `${row.subject_name} (${row.subject_code})` : row.subject_name,
      subject_name: row.subject_name,
      subject_code: row.subject_code,
      teacher_id: row.teacher_id,
      teacher_name: formatTeacherName(row),
    })),
    available_teachers: Array.from(teacherOptionMap.values()),
  };
}

async function ensureBoard({ schoolId, classroomId, actorUserId = null }) {
  const existing = await fetchBoardPayload(schoolId, classroomId);
  if (existing) return existing;

  const classroom = await ensureClassroomExists(schoolId, classroomId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const boardInsert = await client.query(
      `
        INSERT INTO classroom_weekly_timetable_boards (
          school_id,
          academic_year_id,
          classroom_id,
          created_by_user_id,
          updated_by_user_id
        )
        VALUES ($1, $2, $3, $4, $4)
        RETURNING id
      `,
      [schoolId, classroom.academic_year_id, classroomId, actorUserId]
    );
    const boardId = boardInsert.rows[0].id;

    const [rowsSeed, columnsSeed, entrySeed, lessonSeed] = await Promise.all([
      listSeedDays(client, schoolId, classroom.academic_year_id),
      listSeedPeriods(client, schoolId, classroom.academic_year_id),
      listSeedEntries(client, schoolId, classroomId, classroom.academic_year_id),
      listSeedLessons(client, schoolId, classroomId),
    ]);

    const insertedRows = [];
    for (let index = 0; index < rowsSeed.length; index += 1) {
      const row = await client.query(
        `
          INSERT INTO classroom_weekly_timetable_rows (
            board_id,
            position,
            label,
            day_of_week
          )
          VALUES ($1, $2, $3, $4)
          RETURNING id, position, label, day_of_week
        `,
        [boardId, index + 1, rowsSeed[index].label, rowsSeed[index].day_of_week || null]
      );
      insertedRows.push(row.rows[0]);
    }

    const insertedColumns = [];
    for (let index = 0; index < columnsSeed.length; index += 1) {
      const column = await client.query(
        `
          INSERT INTO classroom_weekly_timetable_columns (
            board_id,
            position,
            label,
            starts_at,
            ends_at,
            period_id
          )
          VALUES ($1, $2, $3, $4, $5, $6)
          RETURNING id, position, label, starts_at, ends_at, period_id
        `,
        [
          boardId,
          index + 1,
          columnsSeed[index].label,
          columnsSeed[index].starts_at,
          columnsSeed[index].ends_at,
          columnsSeed[index].period_id,
        ]
      );
      insertedColumns.push(column.rows[0]);
    }

    await ensureCellsForBoard(client, boardId, insertedRows, insertedColumns, entrySeed, lessonSeed);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return fetchBoardPayload(schoolId, classroomId);
}

async function addBoardRow({ schoolId, classroomId, label, dayOfWeek = null, actorUserId = null }) {
  const board = await ensureBoard({ schoolId, classroomId, actorUserId });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const nextPositionResult = await client.query(
      `
        SELECT COALESCE(MAX(position), 0)::int + 1 AS next_position
        FROM classroom_weekly_timetable_rows
        WHERE board_id = $1
      `,
      [board.board_id]
    );
    const nextPosition = Number(nextPositionResult.rows[0]?.next_position || 1);

    const insertedRow = await client.query(
      `
        INSERT INTO classroom_weekly_timetable_rows (
          board_id,
          position,
          label,
          day_of_week
        )
        VALUES ($1, $2, $3, $4)
        RETURNING id, position, label, day_of_week
      `,
      [board.board_id, nextPosition, label, dayOfWeek]
    );

    const columns = await client.query(
      `
        SELECT id
        FROM classroom_weekly_timetable_columns
        WHERE board_id = $1
          AND is_active = TRUE
        ORDER BY position ASC
      `,
      [board.board_id]
    );

    await ensureCellsForBoard(client, board.board_id, insertedRow.rows, columns.rows);
    await client.query(
      `
        UPDATE classroom_weekly_timetable_boards
        SET updated_by_user_id = $2, updated_at = NOW()
        WHERE id = $1
      `,
      [board.board_id, actorUserId]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return fetchBoardPayload(schoolId, classroomId);
}

async function addBoardColumn({
  schoolId,
  classroomId,
  label,
  startsAt = null,
  endsAt = null,
  actorUserId = null,
}) {
  const board = await ensureBoard({ schoolId, classroomId, actorUserId });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const nextPositionResult = await client.query(
      `
        SELECT COALESCE(MAX(position), 0)::int + 1 AS next_position
        FROM classroom_weekly_timetable_columns
        WHERE board_id = $1
      `,
      [board.board_id]
    );
    const nextPosition = Number(nextPositionResult.rows[0]?.next_position || 1);

    const insertedColumn = await client.query(
      `
        INSERT INTO classroom_weekly_timetable_columns (
          board_id,
          position,
          label,
          starts_at,
          ends_at
        )
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, position, label, starts_at, ends_at
      `,
      [board.board_id, nextPosition, label, startsAt, endsAt]
    );

    const rows = await client.query(
      `
        SELECT id, position, label, day_of_week
        FROM classroom_weekly_timetable_rows
        WHERE board_id = $1
          AND is_active = TRUE
        ORDER BY position ASC
      `,
      [board.board_id]
    );

    await ensureCellsForBoard(client, board.board_id, rows.rows, insertedColumn.rows);
    await client.query(
      `
        UPDATE classroom_weekly_timetable_boards
        SET updated_by_user_id = $2, updated_at = NOW()
        WHERE id = $1
      `,
      [board.board_id, actorUserId]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return fetchBoardPayload(schoolId, classroomId);
}

async function updateBoardCell({
  schoolId,
  classroomId,
  cellId,
  subjectId = null,
  teacherId = null,
  title = null,
  subtitle = null,
  roomNumber = null,
  notes = null,
  colorHex = null,
  actorUserId = null,
}) {
  const board = await ensureBoard({ schoolId, classroomId, actorUserId });
  const result = await pool.query(
    `
      UPDATE classroom_weekly_timetable_cells
      SET
        subject_id = $4,
        teacher_id = $5,
        title = $6,
        subtitle = $7,
        room_number = $8,
        notes = $9,
        color_hex = $10,
        updated_by_user_id = $11,
        updated_at = NOW()
      WHERE board_id = $1
        AND id = $2
        AND EXISTS (
          SELECT 1
          FROM classroom_weekly_timetable_boards b
          WHERE b.id = $1
            AND b.classroom_id = $3
            AND b.school_id = $12
        )
      RETURNING id
    `,
    [
      board.board_id,
      cellId,
      classroomId,
      subjectId,
      teacherId,
      title,
      subtitle,
      roomNumber,
      notes,
      colorHex,
      actorUserId,
      schoolId,
    ]
  );

  if (!result.rows[0]) {
    throw new AppError(404, "NOT_FOUND", "Timetable cell not found");
  }

  await pool.query(
    `
      UPDATE classroom_weekly_timetable_boards
      SET updated_by_user_id = $2, updated_at = NOW()
      WHERE id = $1
    `,
    [board.board_id, actorUserId]
  );

  return fetchBoardPayload(schoolId, classroomId);
}

module.exports = {
  ensureBoard,
  addBoardRow,
  addBoardColumn,
  updateBoardCell,
  fetchBoardPayload,
};
