/**
 * Notification Templates
 *
 * Pre-defined templates for all event types with variable interpolation.
 * Template keys match event_type values in notification_preferences.
 */

const TEMPLATES = {
  // ─── Attendance ───────────────────────────────────────────────────
  "attendance.absent": {
    title: "Absent Today",
    body: "{{student_name}} was marked absent on {{date}}.",
    channels: ["in_app", "push", "sms"],
  },
  "attendance.late": {
    title: "Late Arrival",
    body: "{{student_name}} arrived late at {{time}} on {{date}}.",
    channels: ["in_app", "push"],
  },
  "attendance.leave": {
    title: "On Leave",
    body: "{{student_name}} is on approved leave for {{date}}.",
    channels: ["in_app"],
  },

  // ─── Homework ────────────────────────────────────────────────────
  "homework.assigned": {
    title: "New Homework: {{subject_name}}",
    body: "\"{{homework_title}}\" has been assigned. Due: {{due_date}}.",
    channels: ["in_app", "push"],
  },
  "homework.due_reminder": {
    title: "Homework Due Soon",
    body: "\"{{homework_title}}\" for {{subject_name}} is due {{due_date}}.",
    channels: ["in_app", "push"],
  },
  "homework.graded": {
    title: "Homework Graded",
    body: "\"{{homework_title}}\" has been graded. Score: {{score}}.",
    channels: ["in_app", "push"],
  },

  // ─── Fees ────────────────────────────────────────────────────────
  "fee.invoice_due": {
    title: "Fee Invoice Due",
    body: "Fee of {{amount}} is due on {{due_date}} for {{student_name}}.",
    channels: ["in_app", "push", "sms", "email"],
  },
  "fee.payment_received": {
    title: "Payment Received",
    body: "Payment of {{amount}} has been received for {{student_name}}. Thank you!",
    channels: ["in_app", "push"],
  },
  "fee.overdue": {
    title: "Fee Overdue",
    body: "Fee of {{amount}} for {{student_name}} is overdue. Please pay at your earliest.",
    channels: ["in_app", "push", "sms", "email"],
  },

  // ─── Transport ───────────────────────────────────────────────────
  "transport.route_changed": {
    title: "Transport Route Updated",
    body: "Route \"{{route_name}}\" has been updated. Please check the latest schedule.",
    channels: ["in_app", "push", "sms"],
  },
  "transport.delay_alert": {
    title: "Transport Delay",
    body: "Route \"{{route_name}}\" is experiencing a delay. Estimated delay: {{delay_minutes}} minutes.",
    channels: ["in_app", "push", "sms"],
  },
  "transport.assignment_changed": {
    title: "Transport Assignment Updated",
    body: "{{student_name}}'s transport assignment has been updated to route \"{{route_name}}\".",
    channels: ["in_app", "push"],
  },

  // ─── Library ─────────────────────────────────────────────────────
  "library.book_issued": {
    title: "Book Issued",
    body: "\"{{book_title}}\" has been issued. Due date: {{due_date}}.",
    channels: ["in_app"],
  },
  "library.book_due": {
    title: "Book Due Soon",
    body: "\"{{book_title}}\" is due on {{due_date}}. Please return it on time.",
    channels: ["in_app", "push"],
  },
  "library.overdue_fine": {
    title: "Library Overdue Fine",
    body: "\"{{book_title}}\" is overdue. A fine of {{fine_amount}} has been applied.",
    channels: ["in_app", "push", "sms"],
  },
  "library.book_returned": {
    title: "Book Returned",
    body: "\"{{book_title}}\" has been returned successfully.",
    channels: ["in_app"],
  },

  // ─── AI Tutor ────────────────────────────────────────────────────
  "tutor.session_summary": {
    title: "Tutoring Session Summary",
    body: "{{student_name}} completed a tutoring session on {{topic}}. {{summary}}",
    channels: ["in_app"],
  },
  "tutor.budget_warning": {
    title: "AI Tutor Budget Warning",
    body: "Your school's AI tutor budget is {{percent_used}}% used this month. {{remaining_tokens}} tokens remaining.",
    channels: ["in_app", "email"],
  },

  // ─── Discipline ──────────────────────────────────────────────────
  "discipline.incident_reported": {
    title: "Discipline Incident",
    body: "A {{severity}} incident has been reported for {{student_name}}: {{description}}.",
    channels: ["in_app", "push", "sms"],
  },
  "discipline.resolved": {
    title: "Discipline Incident Resolved",
    body: "The discipline incident for {{student_name}} has been resolved.",
    channels: ["in_app", "push"],
  },

  // ─── Leave ───────────────────────────────────────────────────────
  "leave.request_submitted": {
    title: "Leave Request Submitted",
    body: "{{staff_name}} has submitted a {{leave_type}} leave request from {{start_date}} to {{end_date}}.",
    channels: ["in_app", "push"],
  },
  "leave.approved": {
    title: "Leave Request Approved",
    body: "Your {{leave_type}} leave from {{start_date}} to {{end_date}} has been approved.",
    channels: ["in_app", "push", "email"],
  },
  "leave.rejected": {
    title: "Leave Request Rejected",
    body: "Your {{leave_type}} leave from {{start_date}} to {{end_date}} has been rejected.{{review_notes}}",
    channels: ["in_app", "push", "email"],
  },

  // ─── General ─────────────────────────────────────────────────────
  "general.announcement": {
    title: "{{title}}",
    body: "{{body}}",
    channels: ["in_app", "push"],
  },
  "event.reminder": {
    title: "Upcoming Event: {{event_title}}",
    body: "\"{{event_title}}\" starts on {{starts_at}}. {{description}}",
    channels: ["in_app", "push"],
  },
  "event.cancelled": {
    title: "Event Cancelled",
    body: "\"{{event_title}}\" scheduled for {{starts_at}} has been cancelled.",
    channels: ["in_app", "push"],
  },
};

/**
 * Interpolate a template string with data.
 * Replaces {{key}} with data[key]. Missing keys become empty string.
 */
function interpolate(template, data) {
  if (!template) return "";
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const val = data[key];
    return val !== undefined && val !== null ? String(val) : "";
  });
}

/**
 * Get a rendered template for an event type.
 * @param {string} eventType
 * @param {object} data - variables to interpolate
 * @returns {{ title: string, body: string, channels: string[] } | null}
 */
function renderTemplate(eventType, data = {}) {
  const template = TEMPLATES[eventType];
  if (!template) return null;

  return {
    title: interpolate(template.title, data),
    body: interpolate(template.body, data),
    channels: [...template.channels],
  };
}

/**
 * Get all available template keys grouped by category.
 */
function listTemplates() {
  const grouped = {};
  for (const [key, template] of Object.entries(TEMPLATES)) {
    const category = key.split(".")[0];
    if (!grouped[category]) grouped[category] = [];
    grouped[category].push({
      event_type: key,
      title_pattern: template.title,
      body_pattern: template.body,
      default_channels: template.channels,
    });
  }
  return grouped;
}

module.exports = {
  TEMPLATES,
  renderTemplate,
  listTemplates,
  interpolate,
};
