const express = require("express");
const { z } = require("zod");

const pool = require("../db");
const { requireAuth, requireRoles } = require("../middleware/auth");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { success } = require("../utils/http");

const router = express.Router();

const TRANSPORT_ROLES = ["school_admin", "transport_admin"];

const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const routePathSchema = z.object({ routeId: z.string().uuid() });
const vehiclePathSchema = z.object({ vehicleId: z.string().uuid() });
const stopPathSchema = z.object({ stopId: z.string().uuid() });
const assignmentPathSchema = z.object({ assignmentId: z.string().uuid() });

const createRouteSchema = z.object({
  route_name: z.string().trim().min(1).max(200),
  route_code: z.string().trim().min(1).max(60).optional(),
  description: z.string().trim().max(1000).optional(),
  schedule_type: z.enum(["daily", "weekdays", "custom"]).default("daily"),
  metadata: z.record(z.any()).default({}),
});

const updateRouteSchema = z.object({
  route_name: z.string().trim().min(1).max(200).optional(),
  route_code: z.string().trim().min(1).max(60).optional(),
  description: z.string().trim().max(1000).optional(),
  schedule_type: z.enum(["daily", "weekdays", "custom"]).optional(),
  is_active: z.boolean().optional(),
  metadata: z.record(z.any()).optional(),
}).refine((d) => Object.keys(d).length > 0, { message: "At least one field required" });

const createStopSchema = z.object({
  stop_name: z.string().trim().min(1).max(200),
  stop_order: z.coerce.number().int().min(0).default(0),
  pickup_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  dropoff_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/).optional(),
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  address: z.string().trim().max(500).optional(),
});

const createVehicleSchema = z.object({
  vehicle_number: z.string().trim().min(1).max(60),
  vehicle_type: z.enum(["bus", "van", "car", "other"]).default("bus"),
  capacity: z.coerce.number().int().min(1).max(200).default(40),
  driver_name: z.string().trim().max(120).optional(),
  driver_phone: z.string().trim().max(60).optional(),
  driver_license: z.string().trim().max(60).optional(),
  route_id: z.string().uuid().optional(),
  metadata: z.record(z.any()).default({}),
});

const updateVehicleSchema = z.object({
  vehicle_number: z.string().trim().min(1).max(60).optional(),
  vehicle_type: z.enum(["bus", "van", "car", "other"]).optional(),
  capacity: z.coerce.number().int().min(1).max(200).optional(),
  driver_name: z.string().trim().max(120).nullable().optional(),
  driver_phone: z.string().trim().max(60).nullable().optional(),
  driver_license: z.string().trim().max(60).nullable().optional(),
  route_id: z.string().uuid().nullable().optional(),
  is_active: z.boolean().optional(),
  metadata: z.record(z.any()).optional(),
}).refine((d) => Object.keys(d).length > 0, { message: "At least one field required" });

const createAssignmentSchema = z.object({
  student_id: z.string().uuid(),
  route_id: z.string().uuid(),
  stop_id: z.string().uuid().optional(),
  direction: z.enum(["pickup", "dropoff", "both"]).default("both"),
});

function parseSchema(schema, input, message = "Invalid request input") {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(422, "VALIDATION_ERROR", message,
      parsed.error.issues.map((i) => ({ field: i.path.join("."), issue: i.message })));
  }
  return parsed.data;
}

// ─── ROUTES CRUD ────────────────────────────────────────────────────

router.get(
  "/routes",
  requireAuth,
  requireRoles(...TRANSPORT_ROLES),
  asyncHandler(async (req, res) => {
    const query = parseSchema(paginationQuery, req.query);
    const countResult = await pool.query(
      "SELECT COUNT(*)::int AS total FROM transport_routes WHERE school_id = $1",
      [req.auth.schoolId]
    );
    const totalItems = countResult.rows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const result = await pool.query(
      `
        SELECT tr.*,
          (SELECT COUNT(*)::int FROM transport_stops ts WHERE ts.route_id = tr.id) AS stop_count,
          (SELECT COUNT(*)::int FROM transport_assignments ta WHERE ta.route_id = tr.id AND ta.is_active = TRUE) AS student_count,
          (SELECT COUNT(*)::int FROM transport_vehicles tv WHERE tv.route_id = tr.id AND tv.is_active = TRUE) AS vehicle_count
        FROM transport_routes tr
        WHERE tr.school_id = $1
        ORDER BY tr.route_name ASC
        LIMIT $2 OFFSET $3
      `,
      [req.auth.schoolId, query.page_size, offset]
    );
    return success(res, result.rows, 200, {
      pagination: { page: query.page, page_size: query.page_size, total_items: totalItems, total_pages: totalPages },
    });
  })
);

