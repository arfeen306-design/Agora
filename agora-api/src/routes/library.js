const express = require("express");
const { z } = require("zod");

const pool = require("../db");
const { requireAuth, requireRoles } = require("../middleware/auth");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { success } = require("../utils/http");

const router = express.Router();

const LIBRARIAN_ROLES = ["school_admin", "librarian"];
const BROWSE_ROLES = ["school_admin", "librarian", "teacher", "student"];

const bookPathSchema = z.object({ bookId: z.string().uuid() });
const memberPathSchema = z.object({ memberId: z.string().uuid() });

const paginationQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

const searchBooksQuery = paginationQuery.extend({
  search: z.string().trim().min(1).max(200).optional(),
  category: z.string().trim().max(100).optional(),
  available_only: z.enum(["true", "false"]).transform((v) => v === "true").default("false"),
});

const createBookSchema = z.object({
  title: z.string().trim().min(1).max(300),
  author: z.string().trim().max(200).optional(),
  isbn: z.string().trim().max(30).optional(),
  category: z.string().trim().min(1).max(100).default("general"),
  publisher: z.string().trim().max(200).optional(),
  edition: z.string().trim().max(60).optional(),
  publish_year: z.coerce.number().int().min(1800).max(2100).optional(),
  total_copies: z.coerce.number().int().min(1).max(10000).default(1),
  shelf_location: z.string().trim().max(100).optional(),
  description: z.string().trim().max(2000).optional(),
  cover_image_url: z.string().url().max(2000).optional(),
  metadata: z.record(z.any()).default({}),
});

const updateBookSchema = z.object({
  title: z.string().trim().min(1).max(300).optional(),
  author: z.string().trim().max(200).nullable().optional(),
  isbn: z.string().trim().max(30).nullable().optional(),
  category: z.string().trim().max(100).optional(),
  publisher: z.string().trim().max(200).nullable().optional(),
  edition: z.string().trim().max(60).nullable().optional(),
  publish_year: z.coerce.number().int().min(1800).max(2100).nullable().optional(),
  total_copies: z.coerce.number().int().min(0).max(10000).optional(),
  available_copies: z.coerce.number().int().min(0).max(10000).optional(),
  shelf_location: z.string().trim().max(100).nullable().optional(),
  description: z.string().trim().max(2000).nullable().optional(),
  cover_image_url: z.string().url().max(2000).nullable().optional(),
  is_active: z.boolean().optional(),
  metadata: z.record(z.any()).optional(),
}).refine((d) => Object.keys(d).length > 0, { message: "At least one field required" });

const issueBookSchema = z.object({
  book_id: z.string().uuid(),
  member_type: z.enum(["student", "staff"]),
  member_id: z.string().uuid(),
  due_days: z.coerce.number().int().min(1).max(365).default(14),
  notes: z.string().trim().max(500).optional(),
});

const returnBookSchema = z.object({
  transaction_id: z.string().uuid(),
  fine_amount: z.coerce.number().min(0).default(0),
  notes: z.string().trim().max(500).optional(),
});

const transactionsQuery = paginationQuery.extend({
  status: z.enum(["issued", "returned", "overdue", "lost"]).optional(),
  member_type: z.enum(["student", "staff"]).optional(),
  book_id: z.string().uuid().optional(),
});

function parseSchema(schema, input, message = "Invalid request input") {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(422, "VALIDATION_ERROR", message,
      parsed.error.issues.map((i) => ({ field: i.path.join("."), issue: i.message })));
  }
  return parsed.data;
}

// ─── BOOK CATALOG ───────────────────────────────────────────────────

router.get(
  "/books",
  requireAuth,
  requireRoles(...BROWSE_ROLES),
  asyncHandler(async (req, res) => {
    const query = parseSchema(searchBooksQuery, req.query);
    const params = [req.auth.schoolId];
    const where = ["b.school_id = $1", "b.is_active = TRUE"];

    if (query.search) {
      params.push(`%${query.search}%`);
      where.push(`(b.title ILIKE $${params.length} OR b.author ILIKE $${params.length} OR b.isbn ILIKE $${params.length})`);
    }
    if (query.category) {
      params.push(query.category);
      where.push(`b.category = $${params.length}`);
    }
    if (query.available_only) {
      where.push("b.available_copies > 0");
    }

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM library_books b WHERE ${where.join(" AND ")}`,
      params
    );
    const totalItems = countResult.rows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const result = await pool.query(
      `SELECT * FROM library_books b WHERE ${where.join(" AND ")} ORDER BY b.title ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, query.page_size, offset]
    );
    return success(res, result.rows, 200, {
      pagination: { page: query.page, page_size: query.page_size, total_items: totalItems, total_pages: totalPages },
    });
  })
);

