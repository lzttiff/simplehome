import fs from "fs";
import path from "path";
import { redactForLogging } from "./securityRedaction";

type AiConfigAuditEvent = {
  event: "ai_preferences_updated" | string;
  actorUserId: string;
  targetUserId: string;
  oldValues?: {
    aiProvider?: string | null;
    aiAgentEnabled?: boolean;
    aiPolicyVersion?: string | null;
    [key: string]: unknown;
  };
  newValues?: {
    aiProvider?: string | null;
    aiAgentEnabled?: boolean;
    aiPolicyVersion?: string | null;
    [key: string]: unknown;
  };
  requestMeta?: {
    method?: string;
    path?: string;
    ip?: string;
    userAgent?: string | null;
  };
  [key: string]: unknown;
};

const AI_CONFIG_AUDIT_SCHEMA_VERSION = "1.0";

function getAiConfigAuditPath(): string {
  return process.env.AI_CONFIG_AUDIT_PATH?.trim() || path.resolve(process.cwd(), "data", "ai-config-audit.log");
}

function isAuditEnabled(): boolean {
  return process.env.AI_CONFIG_AUDIT_ENABLED !== "false";
}

export function writeAiConfigAudit(event: AiConfigAuditEvent): void {
  if (!isAuditEnabled()) {
    return;
  }

  try {
    const auditPath = getAiConfigAuditPath();
    fs.mkdirSync(path.dirname(auditPath), { recursive: true });
    const sanitizedEvent = redactForLogging(event) as Record<string, unknown>;
    const payload = {
      schemaVersion: AI_CONFIG_AUDIT_SCHEMA_VERSION,
      recordedAt: new Date().toISOString(),
      eventType: event.event,
      ...sanitizedEvent,
    };

    fs.appendFileSync(auditPath, `${JSON.stringify(payload)}\n`, "utf8");
  } catch {
    // Best effort only; preference updates should not fail because audit logging failed.
  }
}
