import { Resend } from "resend";

// ──────────────────────────────────────────────────────────────
// Configuration & fail-fast guard
// ──────────────────────────────────────────────────────────────
const resendApiKey = process.env.RESEND_API_KEY;
const isProduction = process.env.NODE_ENV === "production";

// In production we must NEVER silently skip transactional email. If the key is
// missing, fail fast at startup instead of degrading to a console.log no-op.
if (isProduction && !resendApiKey) {
  throw new Error(
    "[Email] RESEND_API_KEY is not set. Vendor & rider invite emails cannot be " +
      "delivered in production. Set RESEND_API_KEY (and EMAIL_FROM / EMAIL_REPLY_TO) " +
      "before starting the server."
  );
}

const resend = resendApiKey ? new Resend(resendApiKey) : null;
const fromEmail =
  process.env.EMAIL_FROM || "Plokitch Onboarding <onboarding@resend.dev>";
const replyToEmail = process.env.EMAIL_REPLY_TO || "support@plokitch.app";

// ──────────────────────────────────────────────────────────────
// Shared dispatch helper
// Sends via Resend when configured. Outside production (and only there) it
// falls back to a clearly-labelled console preview. Any Resend-level error is
// surfaced as a thrown exception — never swallowed.
// ──────────────────────────────────────────────────────────────
async function dispatchEmail(params: {
  to: string;
  subject: string;
  html: string;
  context: string;
}) {
  if (resend) {
    console.log(`[Email] Sending '${params.context}' to ${params.to}...`);
    const response = await resend.emails.send({
      from: fromEmail,
      to: params.to,
      replyTo: replyToEmail,
      subject: params.subject,
      html: params.html,
    });

    // Resend SDK returns { data, error }. Treat a populated error as a hard failure.
    if ((response as any)?.error) {
      throw new Error(
        `[Email] Resend rejected '${params.context}' to ${params.to}: ${JSON.stringify(
          (response as any).error
        )}`
      );
    }

    console.log(`[Email] '${params.context}' dispatched to ${params.to}`);
    return response;
  }

  // Non-production only (production throws at startup above).
  console.log("┌──────────────────────────────────────────────────────────────┐");
  console.log("│ 📭 DEV EMAIL PREVIEW — RESEND_API_KEY NOT CONFIGURED          │");
  console.log(`│ Context : ${params.context}`);
  console.log(`│ To      : ${params.to}`);
  console.log(`│ Subject : ${params.subject}`);
  console.log("└──────────────────────────────────────────────────────────────┘");
  return { mock: true, success: true } as const;
}

// ──────────────────────────────────────────────────────────────
// Shared HTML shell (Plokitch dark/gold styling)
// ──────────────────────────────────────────────────────────────
function renderShell(opts: {
  title: string;
  heading: string;
  intro: string;
  highlights?: Array<{ label: string; value: string }>;
  bodyParagraphs: string[];
  ctaLabel?: string;
  ctaLink?: string;
  footerNote: string;
  /** Optional teal-bordered quote block (e.g. a rejection reason). */
  quote?: { label?: string; text: string };
}) {
  const highlightsHtml =
    opts.highlights && opts.highlights.length
      ? `
            <div class="highlight-box">${opts.highlights
              .map(
                (h, i) => `
            <div${i > 0 ? ' style="margin-top: 12px;"' : ""} class="highlight-label">${h.label}</div>
            <div class="highlight-value">${h.value}</div>`
              )
              .join("")}
            </div>`
      : "";

  const quoteHtml = opts.quote
    ? `
            <div class="quote-box">
              ${opts.quote.label ? `<div class="quote-label">${opts.quote.label}</div>` : ""}
              <div class="quote-text">${opts.quote.text}</div>
            </div>`
    : "";

  const ctaHtml =
    opts.ctaLabel && opts.ctaLink
      ? `
            <div class="btn-container">
              <a href="${opts.ctaLink}" class="btn">${opts.ctaLabel}</a>
            </div>`
      : "";

  const paragraphsHtml = opts.bodyParagraphs
    .map((p) => `<p>${p}</p>`)
    .join("\n            ");

  return `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${opts.title}</title>
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
          .quote-box {
            background-color: rgba(45, 212, 191, 0.06);
            border-left: 3px solid #2DD4BF;
            padding: 16px 20px;
            border-radius: 0 12px 12px 0;
            margin-bottom: 28px;
          }
          .quote-label {
            font-size: 11px;
            font-weight: 800;
            color: #2DD4BF;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 6px;
          }
          .quote-text {
            font-size: 15px;
            color: #CBD5E1;
            font-style: italic;
            line-height: 1.5;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <span class="logo">PLOKITCH</span>
          </div>
          <div class="content">
            <h1>${opts.heading}</h1>
            <p>${opts.intro}</p>
            ${highlightsHtml}
            ${quoteHtml}
            ${paragraphsHtml}
            ${ctaHtml}

            <p class="warning-text">
              ${opts.footerNote}
            </p>
          </div>
          <div class="footer">
            <p>&copy; ${new Date().getFullYear()} Plokitch Marketplace. All operational rights reserved.</p>
          </div>
        </div>
      </body>
    </html>
  `;
}

