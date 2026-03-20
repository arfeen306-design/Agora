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

function parsePgSslMode(value) {
  if (!value) return undefined;
  const normalized = String(value).toLowerCase();
  return ["require", "verify-ca", "verify-full"].includes(normalized);
}

function decodeMaybeBase64(value, fieldName) {
  try {
    return Buffer.from(value, "base64").toString("utf8");
  } catch {
    throw new Error(`${fieldName} must be valid base64`);
  }
}

function parseSecretJson(raw, fieldName) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("must be a JSON object");
    }
    return parsed;
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid JSON";
    throw new Error(`${fieldName} is invalid: ${message}`);
  }
}

function parseDbSecretFromUrl(urlString, fieldName) {
  let parsedUrl;
  try {
    parsedUrl = new URL(urlString);
  } catch {
    throw new Error(`${fieldName} url must be a valid URL`);
  }

  if (!["postgres:", "postgresql:"].includes(parsedUrl.protocol)) {
    throw new Error(`${fieldName} url must use postgres:// or postgresql://`);
  }

  const dbName = parsedUrl.pathname.replace(/^\/+/, "");
  return {
    host: parsedUrl.hostname || undefined,
    port: parsedUrl.port ? Number(parsedUrl.port) : undefined,
    database: dbName || undefined,
    user: parsedUrl.username ? decodeURIComponent(parsedUrl.username) : undefined,
    password: parsedUrl.password ? decodeURIComponent(parsedUrl.password) : undefined,
    ssl: parsePgSslMode(parsedUrl.searchParams.get("sslmode")),
  };
}

function normalizeDbSecret(secret, fieldName) {
  const secretUrl = typeof secret.url === "string" && secret.url.trim() ? secret.url.trim() : "";
  const fromUrl = secretUrl ? parseDbSecretFromUrl(secretUrl, fieldName) : {};

  const host = secret.host || fromUrl.host;
  const database = secret.dbname || secret.database || fromUrl.database;
  const user = secret.username || secret.user || fromUrl.user;
  const password = secret.password || fromUrl.password;

  const rawPort = secret.port ?? fromUrl.port;
  const port = rawPort === undefined || rawPort === null || rawPort === ""
    ? undefined
    : Number(rawPort);
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) {
    throw new Error(`${fieldName} contains invalid port`);
  }

  let ssl;
  if (Object.prototype.hasOwnProperty.call(secret, "ssl")) {
    ssl = typeof secret.ssl === "boolean" ? secret.ssl : asBool(secret.ssl, false);
  } else if (Object.prototype.hasOwnProperty.call(secret, "sslmode")) {
    ssl = parsePgSslMode(secret.sslmode);
  } else {
    ssl = fromUrl.ssl;
  }

  if (!host || !database || !user || !password) {
    throw new Error(`${fieldName} must include host, dbname/database, username/user, and password`);
  }

  return {
    host,
    port,
    database,
    user,
    password,
    ssl,
  };
}

function loadDbSecretOverrides() {
  const secretJson = process.env.DB_CREDENTIALS_SECRET_JSON;
  const secretB64 = process.env.DB_CREDENTIALS_SECRET_BASE64;

  if (!secretJson && !secretB64) return null;

  const fieldName = secretJson ? "DB_CREDENTIALS_SECRET_JSON" : "DB_CREDENTIALS_SECRET_BASE64";
  const raw = secretJson || decodeMaybeBase64(secretB64, fieldName);
  const parsed = parseSecretJson(raw, fieldName);
  return {
    ...normalizeDbSecret(parsed, fieldName),
    source: fieldName,
  };
}

const dbSecretOverrides = loadDbSecretOverrides();

