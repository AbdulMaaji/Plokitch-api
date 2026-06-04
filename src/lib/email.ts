import { Resend } from "resend";

// Initialize Resend client if key is provided
const resendApiKey = process.env.RESEND_API_KEY;
const resend = resendApiKey ? new Resend(resendApiKey) : null;
const fromEmail = process.env.EMAIL_FROM || "Plokitch <support@plokitch.app>";
const fromEmailInvite = process.env.EMAIL_FROM_INVITE || "Plokitch <no-reply@plokitch.app>";
const replyToEmail = process.env.EMAIL_REPLY_TO || "support@plokitch.app";

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
        from: fromEmailInvite,
        to: email,
        replyTo: replyToEmail,
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

export async function sendEmail({ to, subject, html }: { to: string; subject: string; html: string }) {
  if (resend) {
    console.log(`[Email] Sending Resend email to ${to}...`);
    try {
      const response = await resend.emails.send({
        from: fromEmail,
        to,
        replyTo: replyToEmail,
        subject,
        html,
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
    console.log(`│ Email simulated for: ${to}                                 │`);
    console.log(`│ Subject: ${subject}                                        │`);
    console.log("└────────────────────────────────────────────────────────────┘");
    return { mock: true, success: true };
  }
}

interface SendCredentialsEmailParams {
  email: string;
  name: string;
  role: "chef" | "rider";
  tempPassword?: string;
}

export async function sendCredentialsEmail({ email, name, role, tempPassword }: SendCredentialsEmailParams) {
  const roleName = role === "chef" ? "Partner Chef / Vendor" : "Delivery Partner / Rider";
  const dashboardUrl = role === "chef" ? "https://plokitch.app/login" : "https://plokitch.app/login";
  const tempPass = tempPassword || "Plokitch@2026!";

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to Plokitch</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background-color: #0A0D14;
            color: #E2E8F0;
            margin: 0;
            padding: 0;
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
            text-align: center;
          }
          p {
            font-size: 15px;
            line-height: 1.6;
            color: #94A3B8;
          }
          .credentials-box {
            background-color: rgba(255, 255, 255, 0.03);
            border-left: 3px solid #D4AF37;
            padding: 20px;
            border-radius: 0 12px 12px 0;
            margin: 25px 0;
          }
          .label {
            font-size: 11px;
            font-weight: 800;
            color: #D4AF37;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 4px;
          }
          .value {
            font-size: 15px;
            font-weight: 700;
            color: #FFFFFF;
            font-family: monospace;
            margin-bottom: 12px;
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
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <span class="logo">PLOKITCH</span>
          </div>
          <div class="content">
            <h1>Welcome to the Team!</h1>
            <p>Hello ${name},</p>
            <p>An administrator has registered your profile on Plokitch as an operational <strong>${roleName}</strong>.</p>
            
            <p>Your temporary account credentials have been generated below. Please log in using these details and update your password on your first session.</p>
            
            <div class="credentials-box">
              <div class="label">Login Email</div>
              <div class="value">${email}</div>
              <div class="label">Temporary Password</div>
              <div class="value">${tempPass}</div>
            </div>
            
            <div class="btn-container">
              <a href="${dashboardUrl}" class="btn">Log In to Your Dashboard</a>
            </div>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} Plokitch. All rights reserved.</p>
          </div>
        </div>
      </body>
    </html>
  `;

  if (resend) {
    console.log(`[Email] Sending credentials welcome email to ${email}...`);
    try {
      await resend.emails.send({
        from: fromEmail,
        to: email,
        replyTo: replyToEmail,
        subject: `Welcome to Plokitch! Your ${role === "chef" ? "Chef" : "Rider"} Account is Ready`,
        html: htmlContent,
      });
    } catch (err) {
      console.error("[Email] Failed to send credentials email:", err);
    }
  } else {
    console.log("┌────────────────────────────────────────────────────────────┐");
    console.log("│ 📢 DEVELOPER NOTICE: RESEND_API_KEY NOT CONFIGURED         │");
    console.log(`│ Welcome Email simulated for: ${email}                      │`);
    console.log(`│ Role: ${roleName}                                           │`);
    console.log(`│ Temp Password: ${tempPass}                                 │`);
    console.log("└────────────────────────────────────────────────────────────┘");
    return { mock: true, success: true };
  }
}

interface SendWelcomeEmailParams {
  email: string;
  name: string;
  role: "customer" | "chef" | "rider";
}

export async function sendGeneralWelcomeEmail({ email, name, role }: SendWelcomeEmailParams) {
  let roleTitle = "Customer";
  let onboardingContent = "";
  let dashboardLink = "https://plokitch.app";

  if (role === "chef") {
    roleTitle = "Partner Chef / Vendor";
    dashboardLink = "https://plokitch.app/chef";
    onboardingContent = `
      <div class="role-section">
        <h3>🍳 Getting Started as a Chef</h3>
        <ul>
          <li><strong>Set Up Your Kitchen Profile</strong>: Head over to your Chef Dashboard to add your business logo, banner, and bio.</li>
          <li><strong>Curate Your Menu</strong>: Manually input your signature dishes, prices, and prep times. You can mark dishes as featured!</li>
          <li><strong>Manage Active Orders</strong>: Receive instant in-app alerts on new orders. Prep them with love, and request riders in one click.</li>
        </ul>
      </div>
    `;
  } else if (role === "rider") {
    roleTitle = "Delivery Partner / Rider";
    dashboardLink = "https://plokitch.app/rider";
    onboardingContent = `
      <div class="role-section">
        <h3>🚲 Getting Started as a Rider</h3>
        <ul>
          <li><strong>Toggle Availability</strong>: Go online in your Rider Dashboard to begin receiving delivery requests.</li>
          <li><strong>Accept Delivery Orders</strong>: View pickup and delivery coordinates mapped using our live Leaflet tracking.</li>
          <li><strong>Track Your Earnings</strong>: Monitor total completed deliveries, payouts, and customer ratings on your workspace.</li>
        </ul>
      </div>
    `;
  } else {
    roleTitle = "Customer";
    dashboardLink = "https://plokitch.app/customer/discover";
    onboardingContent = `
      <div class="role-section">
        <h3>🍽️ Getting Started as a Customer</h3>
        <ul>
          <li><strong>Explore the Food Bazaar</strong>: Visit the Discover Map to locate active home ateliers and artisan kitchens near you.</li>
          <li><strong>Choose Artisan Dishes</strong>: Browse fresh specials, customize ingredients, and add priority bookings.</li>
          <li><strong>Live Tracking</strong>: Monitor your orders from prep to final drop-off on our real-time GPS maps.</li>
        </ul>
      </div>
    `;
  }

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Welcome to Plokitch</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background-color: #0A0D14;
            color: #E2E8F0;
            margin: 0;
            padding: 0;
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
            text-align: center;
          }
          p {
            font-size: 15px;
            line-height: 1.6;
            color: #94A3B8;
          }
          .role-section {
            background-color: rgba(212, 175, 55, 0.03);
            border-left: 3px solid #D4AF37;
            padding: 20px;
            border-radius: 0 12px 12px 0;
            margin: 25px 0;
          }
          .role-section h3 {
            margin-top: 0;
            color: #FFFFFF;
            font-size: 16px;
            font-weight: 700;
          }
          .role-section ul {
            margin: 10px 0 0 0;
            padding-left: 20px;
            color: #94A3B8;
            font-size: 14px;
          }
          .role-section li {
            margin-bottom: 8px;
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
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <span class="logo">PLOKITCH</span>
          </div>
          <div class="content">
            <h1>Welcome to Plokitch!</h1>
            <p>Hello ${name},</p>
            <p>We are absolutely thrilled to welcome you to the Plokitch community as a <strong>${roleTitle}</strong>.</p>
            
            <p>Plokitch is Gombe's premium spatial dining ecosystem, connecting neighborhood culinary artisans with fine diners and professional logistics partners.</p>
            
            ${onboardingContent}
            
            <div class="btn-container">
              <a href="${dashboardLink}" class="btn">Explore Plokitch App</a>
            </div>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} Plokitch. All rights reserved.</p>
          </div>
        </div>
      </body>
    </html>
  `;

  if (resend) {
    console.log(`[Email] Sending general onboarding welcome email to ${email}...`);
    try {
      await resend.emails.send({
        from: fromEmail,
        to: email,
        replyTo: replyToEmail,
        subject: `Welcome to Plokitch, ${name}! Here's how to get started`,
        html: htmlContent,
      });
    } catch (err) {
      console.error("[Email] Failed to send general welcome email:", err);
    }
  } else {
    console.log("┌────────────────────────────────────────────────────────────┐");
    console.log("│ 📢 DEVELOPER NOTICE: RESEND_API_KEY NOT CONFIGURED         │");
    console.log(`│ Onboarding Welcome Email simulated for: ${email}           │`);
    console.log(`│ Name: ${name}                                              │`);
    console.log(`│ Role: ${roleTitle}                                         │`);
    console.log("└────────────────────────────────────────────────────────────┘");
    return { mock: true, success: true };
  }
}

interface SendJoinApplicationParams {
  fullName: string;
  email: string;
  phone: string;
  role: "chef" | "rider";
  message?: string;
  location?: string;
}

export async function sendJoinApplicationEmail(params: SendJoinApplicationParams) {
  const { fullName, email, phone, role, message, location } = params;
  const adminEmail = process.env.ADMIN_NOTIFICATION_EMAIL || "plokitch@gmail.com";
  const roleName = role === "chef" ? "Chef / Vendor" : "Delivery Rider";

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>New Partner Application — Plokitch</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            background-color: #0A0D14;
            color: #E2E8F0;
            margin: 0;
            padding: 0;
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
            background: linear-gradient(135deg, rgba(212, 175, 55, 0.08), rgba(212, 175, 55, 0.02));
            padding: 40px 30px;
            text-align: center;
            border-bottom: 1px solid rgba(212, 175, 55, 0.1);
          }
          .logo {
            font-size: 28px;
            font-weight: 800;
            color: #D4AF37;
          }
          .badge {
            display: inline-block;
            background-color: rgba(212, 175, 55, 0.15);
            color: #D4AF37;
            font-size: 11px;
            font-weight: 800;
            text-transform: uppercase;
            letter-spacing: 2px;
            padding: 6px 16px;
            border-radius: 20px;
            margin-top: 12px;
          }
          .content { padding: 40px 30px; }
          h1 {
            font-size: 22px;
            font-weight: 700;
            color: #FFFFFF;
            margin-top: 0;
            margin-bottom: 8px;
          }
          .subtitle {
            font-size: 14px;
            color: #64748B;
            margin-bottom: 30px;
          }
          .field-group {
            background-color: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.05);
            border-radius: 16px;
            padding: 24px;
            margin-bottom: 20px;
          }
          .field {
            margin-bottom: 16px;
          }
          .field:last-child { margin-bottom: 0; }
          .field-label {
            font-size: 10px;
            font-weight: 800;
            color: #D4AF37;
            text-transform: uppercase;
            letter-spacing: 1.5px;
            margin-bottom: 4px;
          }
          .field-value {
            font-size: 15px;
            font-weight: 600;
            color: #FFFFFF;
          }
          .message-box {
            background-color: rgba(212, 175, 55, 0.03);
            border-left: 3px solid #D4AF37;
            padding: 16px 20px;
            border-radius: 0 12px 12px 0;
            margin-top: 20px;
          }
          .message-text {
            font-size: 14px;
            color: #94A3B8;
            line-height: 1.6;
            font-style: italic;
          }
          .footer {
            background-color: #080B10;
            padding: 24px 30px;
            text-align: center;
            border-top: 1px solid rgba(255, 255, 255, 0.05);
          }
          .footer p {
            font-size: 11px;
            color: #475569;
            margin: 0;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="logo">PLOKITCH</div>
            <div class="badge">New Partner Application</div>
          </div>
          <div class="content">
            <h1>New ${roleName} Application</h1>
            <p class="subtitle">Submitted on ${new Date().toLocaleString("en-NG", { dateStyle: "full", timeStyle: "short" })}</p>
            
            <div class="field-group">
              <div class="field">
                <div class="field-label">Full Name</div>
                <div class="field-value">${fullName}</div>
              </div>
              <div class="field">
                <div class="field-label">Email Address</div>
                <div class="field-value">${email}</div>
              </div>
              <div class="field">
                <div class="field-label">Phone Number</div>
                <div class="field-value">${phone}</div>
              </div>
              <div class="field">
                <div class="field-label">Desired Role</div>
                <div class="field-value">${roleName}</div>
              </div>
              ${location ? `
              <div class="field">
                <div class="field-label">Location / Area</div>
                <div class="field-value">${location}</div>
              </div>
              ` : ""}
            </div>

            ${message ? `
            <div class="message-box">
              <div class="field-label" style="margin-bottom: 8px;">Applicant Message</div>
              <div class="message-text">"${message}"</div>
            </div>
            ` : ""}
          </div>
          <div class="footer">
            <p>This application was submitted via the Plokitch website join form.</p>
            <p style="margin-top: 6px;">© ${new Date().getFullYear()} Plokitch Marketplace</p>
          </div>
        </div>
      </body>
    </html>
  `;

  if (resend) {
    console.log(`[Email] Sending join application from ${fullName} (${role}) to ${adminEmail}...`);
    try {
      const response = await resend.emails.send({
        from: fromEmail,
        to: adminEmail,
        replyTo: email,
        subject: `New ${roleName} Application — ${fullName}`,
        html: htmlContent,
      });
      console.log(`[Email] Join application email sent:`, response);
      return response;
    } catch (error) {
      console.error(`[Email] Failed to send join application:`, error);
      throw error;
    }
  } else {
    console.log("┌────────────────────────────────────────────────────────────┐");
    console.log("│ 📢 DEVELOPER NOTICE: RESEND_API_KEY NOT CONFIGURED         │");
    console.log(`│ Join Application simulated for: ${fullName}                │`);
    console.log(`│ Role: ${roleName}                                           │`);
    console.log(`│ Email: ${email}                                             │`);
    console.log(`│ To Admin: ${adminEmail}                                     │`);
    console.log("└────────────────────────────────────────────────────────────┘");
    return { mock: true, success: true };
  }
}
