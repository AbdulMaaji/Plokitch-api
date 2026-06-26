import { db } from "../db/index.js";
import { appSetting } from "../db/schema.js";
import { eq } from "drizzle-orm";

export const AUTO_DISPATCH_KEY = "auto_dispatch";

/** Whether platform-wide auto-dispatch is enabled (admin global toggle). */
export async function isGlobalAutoDispatchEnabled(): Promise<boolean> {
  const row = await db.query.appSetting.findFirst({
    where: eq(appSetting.key, AUTO_DISPATCH_KEY),
  });
  return !!(row?.value as { enabled?: boolean } | undefined)?.enabled;
}

/** Upsert the global auto-dispatch flag. */
export async function setGlobalAutoDispatch(enabled: boolean): Promise<boolean> {
  await db
    .insert(appSetting)
    .values({ key: AUTO_DISPATCH_KEY, value: { enabled }, updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSetting.key,
      set: { value: { enabled }, updatedAt: new Date() },
    });
  return enabled;
}
