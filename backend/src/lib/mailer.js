// Sends the "forgot password" OTP email. Uses plain SMTP via nodemailer so
// it works with any provider (Gmail App Password, Brevo, SendGrid SMTP,
// your own mail server, etc.) — just fill in the SMTP_* values in .env.
const nodemailer = require('nodemailer');

let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) return null; // not configured yet
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: process.env.SMTP_SECURE === 'true', // true for port 465, false for 587/25
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter;
}

async function sendOtpEmail(to, otp, name) {
  const t = getTransporter();
  if (!t) throw new Error('Email is not configured on the server yet (SMTP_* missing in .env)');
  await t.sendMail({
    from: process.env.MAIL_FROM || process.env.SMTP_USER,
    to,
    subject: 'Tailor System — Password reset code',
    text: `Hi ${name || ''},\n\nYour password reset code is: ${otp}\n\nThis code expires in 10 minutes. If you did not request this, ignore this email.`,
    html: `
      <div style="font-family:sans-serif;max-width:420px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 4px">Tailor System</h2>
        <p style="color:#555;margin:0 0 20px">Password reset request</p>
        <p>Hi ${name || ''},</p>
        <p>Your verification code is:</p>
        <p style="font-size:32px;font-weight:bold;letter-spacing:6px;background:#f4f4f7;padding:14px 20px;border-radius:10px;text-align:center">${otp}</p>
        <p style="color:#777;font-size:13px">This code expires in 10 minutes. If you didn't request this, you can safely ignore this email.</p>
      </div>`,
  });
}

module.exports = { sendOtpEmail };
