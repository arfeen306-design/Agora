const XLSX = require("xlsx");

const MAX_IMPORT_ROWS = 2000;
const SUPPORTED_SOURCE_FORMATS = new Set(["csv", "xlsx", "xls"]);

const STUDENT_IMPORT_FIELDS = [
  {
    key: "student_code",
    required: true,
    aliases: ["student id", "student code", "student_code", "admission no", "admission number"],
  },
  {
    key: "student_full_name",
    required: false,
    aliases: ["student full name", "student name", "full name", "name"],
  },
  {
    key: "first_name",
    required: false,
    aliases: ["first name", "student first name"],
  },
  {
    key: "last_name",
    required: false,
    aliases: ["last name", "student last name", "surname"],
  },
  {
    key: "class_label",
    required: true,
    aliases: ["class", "grade", "class name", "grade label"],
  },
  {
    key: "section_label",
    required: true,
    aliases: ["section", "section name", "section label"],
  },
  {
    key: "roll_no",
    required: false,
    aliases: ["roll no", "roll number", "roll_no"],
  },
  {
    key: "date_of_birth",
    required: false,
    aliases: ["date of birth", "dob", "birth date"],
  },
  {
    key: "gender",
    required: false,
    aliases: ["gender", "sex"],
  },
  {
    key: "father_name",
    required: true,
    aliases: ["father name", "father", "guardian name"],
  },
  {
    key: "mother_name",
    required: false,
    aliases: ["mother name", "mother"],
  },
  {
    key: "whatsapp_number",
    required: true,
    aliases: ["whatsapp", "whatsapp number", "whatsapp no"],
  },
  {
    key: "mobile_number",
    required: true,
    aliases: ["mobile", "mobile number", "phone", "contact number", "guardian phone"],
  },
  {
    key: "email",
    required: false,
    aliases: ["email", "parent email", "guardian email"],
  },
  {
    key: "address_line",
    required: false,
    aliases: ["address", "home address"],
  },
  {
    key: "admission_date",
    required: true,
    aliases: ["admission date", "admitted on", "join date"],
  },
  {
    key: "fee_plan",
    required: false,
    aliases: ["fee plan", "plan", "fee plan title"],
  },
  {
    key: "guardian_relation",
    required: true,
    aliases: ["guardian relation", "relation", "relation to child"],
  },
  {
    key: "emergency_contact",
    required: true,
    aliases: ["emergency contact", "emergency number", "emergency phone"],
  },
  {
    key: "notes",
    required: false,
    aliases: ["notes", "remarks", "comments"],
  },
];

const STAFF_IMPORT_FIELDS = [
  {
    key: "staff_code",
    required: true,
    aliases: ["staff code", "employee id", "employee code", "staff id", "staff_code"],
  },
  {
    key: "staff_full_name",
    required: false,
    aliases: ["staff full name", "full name", "name"],
  },
  {
    key: "first_name",
    required: false,
    aliases: ["first name"],
  },
  {
    key: "last_name",
    required: false,
    aliases: ["last name", "surname"],
  },
  {
    key: "email",
    required: true,
    aliases: ["email", "email address"],
  },
  {
    key: "phone",
    required: false,
    aliases: ["phone", "mobile", "mobile number", "contact number"],
  },
  {
    key: "staff_type",
    required: true,
    aliases: ["staff type", "type", "category"],
  },
  {
    key: "role_code",
    required: false,
    aliases: ["role", "role code", "login role"],
  },
  {
    key: "designation",
    required: false,
    aliases: ["designation", "title", "job title"],
  },
  {
    key: "joining_date",
    required: false,
    aliases: ["joining date", "join date", "date of joining"],
  },
  {
    key: "employment_status",
    required: false,
    aliases: ["employment status", "status"],
  },
  {
    key: "primary_section_code",
    required: false,
    aliases: ["section code", "primary section code"],
  },
  {
    key: "primary_section_name",
    required: false,
    aliases: ["section", "section name", "primary section"],
  },
  {
    key: "reporting_manager_email",
    required: false,
    aliases: ["reporting manager email", "manager email"],
  },
  {
    key: "temporary_password",
    required: false,
    aliases: ["temporary password", "password", "temp password"],
  },
  {
    key: "id_document_no",
    required: false,
    aliases: ["id document no", "id number", "cnic", "nic"],
  },
];

