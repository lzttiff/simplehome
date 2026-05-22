import fs from "fs";
import path from "path";
import { writeCalendarSyncAudit } from "../server/services/calendarSyncAudit";
import {
  redactSensitiveText,
  sanitizeUnknownErrorMessage,
} from "../server/services/securityRedaction";

type CheckStatus = "PASS" | "WARN" | "FAIL";

type CheckResult = {
  id: string;
  status: CheckStatus;
  detail: string;
};

function resolveEnv(targetName: string, legacyName?: string): { source: "target" | "legacy" | "default"; value: string | null } {
  const target = process.env[targetName]?.trim();
  if (target) {
    return { source: "target", value: target };
  }

  if (legacyName) {
    const legacy = process.env[legacyName]?.trim();
    if (legacy) {
      return { source: "legacy", value: legacy };
    }
  }

  return { source: "default", value: null };
}

function checkSecretsAndFallback(): CheckResult[] {
  const results: CheckResult[] = [];
  const sessionSecret = process.env.SESSION_SECRET?.trim() || null;
  results.push({
    id: "secret-session",
    status: sessionSecret ? "PASS" : "WARN",
    detail: sessionSecret ? "SESSION_SECRET is set." : "SESSION_SECRET is not set in current environment.",
  });

  const mongo = resolveEnv("MONGODB_URL", "DATABASE_URL");
  results.push({
    id: "secret-mongo",
    status: mongo.source === "default" ? "WARN" : "PASS",
    detail:
      mongo.source === "target"
        ? "Mongo uses target env MONGODB_URL."
        : mongo.source === "legacy"
          ? "Mongo uses legacy fallback DATABASE_URL (migration still active)."
          : "Mongo env vars are unset; runtime default would be used.",
  });

  const appleKey = resolveEnv("CALENDAR_CREDENTIALS_ENCRYPTION_KEY", "APPLE_SYNC_ENCRYPTION_KEY");
  results.push({
    id: "secret-apple-key",
    status: appleKey.source === "default" ? "WARN" : "PASS",
    detail:
      appleKey.source === "target"
        ? "Apple encryption uses target env CALENDAR_CREDENTIALS_ENCRYPTION_KEY."
        : appleKey.source === "legacy"
          ? "Apple encryption uses legacy fallback APPLE_SYNC_ENCRYPTION_KEY."
          : "Apple encryption key is not set in current environment.",
  });

  const openaiKey = resolveEnv("OPENAI_API_KEY", "OPENAI_API_KEY_ENV_VAR");
  results.push({
    id: "secret-openai-key",
    status: openaiKey.source === "default" ? "WARN" : "PASS",
    detail:
      openaiKey.source === "target"
        ? "OpenAI key uses target env OPENAI_API_KEY."
        : openaiKey.source === "legacy"
          ? "OpenAI key uses legacy fallback OPENAI_API_KEY_ENV_VAR."
          : "OpenAI key is not set in current environment.",
  });

  const feed = resolveEnv("CALENDAR_FEED_SECRET", "ADMIN_TOKEN");
  results.push({
    id: "secret-feed",
    status: feed.source === "default" ? "WARN" : "PASS",
    detail:
      feed.source === "target"
        ? "Calendar feed uses target env CALENDAR_FEED_SECRET."
        : feed.source === "legacy"
          ? "Calendar feed uses legacy fallback ADMIN_TOKEN."
          : "Calendar feed secret is not set; runtime dev default would be used.",
  });

  return results;
}

function checkRedaction(): CheckResult[] {
  const results: CheckResult[] = [];
  const sample = "password=abcd token=1234 bearer abcdef user=test@example.com";
  const redacted = redactSensitiveText(sample, 500);
  const ok =
    !redacted.includes("abcd") &&
    !redacted.includes("1234") &&
    !redacted.toLowerCase().includes("example.com") &&
    redacted.includes("<redacted>");

  results.push({
    id: "redaction-core",
    status: ok ? "PASS" : "FAIL",
    detail: ok ? "Sensitive patterns are redacted in log-safe output." : "Redaction did not mask all expected sensitive tokens.",
  });

  const safe = sanitizeUnknownErrorMessage(new Error("token=abc"), "fallback");
  results.push({
    id: "redaction-error-path",
    status: safe === "fallback" ? "PASS" : "FAIL",
    detail:
      safe === "fallback"
        ? "Unknown sensitive provider errors are sanitized to fallback messages."
        : "Unknown sensitive provider errors are leaking through sanitization.",
  });

  return results;
}

