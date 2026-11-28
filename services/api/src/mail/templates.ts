/** Minimal, inline-styled HTML email templates (email clients need inline CSS). */

function wrap(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="margin:0;background:#0b0d14;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:480px;margin:0 auto;padding:32px 24px;">
    <div style="font-size:18px;font-weight:700;color:#a78bfa;letter-spacing:-0.01em;">CleverCon</div>
    <div style="margin-top:24px;background:#12141d;border:1px solid #23263a;border-radius:16px;padding:24px;">
      <div style="font-size:17px;font-weight:600;color:#e6e8f0;">${title}</div>
      <div style="margin-top:12px;font-size:14px;line-height:1.6;color:#aeb2c4;">${bodyHtml}</div>
    </div>
    <div style="margin-top:20px;font-size:11px;color:#6b7190;">
      You are receiving this because you enabled email notifications for your CleverCon account.
    </div>
  </div></body></html>`;
}

/** The email-verification code message. */
export function verificationEmail(code: string): { subject: string; html: string; text: string } {
  return {
    subject: `Your CleverCon verification code: ${code}`,
    html: wrap(
      'Verify your email',
      `Enter this code to confirm your email for CleverCon notifications:
       <div style="margin:16px 0;font-size:28px;font-weight:700;letter-spacing:6px;color:#e6e8f0;">${code}</div>
       <div style="font-size:12px;color:#6b7190;">This code expires in 15 minutes. If you didn't request it, ignore this email.</div>`,
    ),
    text: `Your CleverCon verification code is ${code}. It expires in 15 minutes.`,
  };
}

/** A generic notification email with an optional deep link. */
export function notificationEmail(
  title: string,
  body: string | null,
  href?: string | null,
): { subject: string; html: string; text: string } {
  const cta = href
    ? `<div style="margin-top:18px;"><a href="${href}" style="display:inline-block;background:#7c6aff;color:#fff;text-decoration:none;font-weight:600;font-size:13px;padding:9px 16px;border-radius:10px;">View in CleverCon</a></div>`
    : '';
  return {
    subject: title,
    html: wrap(title, `${body ? `${body}` : ''}${cta}`),
    text: `${title}${body ? `\n\n${body}` : ''}${href ? `\n\n${href}` : ''}`,
  };
}
