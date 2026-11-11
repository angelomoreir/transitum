import type { FastifyBaseLogger } from "fastify";
import { env } from "../env.js";
import type { Mailer } from "./mailer.js";

export interface SmsSender {
  send(to: string, text: string): Promise<void>;
}

/** Mailer SMTP real (nodemailer), ativo quando SMTP_URL está definido. */
export async function createSmtpMailer(url: string): Promise<Mailer> {
  const nodemailer = await import("nodemailer");
  const transport = nodemailer.createTransport(url);
  return {
    async send(to, subject, text) {
      await transport.sendMail({ from: env.MAIL_FROM, to, subject, text });
    },
  };
}

export function createConsoleSms(log: FastifyBaseLogger): SmsSender {
  return {
    async send(to, text) {
      log.info({ to, text }, "sms (console)");
    },
  };
}

/** SMS via API REST da Twilio (sem SDK). */
export function createTwilioSms(): SmsSender {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_FROM: from } = env;
  if (!sid || !token || !from) throw new Error("Configuração Twilio incompleta");
  return {
    async send(to, text) {
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: to, From: from, Body: text }),
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) throw new Error(`twilio ${res.status}: ${(await res.text()).slice(0, 200)}`);
    },
  };
}

export function createMemorySms() {
  const sent: { to: string; text: string }[] = [];
  const sms: SmsSender & { sent: typeof sent } = {
    sent,
    async send(to, text) {
      sent.push({ to, text });
    },
  };
  return sms;
}

export function createSms(log: FastifyBaseLogger): SmsSender {
  return env.SMS_PROVIDER === "twilio" ? createTwilioSms() : createConsoleSms(log);
}

/** Normaliza números portugueses para E.164 (+351…). */
export function toE164(phone: string, defaultCountryCode = "351"): string {
  const digits = phone.replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  return `+${defaultCountryCode}${digits}`;
}