router.get(
  "/books/:bookId",
  requireAuth,
  requireRoles(...BROWSE_ROLES),
  asyncHandler(async (req, res) => {
    const { bookId } = parseSchema(bookPathSchema, req.params);
    const result = await pool.query(
      "SELECT * FROM library_books WHERE school_id = $1 AND id = $2 LIMIT 1",
      [req.auth.schoolId, bookId]
    );
    if (!result.rows[0]) throw new AppError(404, "NOT_FOUND", "Book not found");

    // Active transactions for this book
    const txns = await pool.query(
      `
        SELECT lt.id, lt.member_type, lt.member_id, lt.issued_at, lt.due_at, lt.status
        FROM library_transactions lt
        WHERE lt.school_id = $1 AND lt.book_id = $2 AND lt.status = 'issued'
        ORDER BY lt.due_at ASC
      `,
      [req.auth.schoolId, bookId]
    );
    return success(res, { book: result.rows[0], active_issues: txns.rows });
  })
);

router.post(
  "/books",
  requireAuth,
  requireRoles(...LIBRARIAN_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(createBookSchema, req.body, "Invalid book");
    const result = await pool.query(
      `
        INSERT INTO library_books (
          school_id, title, author, isbn, category, publisher, edition,
          publish_year, total_copies, available_copies, shelf_location,
          description, cover_image_url, metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9, $10, $11, $12, $13::jsonb)
        RETURNING *
      `,
      [
        req.auth.schoolId, body.title, body.author || null, body.isbn || null,
        body.category, body.publisher || null, body.edition || null,
        body.publish_year || null, body.total_copies, body.shelf_location || null,
        body.description || null, body.cover_image_url || null, JSON.stringify(body.metadata),
      ]
    );
    return success(res, result.rows[0], 201);
  })
);

router.patch(
  "/books/:bookId",
  requireAuth,
  requireRoles(...LIBRARIAN_ROLES),
  asyncHandler(async (req, res) => {
    const { bookId } = parseSchema(bookPathSchema, req.params);
    const body = parseSchema(updateBookSchema, req.body, "Invalid book update");

    const sets = [];
    const params = [req.auth.schoolId, bookId];

    for (const [key, value] of Object.entries(body)) {
      if (value === undefined) continue;
      if (key === "metadata") {
        params.push(JSON.stringify(value));
        sets.push(`metadata = $${params.length}::jsonb`);
      } else {
        params.push(value);
        sets.push(`${key} = $${params.length}`);
      }
    }

    const result = await pool.query(
      `UPDATE library_books SET ${sets.join(", ")}, updated_at = NOW() WHERE school_id = $1 AND id = $2 RETURNING *`,
      params
    );
    if (!result.rows[0]) throw new AppError(404, "NOT_FOUND", "Book not found");
    return success(res, result.rows[0]);
  })
);

router.delete(
  "/books/:bookId",
  requireAuth,
  requireRoles(...LIBRARIAN_ROLES),
  asyncHandler(async (req, res) => {
    const { bookId } = parseSchema(bookPathSchema, req.params);
    const result = await pool.query(
      "UPDATE library_books SET is_active = FALSE, updated_at = NOW() WHERE school_id = $1 AND id = $2 AND is_active = TRUE RETURNING id",
      [req.auth.schoolId, bookId]
    );
    if (!result.rows[0]) throw new AppError(404, "NOT_FOUND", "Book not found");
    return success(res, { deactivated: true });
  })
);

// ─── ISSUE / RETURN ─────────────────────────────────────────────────