const config = {
  nodeEnv: process.env.NODE_ENV || "development",
  port: Number(process.env.PORT || 8080),
  cors: {
    allowedOrigins: asCsv(process.env.CORS_ALLOWED_ORIGINS),
  },
  db: {
    host: dbSecretOverrides?.host || process.env.DB_HOST || "127.0.0.1",
    port: dbSecretOverrides?.port ?? Number(process.env.DB_PORT || 5432),
    database: dbSecretOverrides?.database || process.env.DB_NAME || "agora",
    user: dbSecretOverrides?.user || process.env.DB_USER || "agora_user",
    password: dbSecretOverrides?.password || process.env.DB_PASSWORD || "",
    ssl: dbSecretOverrides?.ssl ?? asBool(process.env.DB_SSL, false),
    secretSource: dbSecretOverrides?.source || "",
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
    whatsapp: {
      provider: process.env.WHATSAPP_PROVIDER || "mock", // mock | webhook
      webhookUrl: process.env.WHATSAPP_WEBHOOK_URL || "",
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
  slo: {
    availabilityTargetPercent: Number(process.env.SLO_AVAILABILITY_TARGET_PERCENT || 99.9),
    shortWindowMinutes: Number(process.env.SLO_SHORT_WINDOW_MINUTES || 5),
    longWindowMinutes: Number(process.env.SLO_LONG_WINDOW_MINUTES || 60),
    burnRateWarning: Number(process.env.SLO_BURN_RATE_WARNING || 2),
    burnRateCritical: Number(process.env.SLO_BURN_RATE_CRITICAL || 4),
  },
  alerts: {
    workerQueueDepthWarning: Number(process.env.ALERT_WORKER_QUEUE_DEPTH_WARNING || 100),
    workerQueueDepthCritical: Number(process.env.ALERT_WORKER_QUEUE_DEPTH_CRITICAL || 500),
    workerOldestQueuedMinutesWarning: Number(process.env.ALERT_WORKER_OLDEST_QUEUED_MINUTES_WARNING || 10),
    workerOldestQueuedMinutesCritical: Number(process.env.ALERT_WORKER_OLDEST_QUEUED_MINUTES_CRITICAL || 30),
    workerFailedPendingWarning: Number(process.env.ALERT_WORKER_FAILED_PENDING_WARNING || 25),
    workerFailedPendingCritical: Number(process.env.ALERT_WORKER_FAILED_PENDING_CRITICAL || 100),
  },
  workerMetrics: {
    publishEnabled: asBool(process.env.WORKER_METRICS_PUBLISH_ENABLED, false),
    publishIntervalMs: Number(process.env.WORKER_METRICS_PUBLISH_INTERVAL_MS || 60000),
    publishRunOnce: asBool(process.env.WORKER_METRICS_PUBLISH_RUN_ONCE, false),
    namespace: process.env.WORKER_METRICS_NAMESPACE || "Agora/Workers",
    serviceDimension: process.env.WORKER_METRICS_SERVICE_DIMENSION || "agora-api",
    awsRegion:
      process.env.WORKER_METRICS_AWS_REGION ||
      process.env.AWS_REGION ||
      process.env.STORAGE_REGION ||
      "us-east-1",
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
  logLevel: process.env.LOG_LEVEL || "info",
  ai: {
    apiKey: process.env.OPENAI_API_KEY || "",
    model: process.env.AI_TUTOR_MODEL || "gpt-4o-mini",
    tokenBudgetPerSchool: Number(process.env.AI_TOKEN_BUDGET_PER_SCHOOL || 500000),
    maxContextTokens: Number(process.env.AI_MAX_CONTEXT_TOKENS || 4096),
  },
  timetableEngine: {
    baseUrl: process.env.TIMETABLE_ENGINE_BASE_URL || "http://127.0.0.1:8000",
    email: process.env.TIMETABLE_ENGINE_EMAIL || "admin@school.demo",
    password: process.env.TIMETABLE_ENGINE_PASSWORD || "demo123",
    timeoutMs: Number(process.env.TIMETABLE_ENGINE_TIMEOUT_MS || 30000),
    projectPrefix: process.env.TIMETABLE_ENGINE_PROJECT_PREFIX || "Agora",
  },
};

module.exports = config;
