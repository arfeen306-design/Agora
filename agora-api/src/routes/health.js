const express = require("express");
const pool = require("../db");

const router = express.Router();

router.get("/health", async (_req, res) => {
  let db = "down";
  try {
    await pool.query("SELECT 1");
    db = "up";
  } catch (_e) {
    db = "down";
  }

  res.json({
    success: true,
    data: {
      service: "agora-api",
      status: "ok",
      db,
      uptime_seconds: Math.floor(process.uptime()),
      timestamp: new Date().toISOString(),
    },
    meta: {
      request_id: res.locals.requestId,
    },
  });
});

module.exports = router;