const PARENT_IMPORT_FIELDS = [
  {
    key: "parent_full_name",
    required: false,
    aliases: ["parent full name", "guardian name", "full name", "name"],
  },
  {
    key: "first_name",
    required: false,
    aliases: ["first name", "parent first name"],
  },
  {
    key: "last_name",
    required: false,
    aliases: ["last name", "parent last name", "surname"],
  },
  {
    key: "email",
    required: false,
    aliases: ["email", "email address", "guardian email"],
  },
  {
    key: "phone",
    required: false,
    aliases: ["phone", "mobile", "mobile number", "contact number"],
  },
  {
    key: "whatsapp_number",
    required: false,
    aliases: ["whatsapp", "whatsapp number", "whatsapp no"],
  },
  {
    key: "guardian_name",
    required: false,
    aliases: ["guardian name", "father name", "father"],
  },
  {
    key: "father_name",
    required: false,
    aliases: ["father name", "father"],
  },
  {
    key: "mother_name",
    required: false,
    aliases: ["mother name", "mother"],
  },
  {
    key: "address_line",
    required: false,
    aliases: ["address", "home address"],
  },
  {
    key: "preferred_channel",
    required: false,
    aliases: ["preferred channel", "communication channel"],
  },
  {
    key: "linked_student_codes",
    required: false,
    aliases: ["student codes", "student code", "linked students", "linked student codes"],
  },
  {
    key: "relation_type",
    required: false,
    aliases: ["relation", "relation type", "guardian relation"],
  },
  {
    key: "is_primary",
    required: false,
    aliases: ["is primary", "primary guardian", "primary"],
  },
  {
    key: "temporary_password",
    required: false,
    aliases: ["temporary password", "password", "temp password"],
  },
  {
    key: "is_active",
    required: false,
    aliases: ["is active", "active", "status active"],
  },
];

function normalizeHeaderValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[_\-.]+/g, " ")
    .replace(/\s+/g, " ");
}

function normalizeLookupToken(value) {
  return normalizeHeaderValue(value);
}

function sanitizeCellValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  return String(value).trim();
}

function isRowEmpty(row) {
  if (!Array.isArray(row)) return true;
  return row.every((cell) => sanitizeCellValue(cell).length === 0);
}

function inferSourceFormat({ sourceFormat, sourceFileName }) {
  if (sourceFormat) {
    const normalized = String(sourceFormat).trim().toLowerCase();
    if (!SUPPORTED_SOURCE_FORMATS.has(normalized)) {
      throw new Error("Unsupported source format");
    }
    return normalized;
  }

  const filename = String(sourceFileName || "").toLowerCase();
  if (filename.endsWith(".csv")) return "csv";
  if (filename.endsWith(".xlsx")) return "xlsx";
  if (filename.endsWith(".xls")) return "xls";
  return "xlsx";
}

function decodeBase64File(fileBase64) {
  if (!fileBase64 || typeof fileBase64 !== "string") {
    throw new Error("file_base64 is required");
  }

  const payload = fileBase64.includes("base64,")
    ? fileBase64.slice(fileBase64.indexOf("base64,") + 7)
    : fileBase64;

  let buffer;
  try {
    buffer = Buffer.from(payload, "base64");
  } catch (_error) {
    throw new Error("Invalid base64 content");
  }

  if (!buffer || buffer.length === 0) {
    throw new Error("Uploaded file content is empty");
  }

  return buffer;
}

function parseTabularFile({ fileBase64, sourceFormat, sourceFileName }) {
  const resolvedFormat = inferSourceFormat({ sourceFormat, sourceFileName });
  const fileBuffer = decodeBase64File(fileBase64);

  let workbook;
  try {
    workbook = XLSX.read(fileBuffer, {
      type: "buffer",
      cellDates: true,
      raw: false,
      dense: true,
    });
  } catch (_error) {
    throw new Error("Failed to parse file. Ensure CSV or Excel format is valid");
  }

  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) {
    throw new Error("No worksheet found in uploaded file");
  }

  const firstSheet = workbook.Sheets[firstSheetName];
  const rows = XLSX.utils.sheet_to_json(firstSheet, {
    header: 1,
    defval: "",
    raw: false,
    blankrows: false,
  });

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error("Uploaded file has no rows");
  }

  const rawHeaders = rows[0].map((cell) => sanitizeCellValue(cell));
  const normalizedHeaders = rawHeaders.map((header) => normalizeHeaderValue(header));

  if (rawHeaders.length === 0 || normalizedHeaders.every((header) => !header)) {
    throw new Error("Uploaded file is missing header row");
  }

  const dataRows = rows.slice(1).filter((row) => !isRowEmpty(row));
  if (dataRows.length > MAX_IMPORT_ROWS) {
    throw new Error(`Maximum ${MAX_IMPORT_ROWS} data rows are supported per import`);
  }

  return {
    sourceFormat: resolvedFormat,
    headers: rawHeaders,
    normalizedHeaders,
    rows: dataRows,
  };
}

