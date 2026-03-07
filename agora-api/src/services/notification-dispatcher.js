const AppError = require("../utils/app-error");
const { sendPushViaFcm } = require("./fcm");

function trimText(input, max = 200) {
  return String(input || "").slice(0, max);
}

async function sendToWebhook({ webhookUrl, channel, notification }) {
  if (!webhookUrl) {
    throw new AppError(500, "CONFIG_ERROR", `Missing webhook URL for ${channel} notifications`);
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel,
      notification: {
        id: notification.id,
        school_id: notification.school_id,
        user_id: notification.user_id,
        title: notification.title,
        body: notification.body,
        payload: notification.payload || {},
      },
    }),
  });

  let body = null;
  try {
    body = await response.json();
  } catch (_e) {
    body = null;
  }

  if (!response.ok) {
    throw new Error(`Webhook ${channel} send failed (${response.status})`);
  }

  return {
    provider: "webhook",
    response_status: response.status,
    response: body,
  };
}

function sendMock({ channel, notification }) {
  // eslint-disable-next-line no-console
  console.log(
    `[notify:${channel}:mock] id=${notification.id} user=${notification.user_id} title="${trimText(notification.title, 80)}"`
  );

  return {
    provider: "mock",
    message_id: `mock-${Date.now()}`,
  };
}

async function sendPush(notification, config) {
  if (config.notifications.push.provider === "fcm") {
    return sendPushViaFcm(notification, config);
  }

  if (config.notifications.push.provider === "webhook") {
    return sendToWebhook({
      webhookUrl: config.notifications.push.webhookUrl,
      channel: "push",
      notification,
    });
  }
  return sendMock({ channel: "push", notification });
}

async function sendEmail(notification, config) {
  if (config.notifications.email.provider === "webhook") {
    return sendToWebhook({
      webhookUrl: config.notifications.email.webhookUrl,
      channel: "email",
      notification,
    });
  }
  return sendMock({ channel: "email", notification });
}

async function sendSms(notification, config) {
  if (config.notifications.sms.provider === "webhook") {
    return sendToWebhook({
      webhookUrl: config.notifications.sms.webhookUrl,
      channel: "sms",
      notification,
    });
  }
  return sendMock({ channel: "sms", notification });
}

async function dispatchNotification(notification, config) {
  if (notification.channel === "in_app") {
    return {
      provider: "in_app",
      message_id: `inapp-${notification.id}`,
    };
  }

  if (notification.channel === "push") {
    return sendPush(notification, config);
  }

  if (notification.channel === "email") {
    return sendEmail(notification, config);
  }

  if (notification.channel === "sms") {
    return sendSms(notification, config);
  }

  throw new AppError(422, "VALIDATION_ERROR", `Unsupported notification channel: ${notification.channel}`);
}

module.exports = {
  dispatchNotification,
};
