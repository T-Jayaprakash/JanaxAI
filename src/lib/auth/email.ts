/**
 * Account emails (login codes, workspace invitations) through AWS SES.
 * Configure SES_FROM_EMAIL (a verified sender) and AWS_REGION; the AWS SDK
 * picks up credentials from the environment or the task's IAM role.
 * In local development without SES, the code is printed to the server log.
 */

type Kind = "sign-in" | "email-verification" | "forget-password" | "change-email" | "invitation" | (string & {});

function appUrl(): string {
  return (process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}

export function emailConfigured(): boolean {
  return !!process.env.SES_FROM_EMAIL;
}

function compose(kind: Kind, code: string, extra?: { inviter?: string; workspace?: string; invitationId?: string }): { subject: string; text: string; html: string } {
  if (kind === "invitation") {
    const link = `${appUrl()}/app?invite=${encodeURIComponent(extra?.invitationId ?? "")}`;
    const subject = `${extra?.inviter ?? "Someone"} invited you to ${extra?.workspace ?? "a workspace"} on JANUXAI`;
    const text = `${subject}.\n\nJoin here: ${link}\n\nIf you weren't expecting this, you can ignore this email.`;
    return { subject, text, html: `<p>${escape(subject)}.</p><p><a href="${escape(link)}">Join the workspace</a></p><p style="color:#666">If you weren't expecting this, you can ignore this email.</p>` };
  }
  const subject = `${code} is your JANUXAI code`;
  const text = `Your JANUXAI code is ${code}.\n\nIt expires in 10 minutes. If you didn't ask for it, you can ignore this email.`;
  const html = `<div style="font-family:system-ui,sans-serif;max-width:420px"><p>Your JANUXAI code is</p><p style="font-size:32px;font-weight:700;letter-spacing:6px;margin:8px 0">${escape(code)}</p><p style="color:#666">It expires in 10 minutes. If you didn't ask for it, you can ignore this email.</p></div>`;
  return { subject, text, html };
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export async function sendLoginCode(email: string, code: string, kind: Kind, extra?: { inviter?: string; workspace?: string; invitationId?: string }): Promise<void> {
  const message = compose(kind, code, extra);
  if (!emailConfigured()) {
    if (process.env.NODE_ENV === "production") throw new Error("SES_FROM_EMAIL isn't set, so account emails can't be sent.");
    console.log(`[auth] (dev, email not configured) ${kind} for ${email}: ${code || message.text}`);
    return;
  }
  const { SESv2Client, SendEmailCommand } = await import("@aws-sdk/client-sesv2");
  const client = new SESv2Client({ region: process.env.SES_REGION || process.env.AWS_REGION || "ap-south-1" });
  await client.send(
    new SendEmailCommand({
      FromEmailAddress: process.env.SES_FROM_EMAIL,
      Destination: { ToAddresses: [email] },
      Content: { Simple: { Subject: { Data: message.subject, Charset: "UTF-8" }, Body: { Text: { Data: message.text, Charset: "UTF-8" }, Html: { Data: message.html, Charset: "UTF-8" } } } },
    }),
  );
}
