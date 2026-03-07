const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const config = require("./config");
const { createRateLimiter } = require("./middleware/rate-limit");
const requestId = require("./middleware/request-id");
const auditTrail = require("./middleware/audit-trail");
const requestObservability = require("./middleware/request-observability");
const errorHandler = require("./middleware/error-handler");
const apiRoutes = require("./routes");
const { requestContext } = require("./utils/request-context");

const app = express();

const internalRateLimiter = createRateLimiter({
  name: "internal",
  windowMs: config.rateLimit.internalWindowMs,
  max: config.rateLimit.internalMax,
});

function corsOrigin(origin, callback) {
  if (!origin) return callback(null, true);
  if (config.nodeEnv !== "production") return callback(null, true);
  if (config.cors.allowedOrigins.includes(origin)) return callback(null, true);
  return callback(null, false);
}

app.disable("x-powered-by");
app.use(helmet());
app.use(
  cors({
    origin: corsOrigin,
    credentials: true,
  })
);
app.use(express.json({ limit: "2mb" }));
app.use(requestContext);
app.use(requestId);
app.use(auditTrail);
app.use(requestObservability);
app.use("/api/v1/internal", internalRateLimiter);

app.use("/api/v1", apiRoutes);

app.use((_req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: "NOT_FOUND",
      message: "Route not found",
      details: [],
    },
    meta: {
      request_id: res.locals.requestId || null,
    },
  });
});

app.use(errorHandler);

module.exports = app;
