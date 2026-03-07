const crypto = require("crypto");
const fs = require("fs/promises");
const path = require("path");
const { S3Client, PutObjectCommand, GetObjectCommand } = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");
const { Storage } = require("@google-cloud/storage");

const config = require("../config");
const AppError = require("./app-error");

function sanitizeFileName(fileName) {
  const cleaned = String(fileName || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned.length > 0 ? cleaned.slice(0, 180) : "file";
}

function buildObjectKey({ schoolId, scope, fileName }) {
  const safeName = sanitizeFileName(fileName);
  const date = new Date();
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${schoolId}/${scope}/${yyyy}/${mm}/${dd}/${crypto.randomUUID()}-${safeName}`;
}

function normalizedBaseUrl(baseUrl) {
  if (!baseUrl) return "";
  return String(baseUrl).replace(/\/+$/g, "");
}

function isProvider(provider) {
  return ["local", "s3", "gcs"].includes(provider);
}

function ensureProviderSupported() {
  if (!isProvider(config.storage.provider)) {
    throw new AppError(500, "CONFIG_ERROR", `Unsupported STORAGE_PROVIDER: ${config.storage.provider}`);
  }
}

function createS3Client() {
  const credentials =
    config.storage.accessKeyId && config.storage.secretAccessKey
      ? {
          accessKeyId: config.storage.accessKeyId,
          secretAccessKey: config.storage.secretAccessKey,
        }
      : undefined;

  return new S3Client({
    region: config.storage.region,
    endpoint: config.storage.endpoint || undefined,
    forcePathStyle: config.storage.forcePathStyle,
    credentials,
  });
}

function createGcsClient() {
  const hasInlineCreds = config.storage.gcsClientEmail && config.storage.gcsPrivateKey;
  const credentials = hasInlineCreds
    ? {
        client_email: config.storage.gcsClientEmail,
        private_key: config.storage.gcsPrivateKey.replace(/\\n/g, "\n"),
      }
    : undefined;

  return new Storage({
    projectId: config.storage.gcsProjectId || undefined,
    keyFilename: config.storage.gcsKeyFilename || undefined,
    credentials,
  });
}

function signLocalToken(payload) {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", config.storage.localSigningSecret)
    .update(encodedPayload)
    .digest("base64url");
  return `${encodedPayload}.${signature}`;
}

function verifyLocalToken(token, expectedAction) {
  const tokenParts = String(token || "").split(".");
  if (tokenParts.length !== 2) {
    throw new AppError(401, "UNAUTHORIZED", "Invalid signed file token");
  }

  const [encodedPayload, incomingSignature] = tokenParts;
  const expectedSignature = crypto
    .createHmac("sha256", config.storage.localSigningSecret)
    .update(encodedPayload)
    .digest("base64url");

  if (incomingSignature.length !== expectedSignature.length) {
    throw new AppError(401, "UNAUTHORIZED", "Invalid signed file token");
  }
  if (!crypto.timingSafeEqual(Buffer.from(incomingSignature), Buffer.from(expectedSignature))) {
    throw new AppError(401, "UNAUTHORIZED", "Invalid signed file token");
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8"));
  } catch (_e) {
    throw new AppError(401, "UNAUTHORIZED", "Invalid signed file token payload");
  }

  const nowEpoch = Math.floor(Date.now() / 1000);
  if (!payload.exp || nowEpoch > payload.exp) {
    throw new AppError(401, "UNAUTHORIZED", "Signed file token has expired");
  }
  if (payload.act !== expectedAction) {
    throw new AppError(401, "UNAUTHORIZED", "Invalid signed file token action");
  }
  if (!payload.obj || typeof payload.obj !== "string") {
    throw new AppError(401, "UNAUTHORIZED", "Invalid signed file token object");
  }

  return payload;
}

function getLocalPathForObjectKey(objectKey) {
  const baseDir = path.resolve(config.storage.localBaseDir);
  const cleanObjectKey = String(objectKey || "").replace(/^\/+/, "");
  const targetPath = path.resolve(baseDir, cleanObjectKey);

  if (!targetPath.startsWith(baseDir + path.sep) && targetPath !== baseDir) {
    throw new AppError(400, "VALIDATION_ERROR", "Invalid object key path");
  }

  return targetPath;
}

async function saveLocalObject({ objectKey, data, contentType }) {
  const targetPath = getLocalPathForObjectKey(objectKey);
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, data);
  await fs.writeFile(
    `${targetPath}.meta.json`,
    JSON.stringify({ content_type: contentType || "application/octet-stream" })
  );
}

async function readLocalObject(objectKey) {
  const targetPath = getLocalPathForObjectKey(objectKey);
  let data;
  try {
    data = await fs.readFile(targetPath);
  } catch (_e) {
    throw new AppError(404, "NOT_FOUND", "File not found");
  }

  let contentType = "application/octet-stream";
  try {
    const meta = JSON.parse(await fs.readFile(`${targetPath}.meta.json`, "utf8"));
    if (meta && typeof meta.content_type === "string") {
      contentType = meta.content_type;
    }
  } catch (_e) {
    // Metadata file is optional; fallback content type is fine.
  }

  return { data, contentType };
}

async function createUploadTarget({ objectKey, contentType, expiresInSeconds, baseUrl, maxUploadBytes }) {
  ensureProviderSupported();
  const ttl = Number(expiresInSeconds || config.storage.signedUrlExpiresIn);

  if (config.storage.provider === "s3") {
    const s3 = createS3Client();
    const command = new PutObjectCommand({
      Bucket: config.storage.bucket,
      Key: objectKey,
      ContentType: contentType,
    });
    const url = await getSignedUrl(s3, command, { expiresIn: ttl });
    return {
      provider: "s3",
      method: "PUT",
      url,
      headers: {
        "Content-Type": contentType,
      },
      expires_in: ttl,
    };
  }

  if (config.storage.provider === "gcs") {
    const storage = createGcsClient();
    const bucket = storage.bucket(config.storage.bucket);
    const file = bucket.file(objectKey);
    const [url] = await file.getSignedUrl({
      version: "v4",
      action: "write",
      expires: Date.now() + ttl * 1000,
      contentType,
    });

    return {
      provider: "gcs",
      method: "PUT",
      url,
      headers: {
        "Content-Type": contentType,
      },
      expires_in: ttl,
    };
  }

  const token = signLocalToken({
    v: 1,
    act: "upload",
    obj: objectKey,
    ct: contentType,
    max: Number(maxUploadBytes || config.storage.maxUploadBytes),
    exp: Math.floor(Date.now() / 1000) + ttl,
  });
  return {
    provider: "local",
    method: "PUT",
    url: `${normalizedBaseUrl(baseUrl)}/api/v1/files/local/upload/${encodeURIComponent(token)}`,
    headers: {
      "Content-Type": contentType,
    },
    expires_in: ttl,
  };
}

async function createDownloadTarget({ objectKey, expiresInSeconds, baseUrl }) {
  ensureProviderSupported();
  const ttl = Number(expiresInSeconds || config.storage.signedUrlExpiresIn);

  if (config.storage.provider === "s3") {
    const s3 = createS3Client();
    const command = new GetObjectCommand({
      Bucket: config.storage.bucket,
      Key: objectKey,
    });
    const url = await getSignedUrl(s3, command, { expiresIn: ttl });
    return {
      provider: "s3",
      method: "GET",
      url,
      headers: {},
      expires_in: ttl,
    };
  }

  if (config.storage.provider === "gcs") {
    const storage = createGcsClient();
    const bucket = storage.bucket(config.storage.bucket);
    const file = bucket.file(objectKey);
    const [url] = await file.getSignedUrl({
      version: "v4",
      action: "read",
      expires: Date.now() + ttl * 1000,
    });

    return {
      provider: "gcs",
      method: "GET",
      url,
      headers: {},
      expires_in: ttl,
    };
  }

  const token = signLocalToken({
    v: 1,
    act: "download",
    obj: objectKey,
    exp: Math.floor(Date.now() / 1000) + ttl,
  });
  return {
    provider: "local",
    method: "GET",
    url: `${normalizedBaseUrl(baseUrl)}/api/v1/files/local/download/${encodeURIComponent(token)}`,
    headers: {},
    expires_in: ttl,
  };
}

function verifyLocalUploadToken(token) {
  return verifyLocalToken(token, "upload");
}

function verifyLocalDownloadToken(token) {
  return verifyLocalToken(token, "download");
}

module.exports = {
  sanitizeFileName,
  buildObjectKey,
  createUploadTarget,
  createDownloadTarget,
  saveLocalObject,
  readLocalObject,
  verifyLocalUploadToken,
  verifyLocalDownloadToken,
};
