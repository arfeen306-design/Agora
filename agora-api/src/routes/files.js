const express = require("express");
const { z } = require("zod");

const config = require("../config");
const { requireAuth } = require("../middleware/auth");
const AppError = require("../utils/app-error");
const asyncHandler = require("../utils/async-handler");
const { success } = require("../utils/http");
const {
  sanitizeFileName,
  buildObjectKey,
  createUploadTarget,
  createDownloadTarget,
  saveLocalObject,
  readLocalObject,
  verifyLocalUploadToken,
  verifyLocalDownloadToken,
} = require("../utils/storage");

const router = express.Router();

const fileScopeSchema = z.enum(["homework", "submission", "message", "profile", "general"]);

const createUploadUrlSchema = z.object({
  scope: fileScopeSchema.default("general"),
  file_name: z.string().trim().min(1).max(255),
  content_type: z.string().trim().min(3).max(120),
  size_bytes: z.coerce.number().int().positive().max(1024 * 1024 * 100).optional(), // hard cap 100MB
});

const createDownloadUrlSchema = z.object({
  object_key: z.string().trim().min(8).max(1024),
});

function parseSchema(schema, input, message = "Invalid request input") {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new AppError(
      422,
      "VALIDATION_ERROR",
      message,
      parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        issue: issue.message,
      }))
    );
  }
  return parsed.data;
}

function getBaseUrl(req) {
  if (config.storage.publicBaseUrl) {
    return config.storage.publicBaseUrl;
  }
  return `${req.protocol}://${req.get("host")}`;
}

function assertObjectBelongsToSchoolOrThrow({ objectKey, schoolId }) {
  const expectedPrefix = `${schoolId}/`;
  if (!String(objectKey).startsWith(expectedPrefix)) {
    throw new AppError(403, "FORBIDDEN", "Object key does not belong to your school");
  }
}

router.post(
  "/files/upload-url",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parseSchema(createUploadUrlSchema, req.body, "Invalid upload URL payload");
    const sizeBytes = body.size_bytes || config.storage.maxUploadBytes;
    if (sizeBytes > config.storage.maxUploadBytes) {
      throw new AppError(
        422,
        "VALIDATION_ERROR",
        `File size exceeds allowed limit (${config.storage.maxUploadBytes} bytes)`
      );
    }

    const objectKey = buildObjectKey({
      schoolId: req.auth.schoolId,
      scope: body.scope,
      fileName: sanitizeFileName(body.file_name),
    });

    const upload = await createUploadTarget({
      objectKey,
      contentType: body.content_type,
      expiresInSeconds: config.storage.signedUrlExpiresIn,
      baseUrl: getBaseUrl(req),
      maxUploadBytes: sizeBytes,
    });

    const download = await createDownloadTarget({
      objectKey,
      expiresInSeconds: config.storage.signedUrlExpiresIn,
      baseUrl: getBaseUrl(req),
    });

    return success(
      res,
      {
        provider: config.storage.provider,
        bucket: config.storage.bucket,
        object_key: objectKey,
        upload,
        download,
      },
      200
    );
  })
);

router.post(
  "/files/download-url",
  requireAuth,
  asyncHandler(async (req, res) => {
    const body = parseSchema(createDownloadUrlSchema, req.body, "Invalid download URL payload");
    assertObjectBelongsToSchoolOrThrow({
      objectKey: body.object_key,
      schoolId: req.auth.schoolId,
    });

    const download = await createDownloadTarget({
      objectKey: body.object_key,
      expiresInSeconds: config.storage.signedUrlExpiresIn,
      baseUrl: getBaseUrl(req),
    });

    return success(
      res,
      {
        provider: config.storage.provider,
        bucket: config.storage.bucket,
        object_key: body.object_key,
        download,
      },
      200
    );
  })
);

router.put(
  "/files/local/upload/:token",
  express.raw({ type: "*/*", limit: `${Math.ceil(config.storage.maxUploadBytes / (1024 * 1024)) + 1}mb` }),
  asyncHandler(async (req, res) => {
    if (config.storage.provider !== "local") {
      throw new AppError(404, "NOT_FOUND", "Local storage upload endpoint is disabled");
    }

    const token = req.params.token;
    const payload = verifyLocalUploadToken(token);
    const incomingType = String(req.header("content-type") || "").split(";")[0].trim();
    if (payload.ct && incomingType && payload.ct !== incomingType) {
      throw new AppError(422, "VALIDATION_ERROR", "Content-Type does not match signed upload token");
    }

    const bodyBuffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from([]);
    if (bodyBuffer.length === 0) {
      throw new AppError(422, "VALIDATION_ERROR", "Upload body cannot be empty");
    }
    if (payload.max && bodyBuffer.length > payload.max) {
      throw new AppError(422, "VALIDATION_ERROR", "Uploaded file is larger than allowed by signed URL");
    }

    await saveLocalObject({
      objectKey: payload.obj,
      data: bodyBuffer,
      contentType: payload.ct || incomingType || "application/octet-stream",
    });

    return success(
      res,
      {
        uploaded: true,
        object_key: payload.obj,
        size_bytes: bodyBuffer.length,
      },
      200
    );
  })
);

router.get(
  "/files/local/download/:token",
  asyncHandler(async (req, res) => {
    if (config.storage.provider !== "local") {
      throw new AppError(404, "NOT_FOUND", "Local storage download endpoint is disabled");
    }

    const token = req.params.token;
    const payload = verifyLocalDownloadToken(token);
    const file = await readLocalObject(payload.obj);

    res.setHeader("Content-Type", file.contentType);
    return res.status(200).send(file.data);
  })
);

module.exports = router;
