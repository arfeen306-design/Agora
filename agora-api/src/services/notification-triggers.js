/**
 * Notification Triggers — Event-driven auto-notifications
 *
 * Queues notifications for school events, respecting user preferences.
 * Uses templates for consistent title/body rendering.
 */

const pool = require("../db");
const { renderTemplate } = require("./notification-templates");

/**
 * Queue a notification for a list of user IDs, respecting their channel preferences.
 *
 * @param {object} opts
 * @param {string} opts.schoolId
 * @param {string} opts.eventType — e.g. "attendance.absent"
 * @param {string[]} opts.recipientUserIds
 * @param {object} opts.data — template interpolation data
 * @param {string} [opts.forcedChannel] — override channel (skip preference check)
 */
async function triggerNotification({ schoolId, eventType, recipientUserIds, data, forcedChannel }) {
  if (!recipientUserIds || recipientUserIds.length === 0) return { queued: 0, skipped: 0 };

  const rendered = renderTemplate(eventType, data);
  if (!rendered) {
    // No template — use raw data
    if (!data.title || !data.body) return { queued: 0, skipped: 0, reason: "no_template" };
    rendered = { title: data.title, body: data.body, channels: ["in_app"] };
  }

  // Load preferences for all recipients in one query
  const prefsResult = await pool.query(
    `
      SELECT user_id, channel, enabled
      FROM notification_preferences
      WHERE school_id = $1 AND user_id = ANY($2::uuid[]) AND event_type = $3
    `,
    [schoolId, recipientUserIds, eventType]
  );

  // Build preference map: userId → { channel → enabled }
  const prefsMap = {};
  for (const row of prefsResult.rows) {
    if (!prefsMap[row.user_id]) prefsMap[row.user_id] = {};
    prefsMap[row.user_id][row.channel] = row.enabled;
  }

  const client = await pool.connect();
  let queued = 0;
  let skipped = 0;

  try {
    await client.query("BEGIN");

    for (const userId of recipientUserIds) {
      const userPrefs = prefsMap[userId] || {};
      const channels = forcedChannel ? [forcedChannel] : rendered.channels;

      for (const channel of channels) {
        // Skip if user explicitly disabled this channel for this event
        if (userPrefs[channel] === false) {
          skipped++;
          continue;
        }

        await client.query(
          `
            INSERT INTO notifications (school_id, user_id, title, body, channel, status, payload)
            VALUES ($1, $2, $3, $4, $5::notification_channel, 'queued'::notification_status, $6::jsonb)
          `,
          [
            schoolId,
            userId,
            rendered.title,
            rendered.body,
            channel,
            JSON.stringify({ event_type: eventType, data }),
          ]
        );
        queued++;
      }
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  return { queued, skipped };
}

/**
 * Trigger notifications for an event, finding recipients by role.
 */
async function triggerByRole({ schoolId, eventType, roleCode, data }) {
  const result = await pool.query(
    `
      SELECT DISTINCT ur.user_id
      FROM user_roles ur
      JOIN roles r ON r.id = ur.role_id
      JOIN users u ON u.id = ur.user_id AND u.school_id = $1 AND u.is_active = TRUE
      WHERE r.code = $2
    `,
    [schoolId, roleCode]
  );
  const userIds = result.rows.map((r) => r.user_id);
  return triggerNotification({ schoolId, eventType, recipientUserIds: userIds, data });
}

/**
 * Trigger notifications for a student's linked parents.
 */
async function triggerForStudentParents({ schoolId, studentId, eventType, data }) {
  const result = await pool.query(
    `
      SELECT DISTINCT p.user_id
      FROM parent_students ps
      JOIN parents p ON p.id = ps.parent_id AND p.school_id = ps.school_id
      JOIN users u ON u.id = p.user_id AND u.school_id = p.school_id AND u.is_active = TRUE
      WHERE ps.school_id = $1 AND ps.student_id = $2
    `,
    [schoolId, studentId]
  );
  const userIds = result.rows.map((r) => r.user_id);
  return triggerNotification({ schoolId, eventType, recipientUserIds: userIds, data });
}

module.exports = {
  triggerNotification,
  triggerByRole,
  triggerForStudentParents,
};
