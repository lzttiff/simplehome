import fs from "fs";
import path from "path";
import { redactForLogging } from "./securityRedaction";
import { getCalendarSyncAuditConfig } from "./runtimeConfig";

type CalendarSyncAuditEvent = {
  provider: "apple" | "google";
  event: string;
  userId?: string;
  syncRunId?: string;
  taskId?: string;
  kind?: "minor" | "major";
  [key: string]: unknown;
};

const CALENDAR_SYNC_SCHEMA_VERSION = "1.0";

function resolveAuditPath(): string {
  const config = getCalendarSyncAuditConfig();
  return config.path || path.resolve(process.cwd(), "data", "calendar-sync.log");
}

export function writeCalendarSyncAudit(event: CalendarSyncAuditEvent): void {
  const config = getCalendarSyncAuditConfig();
  if (!config.enabled) {
    return;
  }

  try {
    const auditPath = resolveAuditPath();
    fs.mkdirSync(path.dirname(auditPath), { recursive: true });
    const sanitizedEvent = redactForLogging(event) as Record<string, unknown>;
    const payload = {
      schemaVersion: CALENDAR_SYNC_SCHEMA_VERSION,
      recordedAt: new Date().toISOString(),
      eventType: event.event,
      ...sanitizedEvent,
    };
    fs.appendFileSync(auditPath, `${JSON.stringify(payload)}\n`, "utf8");
  } catch {
    // Best effort only; sync should not fail because audit logging failed.
  }
}
