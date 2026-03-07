const express = require("express");
const cors = require("cors");
const helmet = require("helmet");

const requestId = require("./middleware/request-id");
const auditTrail = require("./middleware/audit-trail");
const errorHandler = require("./middleware/error-handler");
const apiRoutes = require("./routes");

const app = express();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(requestId);
app.use(auditTrail);

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
