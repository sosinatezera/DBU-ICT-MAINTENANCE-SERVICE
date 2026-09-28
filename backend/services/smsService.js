const https = require("https");
const env = require("../config/env");

/* Mirrors the mailer's failure categories so both delivery channels report the
   failing stage the same way to the forgot-password log. Carries no secret. */
const SMS_ERROR = {
  CONFIGURATION: "SMS_CONFIGURATION_ERROR",
  CONNECTION: "SMS_CONNECTION_ERROR",
  SEND: "SMS_SEND_ERROR",
};

function smsConfigured() {
  return (
    env.SMS_PROVIDER === "twilio" &&
    Boolean(env.SMS_API_KEY && env.SMS_API_SECRET && env.SMS_FROM)
  );
}

function normalizeEthiopianPhone(phone) {
  if (typeof phone !== "string") return null;
  const value = phone.trim().replace(/[\s()-]/g, "");
  if (/^09\d{8}$/.test(value) || /^07\d{8}$/.test(value))
    return `+251${value.slice(1)}`;
  if (/^\+251[79]\d{8}$/.test(value)) return value;
  return null;
}

function maskPhone(phone) {
  const normalized = normalizeEthiopianPhone(phone);
  return normalized
    ? `+251 ••• ••• ${normalized.slice(-4)}`
    : "Mobile number on file";
}

function sendTwilioSms({ to, body }) {
  return new Promise((resolve) => {
    const payload = new URLSearchParams({
      To: to,
      From: env.SMS_FROM,
      Body: body,
    }).toString();
    const auth = Buffer.from(
      `${env.SMS_API_KEY}:${env.SMS_API_SECRET}`,
    ).toString("base64");
    const request = https.request(
      {
        hostname: "api.twilio.com",
        path: `/2010-04-01/Accounts/${encodeURIComponent(env.SMS_API_KEY)}/Messages.json`,
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Content-Length": Buffer.byteLength(payload),
        },
        timeout: 15000,
      },
      (response) => {
        response.resume();
        response.on("end", () =>
          resolve(
            response.statusCode >= 200 && response.statusCode < 300
              ? { delivered: true, info: "SMS accepted by provider." }
              : {
                  delivered: false,
                  code: SMS_ERROR.SEND,
                  /* Only the provider's own status number: it identifies the
                     rejection and carries no credential. */
                  providerStatus: response.statusCode,
                  info: "SMS provider rejected the message.",
                },
          ),
        );
      },
    );
    request.on("timeout", () =>
      request.destroy(new Error("SMS provider timeout")),
    );
    request.on("error", () =>
      resolve({ delivered: false, code: SMS_ERROR.CONNECTION, info: "SMS delivery failed." }),
    );
    request.write(payload);
    request.end();
  });
}

async function sendPasswordResetSms({ to, code, expiresMinutes = 10 }) {
  if (!smsConfigured()) {
    return {
      delivered: false,
      code: SMS_ERROR.CONFIGURATION,
      info: "SMS delivery: Not available — SMS provider is not configured.",
    };
  }
  const normalized = normalizeEthiopianPhone(to);
  if (!normalized)
    return {
      delivered: false,
      code: SMS_ERROR.CONFIGURATION,
      info: "The mobile number is not valid for SMS delivery.",
    };
  return sendTwilioSms({
    to: normalized,
    body: `Smart ICT Maintenance System: Your password reset verification code is ${code}. It expires in ${expiresMinutes} minutes.`,
  });
}

module.exports = {
  smsConfigured,
  normalizeEthiopianPhone,
  maskPhone,
  sendPasswordResetSms,
  SMS_ERROR,
};
