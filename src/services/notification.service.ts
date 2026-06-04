import { db } from "../db/index.js";
import { notification, user } from "../db/schema.js";
import { sendEmail } from "../lib/email.js";
import { eq } from "drizzle-orm";

export interface SendInAppParams {
  userId: string;
  title: string;
  message: string;
  type: string; // 'order_status' | 'onboarding' | 'complaint' | 'payout' | 'general'
  entityType?: string; // 'order' | 'complaint' | 'vendor' | 'rider_profile'
  entityId?: string;
}

export interface SendNotificationParams extends SendInAppParams {
  emailSubject?: string;
  emailHtml?: string;
  isMarketing?: boolean;
}

export class NotificationService {
  /**
   * Send persistent in-app notification
   */
  static async sendInApp({
    userId,
    title,
    message,
    type,
    entityType,
    entityId,
  }: SendInAppParams) {
    try {
      console.log(`[NotificationService] Creating in-app notification for user ${userId}: ${title}`);
      const [newNotif] = await db
        .insert(notification)
        .values({
          userId,
          title,
          message,
          type,
          entityType,
          entityId,
        })
        .returning();
      return newNotif;
    } catch (error) {
      console.error("[NotificationService] Error creating in-app notification:", error);
      throw error;
    }
  }

  /**
   * Dispatches both in-app notification and email (respecting preferences)
   */
  static async send({
    userId,
    title,
    message,
    type,
    entityType,
    entityId,
    emailSubject,
    emailHtml,
    isMarketing = false,
  }: SendNotificationParams) {
    // 1. Create In-App Notification first
    const inAppNotif = await this.sendInApp({
      userId,
      title,
      message,
      type,
      entityType,
      entityId,
    });

    // 2. Fetch User to check email preferences
    try {
      const [dbUser] = await db.select().from(user).where(eq(user.id, userId)).limit(1);
      
      if (!dbUser) {
        console.warn(`[NotificationService] User ${userId} not found, skipping email.`);
        return inAppNotif;
      }

      // If email configuration is supplied, check rules to send it
      if (emailSubject && emailHtml && dbUser.email) {
        const skipEmail = isMarketing && !dbUser.marketingEmailsEnabled;
        
        if (!skipEmail) {
          await sendEmail({
            to: dbUser.email,
            subject: emailSubject,
            html: emailHtml,
          });
        } else {
          console.log(`[NotificationService] Marketing email skipped for ${dbUser.email} (opted out)`);
        }
      }
    } catch (error) {
      console.error("[NotificationService] Error checking user email preferences or sending email:", error);
    }

    return inAppNotif;
  }
}
