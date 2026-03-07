const express = require("express");

const pool = require("../db");
const { requireInternalApiKey } = require("../middleware/internal-key");
const asyncHandler = require("../utils/async-handler");
const { success } = require("../utils/http");
const { getObservabilitySnapshot } = require("../utils/observability");

const router = express.Router();

router.get(
  "/internal/observability/metrics",
  requireInternalApiKey,
  asyncHandler(async (_req, res) => {
    const snapshot = getObservabilitySnapshot();
    return success(res, snapshot, 200);
  })
);

router.get(
  "/internal/observability/ready",
  requireInternalApiKey,
  asyncHandler(async (_req, res) => {
    try {
      await pool.query("SELECT 1");
      return success(
        res,
        {
          service: "agora-api",
          ready: true,
          db: "up",
          timestamp: new Date().toISOString(),
        },
        200
      );
    } catch (_e) {
      return res.status(503).json({
        success: false,
        error: {
          code: "SERVICE_UNAVAILABLE",
          message: "Database is not ready",
          details: [],
        },
        meta: {
          request_id: res.locals.requestId || null,
        },
      });
    }
  })
);

module.exports = router;