function buildFieldMappingForFields({ fields, headers, normalizedHeaders, providedMapping = {} }) {
  const mapping = {};
  const headerIndexByNormalized = new Map();

  normalizedHeaders.forEach((header, idx) => {
    if (!header) return;
    if (!headerIndexByNormalized.has(header)) {
      headerIndexByNormalized.set(header, idx);
    }
  });

  const exactHeaderIndex = new Map();
  headers.forEach((header, idx) => {
    if (!header) return;
    exactHeaderIndex.set(header, idx);
  });

  for (const field of fields) {
    const manualHeader = providedMapping[field.key];
    if (manualHeader && exactHeaderIndex.has(manualHeader)) {
      const index = exactHeaderIndex.get(manualHeader);
      mapping[field.key] = {
        header: manualHeader,
        index,
      };
      continue;
    }

    let matched = null;
    for (const alias of field.aliases) {
      const index = headerIndexByNormalized.get(normalizeHeaderValue(alias));
      if (typeof index === "number") {
        matched = {
          header: headers[index],
          index,
        };
        break;
      }
    }
    if (matched) {
      mapping[field.key] = matched;
    }
  }

  return mapping;
}

function buildFieldMapping({ headers, normalizedHeaders, providedMapping = {} }) {
  return buildFieldMappingForFields({
    fields: STUDENT_IMPORT_FIELDS,
    headers,
    normalizedHeaders,
    providedMapping,
  });
}

function parseStudentName({ fullName, firstName, lastName }) {
  const cleanFull = sanitizeCellValue(fullName);
  const cleanFirst = sanitizeCellValue(firstName);
  const cleanLast = sanitizeCellValue(lastName);

  if (cleanFirst) {
    return {
      first_name: cleanFirst,
      last_name: cleanLast || null,
    };
  }

  if (!cleanFull) {
    return {
      first_name: "",
      last_name: null,
    };
  }

  const parts = cleanFull.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return {
      first_name: parts[0],
      last_name: null,
    };
  }

  return {
    first_name: parts[0],
    last_name: parts.slice(1).join(" "),
  };
}

