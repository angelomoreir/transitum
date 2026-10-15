import type { FastifyBaseLogger } from "fastify";

export interface Mailer {
  send(to: string, subject: string, text: string): Promise<void>;
}

/** Mailer de desenvolvimento: regista no log em vez de enviar email. */
export function createConsoleMailer(log: FastifyBaseLogger): Mailer {
  return {
    async send(to, subject, text) {
      log.info({ to, subject, text }, "email (console mailer)");
    },
  };
}

/** Mailer de teste: captura mensagens em memória. */
export function createMemoryMailer() {
  const sent: { to: string; subject: string; text: string }[] = [];
  const mailer: Mailer & { sent: typeof sent } = {
    sent,
    async send(to, subject, text) {
      sent.push({ to, subject, text });
    },
  };
  return mailer;
}
