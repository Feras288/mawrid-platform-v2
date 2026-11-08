import nodemailer, { type Transporter } from "nodemailer";
import { AppError } from "@platform/core";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  headers?: Record<string, string>;
}

export interface SendResult {
  messageId: string | null;
}

export interface EmailTransport {
  readonly name: string;
  isConfigured(): boolean;
  send(msg: EmailMessage): Promise<SendResult>;
  verify(): Promise<{ ok: boolean; error?: string }>;
}

export interface SmtpConfig {
  host?: string;
  port?: number;
  user?: string;
  pass?: string;
  from?: string;
  secure?: boolean;
}

/** SMTP transport. When host/from are missing it reports not configured and refuses to send. */
export class SmtpTransport implements EmailTransport {
  readonly name = "smtp";
  private transporter: Transporter | undefined;
  constructor(private cfg: SmtpConfig) {}
  isConfigured() {
    return Boolean(this.cfg.host && this.cfg.from);
  }
  private t(): Transporter {
    if (!this.isConfigured()) throw new AppError("INTEGRATION_UNAVAILABLE", "SMTP not configured", { key: "smtp_not_configured" });
    this.transporter ??= nodemailer.createTransport({
      host: this.cfg.host,
      port: this.cfg.port ?? 587,
      secure: this.cfg.secure ?? false,
      auth: this.cfg.user ? { user: this.cfg.user, pass: this.cfg.pass } : undefined,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    return this.transporter;
  }
  async send(msg: EmailMessage): Promise<SendResult> {
    const info = await this.t().sendMail({ from: this.cfg.from, to: msg.to, subject: msg.subject, html: msg.html, text: msg.text, headers: msg.headers });
    return { messageId: info.messageId ?? null };
  }
  async verify() {
    try {
      await this.t().verify();
      return { ok: true };
    } catch (e) {
      // never include credentials in the error
      return { ok: false, error: (e as Error).message.replace(this.cfg.pass ?? "\u0000", "[REDACTED]") };
    }
  }
}

/** Captures messages in memory. Automated tests only. */
export class MemoryTransport implements EmailTransport {
  readonly name = "memory";
  sent: EmailMessage[] = [];
  failNext = 0;
  isConfigured() {
    return true;
  }
  async send(msg: EmailMessage) {
    if (this.failNext > 0) {
      this.failNext--;
      throw new Error("Simulated SMTP failure");
    }
    this.sent.push(msg);
    return { messageId: `mem-${this.sent.length}` };
  }
  async verify() {
    return { ok: true };
  }
}

let override: EmailTransport | undefined;

export function smtpConfigFromEnv(): SmtpConfig {
  const e = process.env;
  return {
    host: e.SMTP_HOST || undefined,
    port: e.SMTP_PORT ? Number(e.SMTP_PORT) : undefined,
    user: e.SMTP_USER || undefined,
    pass: e.SMTP_PASS || undefined,
    from: e.SMTP_FROM || undefined,
    secure: e.SMTP_SECURE === "true" || e.SMTP_SECURE === "1",
  };
}

export function getEmailTransport(cfg?: SmtpConfig): EmailTransport {
  if (override) return override;
  return new SmtpTransport(cfg ?? smtpConfigFromEnv());
}

export function setEmailTransport(t: EmailTransport | undefined): void {
  override = t;
}