router.post(
  "/routes",
  requireAuth,
  requireRoles(...TRANSPORT_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(createRouteSchema, req.body, "Invalid route");
    const result = await pool.query(
      `
        INSERT INTO transport_routes (school_id, route_name, route_code, description, schedule_type, metadata)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb)
        RETURNING *
      `,
      [req.auth.schoolId, body.route_name, body.route_code || null, body.description || null, body.schedule_type, JSON.stringify(body.metadata)]
    );
    return success(res, result.rows[0], 201);
  })
);

router.patch(
  "/routes/:routeId",
  requireAuth,
  requireRoles(...TRANSPORT_ROLES),
  asyncHandler(async (req, res) => {
    const { routeId } = parseSchema(routePathSchema, req.params);
    const body = parseSchema(updateRouteSchema, req.body, "Invalid route update");

    const sets = [];
    const params = [req.auth.schoolId, routeId];
    if (body.route_name !== undefined) { params.push(body.route_name); sets.push(`route_name = $${params.length}`); }
    if (body.route_code !== undefined) { params.push(body.route_code); sets.push(`route_code = $${params.length}`); }
    if (body.description !== undefined) { params.push(body.description); sets.push(`description = $${params.length}`); }
    if (body.schedule_type !== undefined) { params.push(body.schedule_type); sets.push(`schedule_type = $${params.length}`); }
    if (body.is_active !== undefined) { params.push(body.is_active); sets.push(`is_active = $${params.length}`); }
    if (body.metadata !== undefined) { params.push(JSON.stringify(body.metadata)); sets.push(`metadata = $${params.length}::jsonb`); }

    const result = await pool.query(
      `UPDATE transport_routes SET ${sets.join(", ")}, updated_at = NOW() WHERE school_id = $1 AND id = $2 RETURNING *`,
      params
    );
    if (!result.rows[0]) throw new AppError(404, "NOT_FOUND", "Route not found");
    return success(res, result.rows[0]);
  })
);

router.delete(
  "/routes/:routeId",
  requireAuth,
  requireRoles(...TRANSPORT_ROLES),
  asyncHandler(async (req, res) => {
    const { routeId } = parseSchema(routePathSchema, req.params);
    const result = await pool.query(
      "UPDATE transport_routes SET is_active = FALSE, updated_at = NOW() WHERE school_id = $1 AND id = $2 AND is_active = TRUE RETURNING id",
      [req.auth.schoolId, routeId]
    );
    if (!result.rows[0]) throw new AppError(404, "NOT_FOUND", "Route not found");
    return success(res, { deactivated: true });
  })
);

// ─── STOPS ──────────────────────────────────────────────────────────

router.get(
  "/routes/:routeId/stops",
  requireAuth,
  requireRoles(...TRANSPORT_ROLES),
  asyncHandler(async (req, res) => {
    const { routeId } = parseSchema(routePathSchema, req.params);
    const result = await pool.query(
      `
        SELECT ts.*,
          (SELECT COUNT(*)::int FROM transport_assignments ta WHERE ta.stop_id = ts.id AND ta.is_active = TRUE) AS assigned_students
        FROM transport_stops ts
        WHERE ts.school_id = $1 AND ts.route_id = $2
        ORDER BY ts.stop_order ASC
      `,
      [req.auth.schoolId, routeId]
    );
    return success(res, result.rows);
  })
);