function parseDateToIso(value) {
  const raw = sanitizeCellValue(value);
  if (!raw) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const slashMatch = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slashMatch) {
    const first = Number(slashMatch[1]);
    const second = Number(slashMatch[2]);
    const yearRaw = Number(slashMatch[3]);
    const year = slashMatch[3].length === 2 ? (yearRaw >= 70 ? 1900 + yearRaw : 2000 + yearRaw) : yearRaw;
    let day = first;
    let month = second;

    // Handle both dd/mm and mm/dd imports, preferring mm/dd for ambiguous values
    // because Excel commonly emits m/d/yy when exporting loose sheets.
    if (first <= 12 && second > 12) {
      month = first;
      day = second;
    } else if (first <= 12 && second <= 12) {
      month = first;
      day = second;
    }

    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}-${String(parsed.getUTCDate()).padStart(2, "0")}`;
}

function parseInteger(value) {
  const raw = sanitizeCellValue(value);
  if (!raw) return null;
  const numeric = Number(raw);
  if (!Number.isInteger(numeric) || numeric <= 0) return null;
  return numeric;
}

function normalizeStudentImportRow({ row, rowNumber, mapping }) {
  function fromField(fieldKey) {
    const config = mapping[fieldKey];
    if (typeof config === "number") {
      return sanitizeCellValue(row[config]);
    }
    if (!config || typeof config.index !== "number") return "";
    return sanitizeCellValue(row[config.index]);
  }

  const errors = [];
  const normalized = {
    row_number: rowNumber,
    student_code: fromField("student_code").toUpperCase(),
    class_label: fromField("class_label"),
    section_label: fromField("section_label"),
    roll_no: parseInteger(fromField("roll_no")),
    date_of_birth: parseDateToIso(fromField("date_of_birth")),
    gender: fromField("gender") || null,
    father_name: fromField("father_name"),
    mother_name: fromField("mother_name") || null,
    whatsapp_number: fromField("whatsapp_number"),
    mobile_number: fromField("mobile_number"),
    email: fromField("email").toLowerCase() || null,
    address_line: fromField("address_line") || null,
    admission_date: parseDateToIso(fromField("admission_date")),
    fee_plan: fromField("fee_plan") || null,
    guardian_relation: fromField("guardian_relation").toLowerCase() || null,
    emergency_contact: fromField("emergency_contact"),
    notes: fromField("notes") || null,
  };

  const name = parseStudentName({
    fullName: fromField("student_full_name"),
    firstName: fromField("first_name"),
    lastName: fromField("last_name"),
  });
  normalized.first_name = name.first_name;
  normalized.last_name = name.last_name;

  for (const field of STUDENT_IMPORT_FIELDS) {
    if (!field.required) continue;

    if (field.key === "admission_date") {
      if (!normalized.admission_date) {
        errors.push({
          row_number: rowNumber,
          field_name: field.key,
          issue: "Admission date is required and must be a valid date",
          raw_value: sanitizeCellValue(fromField("admission_date")),
        });
      }
      continue;
    }

    if (field.key === "student_full_name") {
      // Handled by first_name fallback below.
      continue;
    }

    const value = normalized[field.key];
    if (value === null || value === undefined || String(value).trim().length === 0) {
      errors.push({
        row_number: rowNumber,
        field_name: field.key,
        issue: "Required field is missing",
        raw_value: sanitizeCellValue(fromField(field.key)),
      });
    }
  }

  if (!normalized.first_name) {
    errors.push({
      row_number: rowNumber,
      field_name: "student_full_name",
      issue: "Student full name or first name is required",
      raw_value: sanitizeCellValue(fromField("student_full_name") || fromField("first_name")),
    });
  }

  if (normalized.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email)) {
    errors.push({
      row_number: rowNumber,
      field_name: "email",
      issue: "Invalid email format",
      raw_value: normalized.email,
    });
  }

  return {
    normalized,
    errors,
  };
}

function parsePersonName({ fullName, firstName, lastName, fallbackFirst = "" }) {
  const cleanFull = sanitizeCellValue(fullName);
  const cleanFirst = sanitizeCellValue(firstName);
  const cleanLast = sanitizeCellValue(lastName);

  if (cleanFirst) {
    return {
      first_name: cleanFirst,
      last_name: cleanLast || null,
    };
  }

  if (!cleanFull) {
    return {
      first_name: fallbackFirst,
      last_name: null,
    };
  }

  const parts = cleanFull.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return {
      first_name: parts[0],
      last_name: null,
    };
  }

  return {
    first_name: parts[0],
    last_name: parts.slice(1).join(" "),
  };
}

function parseBoolean(value, defaultValue = false) {
  const raw = sanitizeCellValue(value).toLowerCase();
  if (!raw) return defaultValue;
  if (["1", "true", "yes", "y"].includes(raw)) return true;
  if (["0", "false", "no", "n"].includes(raw)) return false;
  return defaultValue;
}

function parseCsvLikeList(value) {
  const raw = sanitizeCellValue(value);
  if (!raw) return [];
  return raw
    .split(/[|,;]+/g)
    .map((part) => sanitizeCellValue(part))
    .filter(Boolean);
}

function normalizeStaffImportRow({ row, rowNumber, mapping }) {
  function fromField(fieldKey) {
    const config = mapping[fieldKey];
    if (typeof config === "number") {
      return sanitizeCellValue(row[config]);
    }
    if (!config || typeof config.index !== "number") return "";
    return sanitizeCellValue(row[config.index]);
  }

  const errors = [];
  const normalized = {
    row_number: rowNumber,
    staff_code: fromField("staff_code").toUpperCase(),
    email: fromField("email").toLowerCase(),
    phone: fromField("phone") || null,
    staff_type: fromField("staff_type").toLowerCase() || null,
    role_code: fromField("role_code").toLowerCase() || null,
    designation: fromField("designation") || null,
    joining_date: parseDateToIso(fromField("joining_date")),
    employment_status: fromField("employment_status") || "active",
    primary_section_code: fromField("primary_section_code") || null,
    primary_section_name: fromField("primary_section_name") || null,
    reporting_manager_email: fromField("reporting_manager_email").toLowerCase() || null,
    temporary_password: fromField("temporary_password") || "ChangeMe123!",
    id_document_no: fromField("id_document_no") || null,
  };

  const name = parsePersonName({
    fullName: fromField("staff_full_name"),
    firstName: fromField("first_name"),
    lastName: fromField("last_name"),
  });

  normalized.first_name = name.first_name;
  normalized.last_name = name.last_name;

  for (const field of STAFF_IMPORT_FIELDS) {
    if (!field.required) continue;
    const value = normalized[field.key];
    if (value === null || value === undefined || String(value).trim().length === 0) {
      errors.push({
        row_number: rowNumber,
        field_name: field.key,
        issue: "Required field is missing",
        raw_value: sanitizeCellValue(fromField(field.key)),
      });
    }
  }

  if (!normalized.first_name) {
    errors.push({
      row_number: rowNumber,
      field_name: "staff_full_name",
      issue: "Staff full name or first name is required",
      raw_value: sanitizeCellValue(fromField("staff_full_name") || fromField("first_name")),
    });
  }

  if (normalized.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email)) {
    errors.push({
      row_number: rowNumber,
      field_name: "email",
      issue: "Invalid email format",
      raw_value: normalized.email,
    });
  }

  return {
    normalized,
    errors,
  };
}

function normalizeParentImportRow({ row, rowNumber, mapping }) {
  function fromField(fieldKey) {
    const config = mapping[fieldKey];
    if (typeof config === "number") {
      return sanitizeCellValue(row[config]);
    }
    if (!config || typeof config.index !== "number") return "";
    return sanitizeCellValue(row[config.index]);
  }

  const errors = [];
  const normalized = {
    row_number: rowNumber,
    email: fromField("email").toLowerCase() || null,
    phone: fromField("phone") || null,
    whatsapp_number: fromField("whatsapp_number") || null,
    guardian_name: fromField("guardian_name") || null,
    father_name: fromField("father_name") || null,
    mother_name: fromField("mother_name") || null,
    address_line: fromField("address_line") || null,
    preferred_channel: fromField("preferred_channel").toLowerCase() || "in_app",
    linked_student_codes: parseCsvLikeList(fromField("linked_student_codes")),
    relation_type: fromField("relation_type").toLowerCase() || "guardian",
    is_primary: parseBoolean(fromField("is_primary"), false),
    temporary_password: fromField("temporary_password") || "ChangeMe123!",
    is_active: parseBoolean(fromField("is_active"), true),
  };

  const name = parsePersonName({
    fullName: fromField("parent_full_name"),
    firstName: fromField("first_name"),
    lastName: fromField("last_name"),
    fallbackFirst: "Guardian",
  });

  normalized.first_name = name.first_name;
  normalized.last_name = name.last_name;

  if (!normalized.first_name) {
    errors.push({
      row_number: rowNumber,
      field_name: "parent_full_name",
      issue: "Parent full name or first name is required",
      raw_value: sanitizeCellValue(fromField("parent_full_name") || fromField("first_name")),
    });
  }

  if (
    normalized.preferred_channel &&
    !["in_app", "push", "email", "sms"].includes(normalized.preferred_channel)
  ) {
    errors.push({
      row_number: rowNumber,
      field_name: "preferred_channel",
      issue: "preferred_channel must be one of in_app, push, email, sms",
      raw_value: normalized.preferred_channel,
    });
  }

  if (normalized.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized.email)) {
    errors.push({
      row_number: rowNumber,
      field_name: "email",
      issue: "Invalid email format",
      raw_value: normalized.email,
    });
  }

  return {
    normalized,
    errors,
  };
}

module.exports = {
  MAX_IMPORT_ROWS,
  STUDENT_IMPORT_FIELDS,
  STAFF_IMPORT_FIELDS,
  PARENT_IMPORT_FIELDS,
  buildFieldMapping,
  buildFieldMappingForFields,
  normalizeHeaderValue,
  normalizeLookupToken,
  parseTabularFile,
  normalizeStudentImportRow,
  normalizeStaffImportRow,
  normalizeParentImportRow,
};