function formatExpiry(expiresAt: Date) {
  return expiresAt.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// ──────────────────────────────────────────────────────────────
// Vendor / generic operator invite
// ──────────────────────────────────────────────────────────────
interface SendInviteEmailParams {
  email: string;
  role: "vendor" | "rider";
  inviteLink: string;
  expiresAt: Date;
  /** Optional recipient name for a personalised greeting. */
  name?: string;
}

export async function sendInviteEmail({
  email,
  role,
  inviteLink,
  expiresAt,
  name,
}: SendInviteEmailParams) {
  const roleName =
    role === "vendor" ? "Partner Chef / Vendor" : "Delivery Partner / Rider";
  const formattedExpiry = formatExpiry(expiresAt);
  const greeting = name ? `Hello ${name},` : "Hello,";

  const html = renderShell({
    title: "You're Invited to Join Plokitch",
    heading: "Partner Invitation",
    intro: `${greeting} you have been officially invited by the platform administration to join the Plokitch ecosystem as a trusted <strong>${roleName}</strong>.`,
    highlights: [
      { label: "Assigned Operator Role", value: roleName },
      { label: "Invitation Expiration", value: formattedExpiry },
    ],
    bodyParagraphs: [
      "To accept this invitation, complete your platform profile, and establish secure login credentials, please click the secure link below:",
    ],
    ctaLabel: "Accept Invitation & Setup Account",
    ctaLink: inviteLink,
    footerNote: `For security reasons, this invitation is single-use and will expire on ${formattedExpiry}. If you did not expect this request, you can safely ignore this email.`,
  });

  return dispatchEmail({
    to: email,
    subject: `You're invited to join Plokitch as a ${role === "vendor" ? "Vendor" : "Rider"}`,
    html,
    context: `${role}-invite`,
  });
}

// ──────────────────────────────────────────────────────────────
// Rider invite — single rider & company/fleet variants
// ──────────────────────────────────────────────────────────────
interface SendRiderInviteEmailParams {
  email: string;
  inviteLink: string;
  expiresAt: Date;
  /** "single" for an individual rider, "company" for a fleet operator. */
  riderType?: "single" | "company";
  /** Rider's name (single) for a personalised greeting. */
  name?: string;
  /** Company / fleet name (company variant). */
  companyName?: string;
}

export async function sendRiderInviteEmail({
  email,
  inviteLink,
  expiresAt,
  riderType = "single",
  name,
  companyName,
}: SendRiderInviteEmailParams) {
  const formattedExpiry = formatExpiry(expiresAt);

  if (riderType === "company") {
    const fleetName = companyName || name || "Fleet Partner";
    const html = renderShell({
      title: "Your Fleet is approved on Plokitch",
      heading: "Your Fleet is Approved",
      intro: `Congratulations ${fleetName}, your fleet application has been approved by the Plokitch administration. You can now set up your operator account and begin onboarding your delivery riders.`,
      highlights: [
        { label: "Fleet / Company", value: fleetName },
        { label: "Operator Role", value: "Fleet Manager" },
        { label: "Invitation Expiration", value: formattedExpiry },
      ],
      bodyParagraphs: [
        "Open your admin portal below to create your secure login credentials, complete your company profile, and start adding sub-riders to your fleet:",
        "Once your account is active, you'll be able to invite individual riders, assign vehicles, and track deliveries across your whole fleet from a single dashboard.",
      ],
      ctaLabel: "Open Fleet Portal & Add Sub-Riders",
      ctaLink: inviteLink,
      footerNote: `This secure onboarding link is single-use and expires on ${formattedExpiry}. If you did not apply to operate a fleet on Plokitch, you can safely ignore this email.`,
    });

    return dispatchEmail({
      to: email,
      subject: "Your Fleet is approved on Plokitch",
      html,
      context: "rider-company-invite",
    });
  }

  // Single rider
  const greeting = name ? `Hello ${name},` : "Hello,";
  const html = renderShell({
    title: "You're approved as a Plokitch Delivery Partner",
    heading: "You're Approved to Ride",
    intro: `${greeting} congratulations — your application to become a Plokitch Delivery Partner has been approved. You're one step away from accepting deliveries and earning on the platform.`,
    highlights: [
      { label: "Operator Role", value: "Delivery Partner / Rider" },
      { label: "Invitation Expiration", value: formattedExpiry },
    ],
    bodyParagraphs: [
      "To activate your account, click the secure onboarding link below to set your login credentials and complete your rider profile (vehicle details, documents, and availability):",
      "Once your profile is complete you'll be able to go online and start receiving nearby delivery requests.",
    ],
    ctaLabel: "Complete Onboarding & Set Password",
    ctaLink: inviteLink,
    footerNote: `This secure onboarding link is single-use and expires on ${formattedExpiry}. If you did not apply to ride with Plokitch, you can safely ignore this email.`,
  });

  return dispatchEmail({
    to: email,
    subject: "You're approved as a Plokitch Delivery Partner",
    html,
    context: "rider-single-invite",
  });
}

// ──────────────────────────────────────────────────────────────
// Internal admin alert — fired when a public "Join Us" application
// is submitted, so an admin can review it promptly.
// ──────────────────────────────────────────────────────────────
interface SendNewApplicationAlertParams {
  applicantType: "vendor" | "home_chef" | "single_rider" | "delivery_company";
  contactName: string;
  contactEmail: string;
  contactPhone?: string;
  businessName?: string | null;
  location?: string | null;
}

const APPLICANT_TYPE_LABELS: Record<
  SendNewApplicationAlertParams["applicantType"],
  string
> = {
  vendor: "Vendor",
  home_chef: "Home Chef",
  single_rider: "Single Rider",
  delivery_company: "Delivery Company / Fleet",
};

export async function sendNewApplicationAlert({
  applicantType,
  contactName,
  contactEmail,
  contactPhone,
  businessName,
  location,
}: SendNewApplicationAlertParams) {
  const typeLabel = APPLICANT_TYPE_LABELS[applicantType];

  // Notify the platform inbox. Falls back to EMAIL_REPLY_TO if no dedicated
  // admin alert address is configured.
  const adminInbox =
    process.env.ADMIN_ALERT_EMAIL || process.env.EMAIL_REPLY_TO || replyToEmail;

  const highlights: Array<{ label: string; value: string }> = [
    { label: "Applicant Type", value: typeLabel },
    { label: "Contact Name", value: contactName },
    { label: "Contact Email", value: contactEmail },
  ];
  if (contactPhone) highlights.push({ label: "Contact Phone", value: contactPhone });
  if (businessName) highlights.push({ label: "Business / Company", value: businessName });
  if (location) highlights.push({ label: "Location", value: location });

  const dashboardUrl = process.env.DASHBOARD_URL || "http://localhost:3000";
  const reviewLink = `${dashboardUrl}/dashboard/applications`;

  const html = renderShell({
    title: "New Plokitch Application",
    heading: "New Application Received",
    intro: `A new <strong>${typeLabel}</strong> application has just been submitted through the Join Us page and is awaiting review.`,
    highlights,
    bodyParagraphs: [
      "Open the admin applications queue to review the full submission, then approve or reject it:",
    ],
    ctaLabel: "Review Applications",
    ctaLink: reviewLink,
    footerNote: "This is an automated internal notification from the Plokitch platform.",
  });

  return dispatchEmail({
    to: adminInbox,
    subject: `New ${typeLabel} application — ${businessName || contactName}`,
    html,
    context: "admin-application-alert",
  });
}

// ──────────────────────────────────────────────────────────────
// Application rejection notice
// ──────────────────────────────────────────────────────────────
interface SendRejectionEmailParams {
  name: string;
  email: string;
  reason?: string;
}

export async function sendRejectionEmail({
  name,
  email,
  reason,
}: SendRejectionEmailParams) {
  const supportEmail = process.env.EMAIL_REPLY_TO || replyToEmail;

  const html = renderShell({
    title: "Update on your Plokitch application",
    heading: "Application Update",
    intro:
      `Hi ${name},<br><br>` +
      "Thank you for your interest in joining the Plokitch platform.<br><br>" +
      "After carefully reviewing your application, we're unable to proceed at this time.",
    quote: reason ? { label: "Reviewer note", text: reason } : undefined,
    bodyParagraphs: [
      "You're welcome to reapply after 30 days.",
      `If you have questions, reach us at <a href="mailto:${supportEmail}" style="color: #D4AF37; text-decoration: none;">${supportEmail}</a>.`,
    ],
    footerNote: "This is an automated message regarding your Plokitch application.",
  });

  return dispatchEmail({
    to: email,
    subject: "Update on your Plokitch application",
    html,
    context: "application-rejection",
  });
}

// ──────────────────────────────────────────────────────────────
// Contact form message — fired from the public Contact page so the
// team is notified of an inbound enquiry.
// ──────────────────────────────────────────────────────────────
interface SendContactMessageParams {
  name: string;
  email: string;
  subject: string;
  message: string;
}

export async function sendContactMessage({
  name,
  email,
  subject,
  message,
}: SendContactMessageParams) {
  const adminInbox =
    process.env.ADMIN_ALERT_EMAIL || process.env.EMAIL_REPLY_TO || replyToEmail;

  // Escape angle brackets so user content can't inject markup into the email.
  const safeMessage = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");

  const html = renderShell({
    title: "New Contact Message",
    heading: "New Contact Message",
    intro: `A new message has been submitted through the Plokitch Contact page.`,
    highlights: [
      { label: "From", value: name },
      { label: "Email", value: email },
      { label: "Subject", value: subject },
    ],
    quote: { label: "Message", text: safeMessage },
    bodyParagraphs: [
      `Reply directly to <a href="mailto:${email}" style="color: #D4AF37; text-decoration: none;">${email}</a> to respond.`,
    ],
    footerNote: "This is an automated internal notification from the Plokitch Contact page.",
  });

  return dispatchEmail({
    to: adminInbox,
    subject: `Contact: ${subject} — ${name}`,
    html,
    context: "contact-message",
  });
}

export async function sendLoginAlertEmail({
  email,
  name,
  ipAddress,
  userAgent,
}: {
  email: string;
  name: string;
  ipAddress?: string;
  userAgent?: string;
}) {
  const greeting = name ? `Hello ${name},` : "Hello,";
  const timeStr = new Date().toLocaleString();

  const highlights = [
    { label: "Account Email", value: email },
    { label: "Date & Time", value: timeStr },
  ];
  if (ipAddress) {
    highlights.push({ label: "IP Address", value: ipAddress });
  }
  if (userAgent) {
    highlights.push({ label: "Device/Browser", value: userAgent });
  }

  const html = renderShell({
    title: "New Login Detected",
    heading: "Security Alert: Login Detected",
    intro: `${greeting} a new sign-in was detected for your Plokitch account.`,
    highlights,
    bodyParagraphs: [
      "If this was you, you can safely ignore this email. No further action is required.",
      "If you do not recognize this login activity, please secure your account immediately or contact support.",
    ],
    footerNote: "This is an automated security notification from the Plokitch platform.",
  });

  return dispatchEmail({
    to: email,
    subject: "Security Alert: New Sign-in to your Plokitch Account",
    html,
    context: "login-alert",
  });
}

