import { Resend } from "resend";

// Initialize Resend client if key is provided
const resendApiKey = process.env.RESEND_API_KEY;
const resend = resendApiKey ? new Resend(resendApiKey) : null;
const fromEmail = process.env.EMAIL_FROM || "Plokitch Onboarding <onboarding@resend.dev>";

interface SendInviteEmailParams {
  email: string;
  role: "vendor" | "rider";
  inviteLink: string;
  expiresAt: Date;
}

export async function sendInviteEmail({ email, role, inviteLink, expiresAt }: SendInviteEmailParams) {
  const roleName = role === "vendor" ? "Partner Chef / Vendor" : "Delivery Partner / Rider";
  const formattedExpiry = expiresAt.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>You're Invited to Join Plokitch</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
            background-color: #0A0D14;
            color: #E2E8F0;
            margin: 0;
            padding: 0;
            -webkit-font-smoothing: antialiased;
          }
          .container {
            max-width: 600px;
            margin: 40px auto;
            background-color: #121620;
            border-radius: 24px;
            overflow: hidden;
            border: 1px solid rgba(212, 175, 55, 0.15);
            box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
          }
          .header {
            background-color: rgba(212, 175, 55, 0.05);
            padding: 40px 30px;
            text-align: center;
            border-bottom: 1px solid rgba(212, 175, 55, 0.1);
          }
          .logo {
            font-size: 28px;
            font-weight: 800;
            letter-spacing: -0.5px;
            color: #D4AF37;
            text-decoration: none;
          }
          .content {
            padding: 40px 30px;
          }
          h1 {
            font-size: 24px;
            font-weight: 700;
            color: #FFFFFF;
            margin-top: 0;
            margin-bottom: 16px;
            text-align: center;
          }
          p {
            font-size: 15px;
            line-height: 1.6;
            color: #94A3B8;
            margin-top: 0;
            margin-bottom: 24px;
          }
          .highlight-box {
            background-color: rgba(255, 255, 255, 0.03);
            border-left: 3px solid #D4AF37;
            padding: 20px;
            border-radius: 0 12px 12px 0;
            margin-bottom: 30px;
          }
          .highlight-label {
            font-size: 11px;
            font-weight: 800;
            color: #D4AF37;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 4px;
          }
          .highlight-value {
            font-size: 16px;
            font-weight: 700;
            color: #FFFFFF;
          }
          .btn-container {
            text-align: center;
            margin: 35px 0;
          }
          .btn {
            display: inline-block;
            background-color: #D4AF37;
            color: #0A0D14;
            font-weight: 700;
            font-size: 15px;
            text-decoration: none;
            padding: 16px 40px;
            border-radius: 12px;
            box-shadow: 0 8px 20px rgba(212, 175, 55, 0.25);
            transition: all 0.2s ease;
          }
          .footer {
            background-color: #080B10;
            padding: 30px;
            text-align: center;
            border-top: 1px solid rgba(255, 255, 255, 0.05);
          }
          .footer p {
            font-size: 12px;
            color: #475569;
            margin: 0;
          }
          .warning-text {
            font-size: 12px;
            color: #64748B;
            text-align: center;
            margin-top: 20px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <span class="logo">PLOKITCH</span>
          </div>
          <div class="content">
            <h1>Partner Invitation</h1>
            <p>Hello,</p>
            <p>You have been officially invited by the platform administration to join the Plokitch ecosystem as a trusted <strong>${roleName}</strong>.</p>
            
            <div class="highlight-box">
              <div class="highlight-label">Assigned Operator Role</div>
              <div class="highlight-value">${roleName}</div>
              <div style="margin-top: 12px;" class="highlight-label">Invitation Expiration</div>
              <div class="highlight-value">${formattedExpiry}</div>
            </div>
            
            <p>To accept this invitation, complete your platform profile, and establish secure login credentials, please click the secure link below:</p>
            
            <div class="btn-container">
              <a href="${inviteLink}" class="btn">Accept Invitation & Setup Account</a>
            </div>
            
            <p class="warning-text">
              For security reasons, this invitation is single-use and will expire on ${formattedExpiry}. If you did not expect this request, you can safely ignore this email.
            </p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} Plokitch Marketplace. All operational rights reserved.</p>
          </div>
        </div>
      </body>
    </html>
  `;

  if (resend) {
    console.log(`[Email] Sending Resend invite to ${email}...`);
    try {
      const response = await resend.emails.send({
        from: fromEmail,
        to: email,
        subject: `You're invited to join Plokitch as a ${role === "vendor" ? "Vendor" : "Rider"}`,
        html: htmlContent,
      });
      console.log(`[Email] Resend dispatch success:`, response);
      return response;
    } catch (error) {
      console.error(`[Email] Resend dispatch error:`, error);
      throw error;
    }
  } else {
    console.log("┌────────────────────────────────────────────────────────────┐");
    console.log("│ 📢 DEVELOPER NOTICE: RESEND_API_KEY NOT CONFIGURED         │");
    console.log(`│ Invite Email simulated for: ${email}                       │`);
    console.log(`│ Role: ${roleName}                                           │`);
    console.log(`│ Secure link: ${inviteLink}                                  │`);
    console.log("└────────────────────────────────────────────────────────────┘");
    return { mock: true, success: true };
  }
}
