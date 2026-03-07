const express = require("express");
const healthRouter = require("./health");
const authRouter = require("./auth");
const attendanceRouter = require("./attendance");
const homeworkRouter = require("./homework");
const marksRouter = require("./marks");
const messagingRouter = require("./messaging");
const notificationsRouter = require("./notifications");
const filesRouter = require("./files");
const reportsRouter = require("./reports");
const feesRouter = require("./fees");
const eventsRouter = require("./events");
const adminRouter = require("./admin");
const observabilityRouter = require("./observability");

const router = express.Router();

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/attendance", attendanceRouter);
router.use("/homework", homeworkRouter);
router.use(marksRouter);
router.use(messagingRouter);
router.use(notificationsRouter);
router.use(filesRouter);
router.use(reportsRouter);
router.use("/fees", feesRouter);
router.use("/events", eventsRouter);
router.use("/admin", adminRouter);
router.use(observabilityRouter);

module.exports = router;
