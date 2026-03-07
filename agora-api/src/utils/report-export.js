const PDFDocument = require("pdfkit");

function formatCell(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function csvEscape(value) {
  const cell = formatCell(value);
  if (/[",\n]/.test(cell)) {
    return `"${cell.replace(/"/g, '""')}"`;
  }
  return cell;
}

function buildCsvBuffer({ columns, rows }) {
  const header = columns.map((column) => csvEscape(column.label)).join(",");
  const lines = [header];

  for (const row of rows) {
    lines.push(columns.map((column) => csvEscape(row[column.key])).join(","));
  }

  return Buffer.from(`${lines.join("\n")}\n`, "utf8");
}

function buildPdfBuffer({ title, subtitle, columns, rows }) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 36,
      size: "A4",
      info: {
        Title: title,
      },
    });
    const chunks = [];

    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).text(title);
    if (subtitle) {
      doc.moveDown(0.2);
      doc.fontSize(10).fillColor("#666666").text(subtitle);
      doc.fillColor("#000000");
    }

    doc.moveDown(0.6);
    doc.fontSize(10).text(columns.map((column) => column.label).join(" | "));
    doc.moveDown(0.2);

    if (rows.length === 0) {
      doc.fontSize(10).text("No rows found.");
      doc.end();
      return;
    }

    for (const row of rows) {
      const line = columns.map((column) => formatCell(row[column.key])).join(" | ");
      doc.fontSize(9).text(line, {
        width: 520,
      });
      if (doc.y > 760) {
        doc.addPage();
      }
    }

    doc.end();
  });
}

function getReportFileName({ reportKey, ext }) {
  const date = new Date().toISOString().slice(0, 10);
  return `agora_${reportKey}_report_${date}.${ext}`;
}

module.exports = {
  buildCsvBuffer,
  buildPdfBuffer,
  getReportFileName,
};