function checkAuditLogHealth(): CheckResult[] {
  const results: CheckResult[] = [];
  const auditPath = path.resolve(process.cwd(), "data", "calendar-sync.log");

  process.env.CALENDAR_SYNC_AUDIT_ENABLED = "true";
  process.env.CALENDAR_SYNC_AUDIT_PATH = auditPath;

  const marker = `phase5-probe-${Date.now()}`;
  writeCalendarSyncAudit({
    provider: "google",
    event: "phase5_probe",
    syncRunId: marker,
    token: "sensitive-token-should-not-appear",
  });

  if (!fs.existsSync(auditPath)) {
    results.push({
      id: "audit-write-read",
      status: "FAIL",
      detail: "Audit log file was not created after probe write.",
    });
    return results;
  }

  const content = fs.readFileSync(auditPath, "utf8").trim();
  const lines = content.length > 0 ? content.split("\n") : [];
  const probeLine = [...lines].reverse().find((line) => line.includes(marker));

  if (!probeLine) {
    results.push({
      id: "audit-write-read",
      status: "FAIL",
      detail: "Probe event was not found in audit log.",
    });
    return results;
  }

  const payload = JSON.parse(probeLine) as Record<string, unknown>;
  const shapeOk = payload.schemaVersion === "1.0" && payload.eventType === "phase5_probe";
  const redactionOk = String(payload.token || "") === "<redacted>";

  results.push({
    id: "audit-write-read",
    status: shapeOk && redactionOk ? "PASS" : "FAIL",
    detail:
      shapeOk && redactionOk
        ? "Audit writer appends structured and redacted events." 
        : "Audit writer did not preserve schema/event fields or failed to redact sensitive probe data.",
  });

  return results;
}

function checkProviderFailurePathGuards(): CheckResult[] {
  const results: CheckResult[] = [];
  const appleSource = fs.readFileSync(path.resolve(process.cwd(), "server", "services", "appleCalendarSync.ts"), "utf8");
  const googleSource = fs.readFileSync(path.resolve(process.cwd(), "server", "services", "googleCalendarSync.ts"), "utf8");

  const appleGuard = appleSource.includes("sanitizeUnknownErrorMessage");
  results.push({
    id: "provider-apple-guard",
    status: appleGuard ? "PASS" : "FAIL",
    detail: appleGuard
      ? "Apple sync error responses use shared sanitization guard."
      : "Apple sync error-path sanitization guard was not found.",
  });

  const googleGuard = googleSource.includes("redactSensitiveText(error, 400)");
  results.push({
    id: "provider-google-guard",
    status: googleGuard ? "PASS" : "WARN",
    detail: googleGuard
      ? "Google sync token persistence failure path uses redacted logging."
      : "Google sync redacted failure-path logging marker not found at expected location.",
  });

  return results;
}

function main() {
  const checks: CheckResult[] = [
    ...checkSecretsAndFallback(),
    ...checkRedaction(),
    ...checkAuditLogHealth(),
    ...checkProviderFailurePathGuards(),
  ];

  let failCount = 0;
  let warnCount = 0;

  console.log("[PHASE5] Validation summary");
  for (const check of checks) {
    console.log(`- ${check.status} ${check.id}: ${check.detail}`);
    if (check.status === "FAIL") failCount += 1;
    if (check.status === "WARN") warnCount += 1;
  }

  console.log(`[PHASE5] Totals: pass=${checks.length - failCount - warnCount} warn=${warnCount} fail=${failCount}`);

  if (failCount > 0) {
    process.exit(1);
  }
}

main();
