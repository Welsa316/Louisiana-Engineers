import { Resend } from "resend";
import { env, type Env } from "../env";

/**
 * Where rendered email goes. Production sends through Resend; without
 * `RESEND_API_KEY` (local development and tests) the message text is printed
 * to the server log instead, which is how a local magic link is read.
 */
export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  readonly kind: "resend" | "log";
  /** Resolves when the provider accepted the message; throws otherwise. */
  send(message: OutgoingEmail): Promise<void>;
}

export function createResendMailer(apiKey: string, from: string): Mailer {
  const client = new Resend(apiKey);
  return {
    kind: "resend",
    async send(message) {
      const { error } = await client.emails.send({
        from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      if (error) throw new Error(`resend: ${error.name}: ${error.message}`);
    },
  };
}

/**
 * Stands in for Resend when there is no key. In development it prints the
 * message (how a local magic link is read). In test mode it prints nothing:
 * test runs read links from the test-only dev-last-link route, and CI logs
 * must not carry working sign-in links or addresses. In production it
 * refuses, so a missing key fails visibly in the outbox.
 */
export function createLogMailer(nodeEnv: Env["NODE_ENV"] = env.NODE_ENV): Mailer {
  return {
    kind: "log",
    async send(message) {
      if (nodeEnv === "production") throw new Error("RESEND_API_KEY is not set; email not sent");
      if (nodeEnv !== "development") return;
      console.log(`[email] to ${message.to}: ${message.subject}\n${message.text}\n[email] end`);
    },
  };
}

let shared: Mailer | undefined;

/** Resend when `RESEND_API_KEY` is set, otherwise the log mailer. */
export function defaultMailer(): Mailer {
  if (!shared) {
    shared = env.RESEND_API_KEY ? createResendMailer(env.RESEND_API_KEY, env.EMAIL_FROM) : createLogMailer();
  }
  return shared;
}