router.post(
  "/issue",
  requireAuth,
  requireRoles(...LIBRARIAN_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(issueBookSchema, req.body, "Invalid issue request");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      // Check book availability
      const bookResult = await client.query(
        "SELECT id, title, available_copies FROM library_books WHERE school_id = $1 AND id = $2 AND is_active = TRUE FOR UPDATE",
        [req.auth.schoolId, body.book_id]
      );
      const book = bookResult.rows[0];
      if (!book) throw new AppError(404, "NOT_FOUND", "Book not found");
      if (book.available_copies <= 0) throw new AppError(422, "VALIDATION_ERROR", "No copies available");

      // Verify member exists
      if (body.member_type === "student") {
        const check = await client.query("SELECT id FROM students WHERE school_id = $1 AND id = $2 LIMIT 1", [req.auth.schoolId, body.member_id]);
        if (!check.rows[0]) throw new AppError(404, "NOT_FOUND", "Student not found");
      } else {
        const check = await client.query("SELECT id FROM staff_profiles WHERE school_id = $1 AND id = $2 LIMIT 1", [req.auth.schoolId, body.member_id]);
        if (!check.rows[0]) throw new AppError(404, "NOT_FOUND", "Staff member not found");
      }

      const dueAt = new Date(Date.now() + body.due_days * 24 * 60 * 60 * 1000);

      const txnResult = await client.query(
        `
          INSERT INTO library_transactions (school_id, book_id, member_type, member_id, due_at, issued_by_user_id, notes)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *
        `,
        [req.auth.schoolId, body.book_id, body.member_type, body.member_id, dueAt.toISOString(), req.auth.userId, body.notes || null]
      );

      await client.query(
        "UPDATE library_books SET available_copies = available_copies - 1, updated_at = NOW() WHERE id = $1",
        [body.book_id]
      );

      await client.query("COMMIT");
      return success(res, txnResult.rows[0], 201);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

router.post(
  "/return",
  requireAuth,
  requireRoles(...LIBRARIAN_ROLES),
  asyncHandler(async (req, res) => {
    const body = parseSchema(returnBookSchema, req.body, "Invalid return request");

    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const txnResult = await client.query(
        "SELECT * FROM library_transactions WHERE school_id = $1 AND id = $2 AND status = 'issued' FOR UPDATE",
        [req.auth.schoolId, body.transaction_id]
      );
      const txn = txnResult.rows[0];
      if (!txn) throw new AppError(404, "NOT_FOUND", "Transaction not found or already returned");

      const updateResult = await client.query(
        `
          UPDATE library_transactions
          SET status = 'returned', returned_at = NOW(), returned_by_user_id = $3,
              fine_amount = $4, fine_paid = CASE WHEN $4 > 0 THEN FALSE ELSE TRUE END,
              notes = COALESCE($5, notes), updated_at = NOW()
          WHERE id = $1 AND school_id = $2
          RETURNING *
        `,
        [body.transaction_id, req.auth.schoolId, req.auth.userId, body.fine_amount, body.notes || null]
      );

      await client.query(
        "UPDATE library_books SET available_copies = available_copies + 1, updated_at = NOW() WHERE id = $1",
        [txn.book_id]
      );

      await client.query("COMMIT");
      return success(res, updateResult.rows[0]);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  })
);

// ─── TRANSACTIONS ───────────────────────────────────────────────────

router.get(
  "/transactions",
  requireAuth,
  requireRoles(...LIBRARIAN_ROLES),
  asyncHandler(async (req, res) => {
    const query = parseSchema(transactionsQuery, req.query);
    const params = [req.auth.schoolId];
    const where = ["lt.school_id = $1"];

    if (query.status) { params.push(query.status); where.push(`lt.status = $${params.length}`); }
    if (query.member_type) { params.push(query.member_type); where.push(`lt.member_type = $${params.length}`); }
    if (query.book_id) { params.push(query.book_id); where.push(`lt.book_id = $${params.length}`); }

    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total FROM library_transactions lt WHERE ${where.join(" AND ")}`, params
    );
    const totalItems = countResult.rows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const result = await pool.query(
      `
        SELECT lt.*, lb.title AS book_title, lb.author AS book_author
        FROM library_transactions lt
        JOIN library_books lb ON lb.id = lt.book_id AND lb.school_id = lt.school_id
        WHERE ${where.join(" AND ")}
        ORDER BY lt.issued_at DESC
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}
      `,
      [...params, query.page_size, offset]
    );
    return success(res, result.rows, 200, {
      pagination: { page: query.page, page_size: query.page_size, total_items: totalItems, total_pages: totalPages },
    });
  })
);

// ─── OVERDUE REPORT ────────────────────────────────────────────────

router.get(
  "/overdue",
  requireAuth,
  requireRoles(...LIBRARIAN_ROLES),
  asyncHandler(async (req, res) => {
    const query = parseSchema(paginationQuery, req.query);
    const countResult = await pool.query(
      "SELECT COUNT(*)::int AS total FROM library_transactions WHERE school_id = $1 AND status = 'issued' AND due_at < NOW()",
      [req.auth.schoolId]
    );
    const totalItems = countResult.rows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const result = await pool.query(
      `
        SELECT lt.*, lb.title AS book_title, lb.author AS book_author,
          EXTRACT(DAY FROM NOW() - lt.due_at)::int AS days_overdue
        FROM library_transactions lt
        JOIN library_books lb ON lb.id = lt.book_id AND lb.school_id = lt.school_id
        WHERE lt.school_id = $1 AND lt.status = 'issued' AND lt.due_at < NOW()
        ORDER BY lt.due_at ASC
        LIMIT $2 OFFSET $3
      `,
      [req.auth.schoolId, query.page_size, offset]
    );
    return success(res, result.rows, 200, {
      pagination: { page: query.page, page_size: query.page_size, total_items: totalItems, total_pages: totalPages },
    });
  })
);

// ─── MEMBER HISTORY ─────────────────────────────────────────────────

router.get(
  "/members/:memberId/history",
  requireAuth,
  requireRoles(...LIBRARIAN_ROLES),
  asyncHandler(async (req, res) => {
    const { memberId } = parseSchema(memberPathSchema, req.params);
    const query = parseSchema(paginationQuery, req.query);

    const countResult = await pool.query(
      "SELECT COUNT(*)::int AS total FROM library_transactions WHERE school_id = $1 AND member_id = $2",
      [req.auth.schoolId, memberId]
    );
    const totalItems = countResult.rows[0]?.total || 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / query.page_size));
    const offset = (query.page - 1) * query.page_size;

    const result = await pool.query(
      `
        SELECT lt.*, lb.title AS book_title, lb.author AS book_author
        FROM library_transactions lt
        JOIN library_books lb ON lb.id = lt.book_id AND lb.school_id = lt.school_id
        WHERE lt.school_id = $1 AND lt.member_id = $2
        ORDER BY lt.issued_at DESC
        LIMIT $3 OFFSET $4
      `,
      [req.auth.schoolId, memberId, query.page_size, offset]
    );
    return success(res, result.rows, 200, {
      pagination: { page: query.page, page_size: query.page_size, total_items: totalItems, total_pages: totalPages },
    });
  })
);

// ─── LIBRARY DASHBOARD ──────────────────────────────────────────────

router.get(
  "/dashboard",
  requireAuth,
  requireRoles(...LIBRARIAN_ROLES),
  asyncHandler(async (req, res) => {
    const result = await pool.query(
      `
        SELECT
          (SELECT COUNT(*)::int FROM library_books WHERE school_id = $1 AND is_active = TRUE) AS total_books,
          (SELECT COALESCE(SUM(total_copies), 0)::int FROM library_books WHERE school_id = $1 AND is_active = TRUE) AS total_copies,
          (SELECT COALESCE(SUM(available_copies), 0)::int FROM library_books WHERE school_id = $1 AND is_active = TRUE) AS available_copies,
          (SELECT COUNT(*)::int FROM library_transactions WHERE school_id = $1 AND status = 'issued') AS books_issued,
          (SELECT COUNT(*)::int FROM library_transactions WHERE school_id = $1 AND status = 'issued' AND due_at < NOW()) AS books_overdue,
          (SELECT COUNT(DISTINCT member_id)::int FROM library_transactions WHERE school_id = $1 AND status = 'issued') AS active_members,
          (SELECT COALESCE(SUM(fine_amount), 0)::numeric FROM library_transactions WHERE school_id = $1 AND fine_paid = FALSE AND fine_amount > 0) AS unpaid_fines
      `,
      [req.auth.schoolId]
    );

    const row = result.rows[0] || {};
    return success(res, {
      total_books: Number(row.total_books || 0),
      total_copies: Number(row.total_copies || 0),
      available_copies: Number(row.available_copies || 0),
      books_issued: Number(row.books_issued || 0),
      books_overdue: Number(row.books_overdue || 0),
      active_members: Number(row.active_members || 0),
      unpaid_fines: Number(Number(row.unpaid_fines || 0).toFixed(2)),
    });
  })
);

module.exports = router;