router.post(
  "/routes/:routeId/stops",
  requireAuth,
  requireRoles(...TRANSPORT_ROLES),
  asyncHandler(async (req, res) => {
    const { routeId } = parseSchema(routePathSchema, req.params);
    const body = parseSchema(createStopSchema, req.body, "Invalid stop");

    // Verify route exists
    const routeCheck = await pool.query(
      "SELECT id FROM transport_routes WHERE school_id = $1 AND id = $2 LIMIT 1",
      [req.auth.schoolId, routeId]
    );
    if (!routeCheck.rows[0]) throw new AppError(404, "NOT_FOUND", "Route not found");

    const result = await pool.query(
      `
        INSERT INTO transport_stops (school_id, route_id, stop_name, stop_order, pickup_time, dropoff_time, latitude, longitude, address)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *
      `,
      [req.auth.schoolId, routeId, body.stop_name, body.stop_order, body.pickup_time || null, body.dropoff_time || null, body.latitude || null, body.longitude || null, body.address || null]
    );
    return success(res, result.rows[0], 201);
  })
);

router.delete(
  "/stops/:stopId",
  requireAuth,
  requireRoles(...TRANSPORT_ROLES),
  asyncHandler(async (req, res) => {
    const { stopId } = parseSchema(stopPathSchema, req.params);
    const result = await pool.query(
      "DELETE FROM transport_stops WHERE school_id = $1 AND id = $2 RETURNING id",
      [req.auth.schoolId, stopId]
    );
    if (!result.rows[0]) throw new AppError(404, "NOT_FOUND", "Stop not found");
    return success(res, { deleted: true });
  })
);

// ─── VEHICLES ───────────────────────────────────────────────────────

router.get(
  "/vehicles",
  requireAuth,
  requireRoles(...TRANSPORT_ROLES),
  asyncHandler(async (req, res) => {
    const query = parseSchema(paginationQuery, req.query);
    const countResult = await pool.query(
      "SELECT COUNT(*)::int AS total FROM transport_vehicles WHERE school_id = $1",
      [req.auth.schoolId]
    );
    const totalItems = countResult.rows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const result = await pool.query(
      `
        SELECT tv.*, tr.route_name
        FROM transport_vehicles tv
        LEFT JOIN transport_routes tr ON tr.id = tv.route_id AND tr.school_id = tv.school_id
        WHERE tv.school_id = $1
        ORDER BY tv.vehicle_number ASC
        LIMIT $2 OFFSET $3
      `,
      [req.auth.schoolId, query.page_size, offset]
    );
    return success(res, result.rows, 200, {
      pagination: { page: query.page, page_size: query.page_size, total_items: totalItems, total_pages: totalPages },
    });
  })
);

router.post(
  "/vehicles",
  requireAuth,
  requireRoles(...TRANSPORT_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(createVehicleSchema, req.body, "Invalid vehicle");
    const result = await pool.query(
      `
        INSERT INTO transport_vehicles (school_id, vehicle_number, vehicle_type, capacity, driver_name, driver_phone, driver_license, route_id, metadata)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)
        RETURNING *
      `,
      [req.auth.schoolId, body.vehicle_number, body.vehicle_type, body.capacity, body.driver_name || null, body.driver_phone || null, body.driver_license || null, body.route_id || null, JSON.stringify(body.metadata)]
    );
    return success(res, result.rows[0], 201);
  })
);

router.patch(
  "/vehicles/:vehicleId",
  requireAuth,
  requireRoles(...TRANSPORT_ROLES),
  asyncHandler(async (req, res) => {
    const { vehicleId } = parseSchema(vehiclePathSchema, req.params);
    const body = parseSchema(updateVehicleSchema, req.body, "Invalid vehicle update");

    const sets = [];
    const params = [req.auth.schoolId, vehicleId];
    if (body.vehicle_number !== undefined) { params.push(body.vehicle_number); sets.push(`vehicle_number = $${params.length}`); }
    if (body.vehicle_type !== undefined) { params.push(body.vehicle_type); sets.push(`vehicle_type = $${params.length}`); }
    if (body.capacity !== undefined) { params.push(body.capacity); sets.push(`capacity = $${params.length}`); }
    if (body.driver_name !== undefined) { params.push(body.driver_name); sets.push(`driver_name = $${params.length}`); }
    if (body.driver_phone !== undefined) { params.push(body.driver_phone); sets.push(`driver_phone = $${params.length}`); }
    if (body.driver_license !== undefined) { params.push(body.driver_license); sets.push(`driver_license = $${params.length}`); }
    if (body.route_id !== undefined) { params.push(body.route_id); sets.push(`route_id = $${params.length}`); }
    if (body.is_active !== undefined) { params.push(body.is_active); sets.push(`is_active = $${params.length}`); }
    if (body.metadata !== undefined) { params.push(JSON.stringify(body.metadata)); sets.push(`metadata = $${params.length}::jsonb`); }

    const result = await pool.query(
      `UPDATE transport_vehicles SET ${sets.join(", ")}, updated_at = NOW() WHERE school_id = $1 AND id = $2 RETURNING *`,
      params
    );
    if (!result.rows[0]) throw new AppError(404, "NOT_FOUND", "Vehicle not found");
    return success(res, result.rows[0]);
  })
);

