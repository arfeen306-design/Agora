const dotenv = require("dotenv");

dotenv.config();

function asBool(value, fallback = false) {
  if (value === undefined) return fallback;
  return String(value).toLowerCase() === "true";
}

function asCsv(value) {
  if (!value) return [];
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 8080),
  cors: {
    allowedOrigins: asCsv(process.env.CORS_ALLOWED_ORIGINS),
  },
  db: {
    host: process.env.DB_HOST || "127.0.0.1",
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || "agora",
    user: process.env.DB_USER || "agora_user",
    password: process.env.DB_PASSWORD || "",
    ssl: asBool(process.env.DB_SSL, false),
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET || "dev-access-secret",
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || "15m",
    refreshSecret: process.env.JWT_REFRESH_SECRET || "dev-refresh-secret",
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d",
  },
  internalApiKey: process.env.INTERNAL_API_KEY || "dev-internal-key",
  rateLimit: {
    authLoginWindowMs: Number(process.env.RATE_LIMIT_AUTH_LOGIN_WINDOW_MS || 60000),
    authLoginMax: Number(process.env.RATE_LIMIT_AUTH_LOGIN_MAX || 20),
    deviceIngestWindowMs: Number(process.env.RATE_LIMIT_DEVICE_INGEST_WINDOW_MS || 60000),
    deviceIngestMax: Number(process.env.RATE_LIMIT_DEVICE_INGEST_MAX || 120),
    internalWindowMs: Number(process.env.RATE_LIMIT_INTERNAL_WINDOW_MS || 60000),
    internalMax: Number(process.env.RATE_LIMIT_INTERNAL_MAX || 180),
  },
  attendanceDevice: {
    apiKey: process.env.ATTENDANCE_DEVICE_API_KEY || "dev-device-key",
    lateAfterLocalTime: process.env.ATTENDANCE_DEVICE_LATE_AFTER_LOCAL_TIME || "08:05:00",
    notificationChannel: process.env.ATTENDANCE_DEVICE_NOTIFICATION_CHANNEL || "push",
  },
  notifications: {
    worker: {
      intervalMs: Number(process.env.NOTIFICATION_WORKER_INTERVAL_MS || 5000),
      batchSize: Number(process.env.NOTIFICATION_WORKER_BATCH_SIZE || 20),
      maxRetries: Number(process.env.NOTIFICATION_WORKER_MAX_RETRIES || 3),
      baseBackoffSeconds: Number(process.env.NOTIFICATION_WORKER_BASE_BACKOFF_SECONDS || 30),
      maxBackoffSeconds: Number(process.env.NOTIFICATION_WORKER_MAX_BACKOFF_SECONDS || 1800),
      runOnce: asBool(process.env.NOTIFICATION_WORKER_RUN_ONCE, false),
    },
    push: {
      provider: process.env.PUSH_PROVIDER || "mock", // mock | webhook | fcm
      webhookUrl: process.env.PUSH_WEBHOOK_URL || "",
      fcm: {
        projectId: process.env.FCM_PROJECT_ID || "",
        clientEmail: process.env.FCM_CLIENT_EMAIL || "",
        privateKey: process.env.FCM_PRIVATE_KEY || "",
        tokenUri: process.env.FCM_TOKEN_URI || "https://oauth2.googleapis.com/token",
        scope: process.env.FCM_SCOPE || "https://www.googleapis.com/auth/firebase.messaging",
      },
    },
    email: {
      provider: process.env.EMAIL_PROVIDER || "mock", // mock | webhook
      webhookUrl: process.env.EMAIL_WEBHOOK_URL || "",
    },
    sms: {
      provider: process.env.SMS_PROVIDER || "mock", // mock | webhook
      webhookUrl: process.env.SMS_WEBHOOK_URL || "",
    },
  },
  reminders: {
    worker: {
      intervalMs: Number(process.env.REMINDER_WORKER_INTERVAL_MS || 300000), // 5 min
      runOnce: asBool(process.env.REMINDER_WORKER_RUN_ONCE, false),
    },
    homeworkDue: {
      enabled: asBool(process.env.REMINDER_HOMEWORK_DUE_ENABLED, true),
      withinHours: Number(process.env.REMINDER_HOMEWORK_DUE_WITHIN_HOURS || 24),
    },
    attendanceAbsent: {
      enabled: asBool(process.env.REMINDER_ATTENDANCE_ABSENT_ENABLED, true),
    },
    feeOverdue: {
      enabled: asBool(process.env.REMINDER_FEE_OVERDUE_ENABLED, true),
    },
  },
  storage: {
    provider: process.env.STORAGE_PROVIDER || "local", // local | s3 | gcs
    bucket: process.env.STORAGE_BUCKET || "agora-dev",
    region: process.env.STORAGE_REGION || "us-east-1",
    endpoint: process.env.STORAGE_ENDPOINT || "",
    forcePathStyle: asBool(process.env.STORAGE_FORCE_PATH_STYLE, false),
    accessKeyId: process.env.STORAGE_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY || "",
    signedUrlExpiresIn: Number(process.env.STORAGE_SIGNED_URL_EXPIRES_IN || 900),
    maxUploadBytes: Number(process.env.STORAGE_MAX_UPLOAD_BYTES || 15728640), // 15 MB
    publicBaseUrl: process.env.STORAGE_PUBLIC_BASE_URL || "",
    localBaseDir: process.env.STORAGE_LOCAL_BASE_DIR || "/tmp/agora-storage",
    localSigningSecret: process.env.STORAGE_LOCAL_SIGNING_SECRET || process.env.JWT_ACCESS_SECRET || "dev-storage-signing-secret",
    gcsProjectId: process.env.GCS_PROJECT_ID || "",
    gcsKeyFilename: process.env.GCS_KEY_FILENAME || "",
    gcsClientEmail: process.env.GCS_CLIENT_EMAIL || "",
    gcsPrivateKey: process.env.GCS_PRIVATE_KEY || "",
  },
};

module.exports = config;
