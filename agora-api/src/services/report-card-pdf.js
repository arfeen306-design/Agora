const PDFDocument = require("pdfkit");

const COLORS = {
  ink: "#0f172a",
  slate: "#334155",
  muted: "#64748b",
  border: "#cbd5e1",
  softBorder: "#e2e8f0",
  white: "#ffffff",
  page: "#f8fafc",
  navy: "#0f172a",
  blue: "#2563eb",
  cyan: "#0ea5e9",
  green: "#16a34a",
  amber: "#d97706",
  purple: "#7c3aed",
  rose: "#e11d48",
  softBlue: "#eff6ff",
  softGreen: "#ecfdf5",
  softAmber: "#fffbeb",
  softPurple: "#f5f3ff",
  softRose: "#fff1f2",
};

function valueOrDash(value) {
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function numericValue(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return null;
  return Number(value);
}

function formatNumber(value, digits = 2) {
  const number = numericValue(value);
  if (number === null) return "-";
  const safeDigits = Number.isInteger(number) ? 0 : digits;
  return number.toFixed(safeDigits);
}

function formatPercentage(value) {
  const number = numericValue(value);
  if (number === null) return "-";
  return `${number.toFixed(1)}%`;
}

function formatDateLabel(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return valueOrDash(value);
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function toInitials(name) {
  const words = valueOrDash(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (!words.length) return "AG";
  return words.map((word) => word[0].toUpperCase()).join("");
}

function pageMetrics(doc) {
  return {
    left: doc.page.margins.left,
    right: doc.page.width - doc.page.margins.right,
    top: doc.page.margins.top,
    bottom: doc.page.height - doc.page.margins.bottom,
    width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
  };
}

function drawRoundedCard(doc, { x, y, width, height, radius = 14, fillColor = COLORS.white, strokeColor = COLORS.softBorder, lineWidth = 1 }) {
  doc.save();
  doc.roundedRect(x, y, width, height, radius);
  if (fillColor) {
    doc.fillAndStroke(fillColor, strokeColor || fillColor);
  } else {
    doc.lineWidth(lineWidth).strokeColor(strokeColor || COLORS.softBorder).stroke();
  }
  doc.restore();
}

function drawHeaderBand(doc, context) {
  const { left, width } = pageMetrics(doc);
  const headerHeight = 118;
  const y = 34;

  drawRoundedCard(doc, {
    x: left,
    y,
    width,
    height: headerHeight,
    radius: 20,
    fillColor: COLORS.navy,
    strokeColor: COLORS.navy,
  });

  doc.save();
  doc.circle(left + 36, y + 34, 24).fill(COLORS.blue);
  doc.restore();
  doc.fillColor(COLORS.white).font("Helvetica-Bold").fontSize(18).text(toInitials(context.school?.name), left + 22, y + 25, {
    width: 28,
    align: "center",
  });

  doc.fillColor(COLORS.white).font("Helvetica-Bold").fontSize(24).text(valueOrDash(context.school?.name), left + 74, y + 24, {
    width: width - 250,
  });
  doc.fillColor("#bfdbfe").font("Helvetica").fontSize(11).text("Academic Report Card", left + 74, y + 55);

  const chipWidth = 148;
  drawRoundedCard(doc, {
    x: left + width - chipWidth - 24,
    y: y + 20,
    width: chipWidth,
    height: 32,
    radius: 16,
    fillColor: "#13213b",
    strokeColor: "#1d4ed8",
  });
  doc.fillColor(COLORS.white).font("Helvetica-Bold").fontSize(10).text(valueOrDash(context.term?.name), left + width - chipWidth - 12, y + 30, {
    width: chipWidth - 24,
    align: "center",
  });

  doc.fillColor("#cbd5e1").font("Helvetica").fontSize(10);
  doc.text(`Term type: ${valueOrDash(context.term?.term_type)}`, left + width - 186, y + 66, { width: 162, align: "right" });
  doc.text(`Generated: ${formatDateLabel(new Date())}`, left + width - 186, y + 82, { width: 162, align: "right" });

  drawRoundedCard(doc, {
    x: left + 74,
    y: y + 74,
    width: 138,
    height: 28,
    radius: 14,
    fillColor: "#12233f",
    strokeColor: "#1e3a8a",
  });
  doc.fillColor("#dbeafe").font("Helvetica-Bold").fontSize(9).text(`Student Code: ${valueOrDash(context.student?.student_code)}`, left + 86, y + 84, {
    width: 114,
    align: "center",
  });

  return y + headerHeight + 18;
}

function drawMetricCard(doc, { x, y, width, height, label, value, hint, accent, tone }) {
  drawRoundedCard(doc, {
    x,
    y,
    width,
    height,
    radius: 16,
    fillColor: tone,
    strokeColor: accent,
  });

  doc.save();
  doc.roundedRect(x + 14, y + 14, 6, height - 28, 3).fill(accent);
  doc.restore();

  doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(8).text(label.toUpperCase(), x + 30, y + 16, {
    width: width - 44,
  });
  doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(20).text(value, x + 30, y + 30, {
    width: width - 44,
  });
  doc.fillColor(COLORS.slate).font("Helvetica").fontSize(9).text(hint, x + 30, y + 56, {
    width: width - 44,
  });
}

function drawInfoCard(doc, { x, y, width, height, title, rows }) {
  drawRoundedCard(doc, {
    x,
    y,
    width,
    height,
    radius: 16,
    fillColor: COLORS.white,
    strokeColor: COLORS.softBorder,
  });

  doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(12).text(title, x + 16, y + 14);

  let cursorY = y + 40;
  rows.forEach((row, index) => {
    doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(8).text(row.label.toUpperCase(), x + 16, cursorY, { width: width - 32 });
    cursorY += 11;
    doc.fillColor(COLORS.slate).font("Helvetica").fontSize(10).text(valueOrDash(row.value), x + 16, cursorY, { width: width - 32 });
    cursorY += 18;
    if (index < rows.length - 1) {
      doc.save();
      doc.moveTo(x + 16, cursorY - 2).lineTo(x + width - 16, cursorY - 2).lineWidth(1).strokeColor(COLORS.softBorder).stroke();
      doc.restore();
      cursorY += 8;
    }
  });
}

function ensureSpace(doc, requiredHeight, context) {
  const { bottom, left, width } = pageMetrics(doc);
  if (doc.y + requiredHeight <= bottom - 34) return;

  doc.addPage();
  drawRoundedCard(doc, {
    x: left,
    y: 34,
    width,
    height: 54,
    radius: 16,
    fillColor: COLORS.navy,
    strokeColor: COLORS.navy,
  });
  doc.fillColor(COLORS.white).font("Helvetica-Bold").fontSize(15).text(valueOrDash(context.school?.name), left + 18, 51);
  doc.fillColor("#cbd5e1").font("Helvetica").fontSize(10).text(
    `${valueOrDash(context.student?.full_name)}  |  ${valueOrDash(context.term?.name)}  |  ${valueOrDash(context.classroom?.label)}`,
    left + 18,
    67,
    { width: width - 36 }
  );
  doc.y = 104;
}

function drawSectionTitle(doc, title, subtitle) {
  doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(14).text(title, doc.page.margins.left, doc.y);
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(9).text(subtitle, doc.page.margins.left, doc.y + 18);
  doc.y += 34;
}

function categoryLabel(category) {
  if (!category) return null;
  const map = {
    extraordinary: "Extraordinary",
    good_better: "Good / Better",
    average: "Average",
    below_average: "Below Average",
    at_risk: "Student at Risk",
  };
  return map[category] || category;
}

function categoryTone(category) {
  const map = {
    extraordinary: { bg: COLORS.softGreen, fg: COLORS.green },
    good_better: { bg: COLORS.softBlue, fg: COLORS.blue },
    average: { bg: COLORS.softPurple, fg: COLORS.purple },
    below_average: { bg: COLORS.softAmber, fg: COLORS.amber },
    at_risk: { bg: COLORS.softRose, fg: COLORS.rose },
  };
  return map[category] || { bg: COLORS.softBlue, fg: COLORS.blue };
}

function drawCategoryPill(doc, { x, y, label, category }) {
  const tone = categoryTone(category);
  const textWidth = doc.widthOfString(label, { font: "Helvetica-Bold", size: 7 });
  const width = textWidth + 14;
  drawRoundedCard(doc, {
    x,
    y,
    width,
    height: 14,
    radius: 7,
    fillColor: tone.bg,
    strokeColor: tone.fg,
  });
  doc.fillColor(tone.fg).font("Helvetica-Bold").fontSize(7).text(label, x, y + 4, { width, align: "center" });
  return width;
}

function drawSubjectsTable(doc, { subjects, context }) {
  const { left, width } = pageMetrics(doc);
  const tableX = left;
  const column = {
    subject: 240,
    obtained: 68,
    max: 58,
    percentage: 70,
    grade: 51,
  };
  const tableWidth = column.subject + column.obtained + column.max + column.percentage + column.grade;
  const startX = tableX + Math.max(0, (width - tableWidth) / 2);

  const drawHeader = () => {
    ensureSpace(doc, 44, context);
    drawRoundedCard(doc, {
      x: startX,
      y: doc.y,
      width: tableWidth,
      height: 28,
      radius: 10,
      fillColor: COLORS.navy,
      strokeColor: COLORS.navy,
    });
    const headers = [
      { label: "Subject", x: startX + 12, width: column.subject - 18, align: "left" },
      { label: "Obtained", x: startX + column.subject, width: column.obtained, align: "center" },
      { label: "Max", x: startX + column.subject + column.obtained, width: column.max, align: "center" },
      { label: "%", x: startX + column.subject + column.obtained + column.max, width: column.percentage, align: "center" },
      { label: "Grade", x: startX + column.subject + column.obtained + column.max + column.percentage, width: column.grade, align: "center" },
    ];
    headers.forEach((item) => {
      doc.fillColor(COLORS.white).font("Helvetica-Bold").fontSize(9).text(item.label, item.x, doc.y + 10, {
        width: item.width,
        align: item.align,
      });
    });
    doc.y += 36;
  };

  drawHeader();

  if (!Array.isArray(subjects) || subjects.length === 0) {
    drawRoundedCard(doc, {
      x: startX,
      y: doc.y,
      width: tableWidth,
      height: 54,
      radius: 14,
      fillColor: COLORS.white,
      strokeColor: COLORS.softBorder,
    });
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(10).text("No subject marks have been published for this term yet.", startX, doc.y + 20, {
      width: tableWidth,
      align: "center",
    });
    doc.y += 68;
    return;
  }

  subjects.forEach((row, index) => {
    const subjectName = valueOrDash(row.subject_name);
    const commentText = row.teacher_comment ? `Recommendation: ${valueOrDash(row.teacher_comment)}` : "";
    doc.font("Helvetica-Bold").fontSize(10);
    const subjectHeight = doc.heightOfString(subjectName, {
      width: column.subject - 24,
      align: "left",
    });
    doc.font("Helvetica-Oblique").fontSize(8.5);
    const commentHeight = commentText
      ? doc.heightOfString(commentText, {
          width: tableWidth - 24,
          align: "left",
        })
      : 0;
    const pillHeight = row.comment_category ? 18 : 0;
    const rowHeight = Math.max(36, 14 + subjectHeight + (pillHeight ? 18 : 0) + commentHeight + 10);

    ensureSpace(doc, rowHeight + 8, context);
    const rowY = doc.y;

    drawRoundedCard(doc, {
      x: startX,
      y: rowY,
      width: tableWidth,
      height: rowHeight,
      radius: 12,
      fillColor: index % 2 === 0 ? COLORS.white : "#f8fbff",
      strokeColor: COLORS.softBorder,
    });

    const baseY = rowY + 10;
    doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(10).text(subjectName, startX + 12, baseY, {
      width: column.subject - 24,
    });

    let detailY = baseY + subjectHeight + 4;
    if (row.comment_category) {
      drawCategoryPill(doc, {
        x: startX + 12,
        y: detailY,
        label: categoryLabel(row.comment_category),
        category: row.comment_category,
      });
      detailY += 18;
    }

    if (commentText) {
      doc.fillColor(COLORS.muted).font("Helvetica-Oblique").fontSize(8.5).text(commentText, startX + 12, detailY, {
        width: tableWidth - 24,
      });
    }

    const topValueY = baseY + 2;
    const numericCells = [
      { value: formatNumber(row.marks_obtained), x: startX + column.subject, width: column.obtained },
      { value: formatNumber(row.max_marks), x: startX + column.subject + column.obtained, width: column.max },
      { value: formatPercentage(row.percentage), x: startX + column.subject + column.obtained + column.max, width: column.percentage },
      { value: valueOrDash(row.grade), x: startX + column.subject + column.obtained + column.max + column.percentage, width: column.grade },
    ];

    numericCells.forEach((cell) => {
      doc.fillColor(COLORS.slate).font("Helvetica-Bold").fontSize(10).text(cell.value, cell.x, topValueY, {
        width: cell.width,
        align: "center",
      });
    });

    doc.y = rowY + rowHeight + 8;
  });
}
function drawSummaryAndScale(doc, { summary, gradingScaleName, gradingBands, context }) {
  ensureSpace(doc, 250, context);
  const { left, width } = pageMetrics(doc);
  const gap = 14;
  const leftWidth = 320;
  const rightWidth = width - leftWidth - gap;
  const topY = doc.y;

  drawRoundedCard(doc, {
    x: left,
    y: topY,
    width: leftWidth,
    height: 176,
    radius: 16,
    fillColor: COLORS.white,
    strokeColor: COLORS.softBorder,
  });
  doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(12).text("Overall Summary", left + 16, topY + 14);

  const summaryRows = [
    ["Total Obtained", formatNumber(summary?.total_marks_obtained)],
    ["Total Maximum", formatNumber(summary?.total_max_marks)],
    ["Percentage", formatPercentage(summary?.percentage)],
    ["Overall Grade", valueOrDash(summary?.grade)],
    [
      "Attendance",
      `${valueOrDash(summary?.attendance_present)} / ${valueOrDash(summary?.attendance_total)}`,
    ],
  ];

  let summaryY = topY + 42;
  summaryRows.forEach(([label, value]) => {
    doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(8).text(label.toUpperCase(), left + 16, summaryY, { width: 130 });
    doc.fillColor(COLORS.slate).font("Helvetica-Bold").fontSize(10).text(value, left + 156, summaryY, { width: leftWidth - 172, align: "right" });
    summaryY += 23;
    doc.save();
    doc.moveTo(left + 16, summaryY - 6).lineTo(left + leftWidth - 16, summaryY - 6).lineWidth(1).strokeColor(COLORS.softBorder).stroke();
    doc.restore();
  });

  doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(8).text("REMARKS", left + 16, summaryY + 2);
  doc.fillColor(COLORS.slate).font("Helvetica").fontSize(10).text(valueOrDash(summary?.remarks), left + 16, summaryY + 16, {
    width: leftWidth - 32,
    height: 48,
  });

  drawRoundedCard(doc, {
    x: left + leftWidth + gap,
    y: topY,
    width: rightWidth,
    height: 176,
    radius: 16,
    fillColor: COLORS.white,
    strokeColor: COLORS.softBorder,
  });
  doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(12).text("Grading Scale", left + leftWidth + gap + 16, topY + 14);
  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(9).text(valueOrDash(gradingScaleName), left + leftWidth + gap + 16, topY + 30, {
    width: rightWidth - 32,
  });

  let bandY = topY + 54;
  (gradingBands || []).forEach((band, index) => {
    const bandHeight = 18;
    const bandX = left + leftWidth + gap + 16;
    const bandWidth = rightWidth - 32;
    drawRoundedCard(doc, {
      x: bandX,
      y: bandY,
      width: bandWidth,
      height: bandHeight,
      radius: 9,
      fillColor: index % 2 === 0 ? COLORS.softBlue : COLORS.page,
      strokeColor: COLORS.softBorder,
    });
    doc.fillColor(COLORS.ink).font("Helvetica-Bold").fontSize(8.5).text(valueOrDash(band.grade), bandX + 10, bandY + 5, { width: 32 });
    doc.fillColor(COLORS.slate).font("Helvetica").fontSize(8.5).text(`${formatNumber(band.min_percentage)} - ${formatNumber(band.max_percentage)}%`, bandX + 50, bandY + 5, { width: bandWidth - 60 });
    bandY += bandHeight + 6;
  });

  doc.y = topY + 192;
}

function drawSignatureBlock(doc, context) {
  ensureSpace(doc, 90, context);
  const { left, width } = pageMetrics(doc);
  const lineY = doc.y + 28;
  const firstX = left + 26;
  const secondX = left + width / 2 + 20;
  const lineWidth = 180;

  doc.save();
  doc.moveTo(firstX, lineY).lineTo(firstX + lineWidth, lineY).lineWidth(1).strokeColor(COLORS.border).stroke();
  doc.moveTo(secondX, lineY).lineTo(secondX + lineWidth, lineY).lineWidth(1).strokeColor(COLORS.border).stroke();
  doc.restore();

  doc.fillColor(COLORS.muted).font("Helvetica-Bold").fontSize(9).text("CLASS TEACHER", firstX, lineY + 6, { width: lineWidth, align: "center" });
  doc.text("PRINCIPAL", secondX, lineY + 6, { width: lineWidth, align: "center" });

  doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8.5).text(
    "This report card is computer generated and valid without a physical stamp when issued through Agora.",
    left,
    lineY + 34,
    { width, align: "center" }
  );

  doc.y = lineY + 60;
}

function addFooters(doc, context) {
  const range = doc.bufferedPageRange();
  for (let index = 0; index < range.count; index += 1) {
    doc.switchToPage(range.start + index);
    const { left, width, bottom } = pageMetrics(doc);
    const footerY = bottom - 18;
    doc.save();
    doc.moveTo(left, footerY - 6).lineTo(left + width, footerY - 6).lineWidth(1).strokeColor(COLORS.softBorder).stroke();
    doc.restore();
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8);
    doc.text(`${valueOrDash(context.school?.name)}  |  Confidential academic record`, left, footerY, {
      width: width / 2,
      align: "left",
      lineBreak: false,
    });
    doc.text(`Page ${index + 1} of ${range.count}`, left + width / 2, footerY, {
      width: width / 2,
      align: "right",
      lineBreak: false,
    });
  }
}

function buildReportCardPdfBuffer({
  school,
  student,
  classroom,
  term,
  summary,
  subjects,
  gradingScaleName,
  gradingBands,
}) {
  const context = { school, student, classroom, term };

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 36,
      size: "A4",
      bufferPages: true,
      info: {
        Title: `Report Card - ${valueOrDash(student?.full_name)}`,
        Author: valueOrDash(school?.name),
        Subject: `Academic Report Card - ${valueOrDash(term?.name)}`,
      },
    });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const { left, width } = pageMetrics(doc);

    doc.rect(0, 0, doc.page.width, doc.page.height).fill(COLORS.page);
    doc.fillColor(COLORS.ink);

    doc.y = drawHeaderBand(doc, context);

    const summaryCardsY = doc.y;
    const gap = 12;
    const cardWidth = (width - gap * 3) / 4;
    const cards = [
      {
        label: "Overall Percentage",
        value: formatPercentage(summary?.percentage),
        hint: "Combined term performance",
        accent: COLORS.blue,
        tone: COLORS.softBlue,
      },
      {
        label: "Overall Grade",
        value: valueOrDash(summary?.grade),
        hint: "Grading scale outcome",
        accent: COLORS.purple,
        tone: COLORS.softPurple,
      },
      {
        label: "Attendance",
        value: `${valueOrDash(summary?.attendance_present)} / ${valueOrDash(summary?.attendance_total)}`,
        hint: "Present days recorded",
        accent: COLORS.green,
        tone: COLORS.softGreen,
      },
      {
        label: "Total Marks",
        value: formatNumber(summary?.total_marks_obtained),
        hint: `Out of ${formatNumber(summary?.total_max_marks)} total marks`,
        accent: COLORS.amber,
        tone: COLORS.softAmber,
      },
    ];

    cards.forEach((card, index) => {
      drawMetricCard(doc, {
        ...card,
        x: left + index * (cardWidth + gap),
        y: summaryCardsY,
        width: cardWidth,
        height: 82,
      });
    });

    doc.y = summaryCardsY + 98;

    const infoCardHeight = 176;
    const infoLeftWidth = 250;
    const infoRightWidth = width - infoLeftWidth - gap;
    const infoCardsY = doc.y;
    drawInfoCard(doc, {
      x: left,
      y: infoCardsY,
      width: infoLeftWidth,
      height: infoCardHeight,
      title: "Student Profile",
      rows: [
        { label: "Student Name", value: student?.full_name },
        { label: "Student Code", value: student?.student_code },
        { label: "Roll Number", value: student?.roll_no },
        { label: "Class", value: classroom?.label },
      ],
    });
    drawInfoCard(doc, {
      x: left + infoLeftWidth + gap,
      y: infoCardsY,
      width: infoRightWidth,
      height: infoCardHeight,
      title: "Assessment Window",
      rows: [
        { label: "Term", value: term?.name },
        { label: "Term Type", value: term?.term_type },
        { label: "Issue Date", value: formatDateLabel(new Date()) },
        { label: "Grading Scale", value: gradingScaleName },
      ],
    });

    doc.y = infoCardsY + infoCardHeight + 22;
    drawSectionTitle(doc, "Subject Performance", "Detailed marks, grades, and teacher recommendations by subject.");
    drawSubjectsTable(doc, { subjects, context });

    drawSummaryAndScale(doc, { summary, gradingScaleName, gradingBands, context });
    drawSignatureBlock(doc, context);

    addFooters(doc, context);
    doc.end();
  });
}

module.exports = {
  buildReportCardPdfBuffer,
};