// ─── ASSIGNMENTS ────────────────────────────────────────────────────

router.get(
  "/assignments",
  requireAuth,
  requireRoles(...TRANSPORT_ROLES, "teacher"),
  asyncHandler(async (req, res) => {
    const query = parseSchema(
      paginationQuery.extend({
        route_id: z.string().uuid().optional(),
        student_id: z.string().uuid().optional(),
      }),
      req.query
    );

    const params = [req.auth.schoolId];
    const where = ["ta.school_id = $1", "ta.is_active = TRUE"];

    if (query.route_id) { params.push(query.route_id); where.push(`ta.route_id = $${params.length}`); }
    if (query.student_id) { params.push(query.student_id); where.push(`ta.student_id = $${params.length}`); }

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM transport_assignments ta WHERE ${where.join(" AND ")}`,
      params
    );
    const totalItems = countResult.rows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const result = await pool.query(
      `
        SELECT ta.*,
          s.first_name, s.last_name, s.student_code,
          tr.route_name, tr.route_code,
          ts.stop_name
        FROM transport_assignments ta
        JOIN students s ON s.id = ta.student_id AND s.school_id = ta.school_id
        JOIN transport_routes tr ON tr.id = ta.route_id AND tr.school_id = ta.school_id
        LEFT JOIN transport_stops ts ON ts.id = ta.stop_id
        WHERE ${where.join(" AND ")}
        ORDER BY s.first_name ASC, s.last_name ASC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `,
      [...params, query.page_size, offset]
    );
    return success(res, result.rows, 200, {
      pagination: { page: query.page, page_size: query.page_size, total_items: totalItems, total_pages: totalPages },
    });
  })
);

router.post(
  "/assignments",
  requireAuth,
  requireRoles(...TRANSPORT_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(createAssignmentSchema, req.body, "Invalid assignment");

    // Verify student + route exist in school
    const [studentCheck, routeCheck] = await Promise.all([
      pool.query("SELECT id FROM students WHERE school_id = $1 AND id = $2 LIMIT 1", [req.auth.schoolId, body.student_id]),
      pool.query("SELECT id FROM transport_routes WHERE school_id = $1 AND id = $2 AND is_active = TRUE LIMIT 1", [req.auth.schoolId, body.route_id]),
    ]);
    if (!studentCheck.rows[0]) throw new AppError(404, "NOT_FOUND", "Student not found");
    if (!routeCheck.rows[0]) throw new AppError(404, "NOT_FOUND", "Route not found or inactive");

    const result = await pool.query(
      `
        INSERT INTO transport_assignments (school_id, student_id, route_id, stop_id, direction)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (school_id, student_id, route_id, direction) DO UPDATE SET
          stop_id = EXCLUDED.stop_id, is_active = TRUE, updated_at = NOW()
        RETURNING *
      `,
      [req.auth.schoolId, body.student_id, body.route_id, body.stop_id || null, body.direction]
    );
    return success(res, result.rows[0], 201);
  })
);

router.delete(
  "/assignments/:assignmentId",
  requireAuth,
  requireRoles(...TRANSPORT_ROLES),
  asyncHandler(async (req, res) => {
    const { assignmentId } = parseSchema(assignmentPathSchema, req.params);
    const result = await pool.query(
      "UPDATE transport_assignments SET is_active = FALSE, updated_at = NOW() WHERE school_id = $1 AND id = $2 AND is_active = TRUE RETURNING id",
      [req.auth.schoolId, assignmentId]
    );
    if (!result.rows[0]) throw new AppError(404, "NOT_FOUND", "Assignment not found");
    return success(res, { deactivated: true });
  })
);

module.exports = router;
