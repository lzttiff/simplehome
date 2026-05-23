type FeatureName = "core" | "database" | "ai" | "google-calendar" | "apple-calendar" | "feeds-admin";

type EnvResolution = {
  value: string | null;
  source: string | null;
};

type LegacyFallbackOptions = {
  legacyName?: string;
  targetName?: string;
  component: string;
  removeByVersion: string;
};

export type StartupConfigIssue = {
  feature: FeatureName;
  severity: "WARN" | "ERROR";
  message: string;
  variables: string[];
};

const DEFAULT_SESSION_SECRET = "simplehome-dev-secret-change-in-production";
const warnedLegacyEnv = new Set<string>();

export function __resetLegacyWarningsForTests(): void {
  warnedLegacyEnv.clear();
}

function readTrimmedEnv(name: string): string | null {
  const raw = process.env[name];
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveFromEnv(candidates: string[]): EnvResolution {
  for (const name of candidates) {
    const value = readTrimmedEnv(name);
    if (value) {
      return { value, source: name };
    }
  }
  return { value: null, source: null };
}

function warnLegacyFallback(source: string, options: LegacyFallbackOptions): void {
  if (!options.legacyName || !options.targetName) {
    return;
  }

  if (source !== options.legacyName) {
    return;
  }

  const warningKey = `${options.component}:${options.legacyName}`;
  if (warnedLegacyEnv.has(warningKey)) {
    return;
  }

  warnedLegacyEnv.add(warningKey);
  console.warn(
    `[CONFIG_DEPRECATION] using legacy env ${options.legacyName}; prefer ${options.targetName}; component=${options.component}; remove by ${options.removeByVersion}`,
  );
}

function resolveWithLegacyFallback(
  targetName: string,
  legacyName: string,
  options: Omit<LegacyFallbackOptions, "legacyName" | "targetName">,
): EnvResolution {
  const resolution = resolveFromEnv([targetName, legacyName]);
  warnLegacyFallback(resolution.source || "", {
    ...options,
    legacyName,
    targetName,
  });
  return resolution;
}

export function getGoogleClientId(): string | null {
  return resolveFromEnv(["GOOGLE_CLIENT_ID"]).value;
}

export function getGoogleClientSecret(): string | null {
  return resolveFromEnv(["GOOGLE_CLIENT_SECRET"]).value;
}

export function getAppleSyncEncryptionKey(): string | null {
  return resolveWithLegacyFallback(
    "CALENDAR_CREDENTIALS_ENCRYPTION_KEY",
    "APPLE_SYNC_ENCRYPTION_KEY",
    { component: "apple-calendar", removeByVersion: "v2026.08" },
  ).value;
}

export function getOpenAiApiKey(): string | null {
  return resolveWithLegacyFallback(
    "OPENAI_API_KEY",
    "OPENAI_API_KEY_ENV_VAR",
    { component: "ai", removeByVersion: "v2026.08" },
  ).value;
}

export function getAiUserCredentialsEncryptionKey(): string | null {
  return resolveWithLegacyFallback(
    "AI_USER_CREDENTIALS_ENCRYPTION_KEY",
    "CALENDAR_CREDENTIALS_ENCRYPTION_KEY",
    { component: "ai", removeByVersion: "v2026.12" },
  ).value;
}

export function getMongoUrl(): string | null {
  return resolveWithLegacyFallback(
    "MONGODB_URL",
    "DATABASE_URL",
    { component: "database", removeByVersion: "v2026.08" },
  ).value;
}

export function getCalendarFeedSecret(): string {
  return readTrimmedEnv("CALENDAR_FEED_SECRET") || "dev-calendar-feed-secret";
}

export function getDefaultAiProvider(): "gemini" | "openai" {
  const configured = (readTrimmedEnv("DEFAULT_AI_PROVIDER") || "gemini").toLowerCase();
  return configured === "openai" ? "openai" : "gemini";
}

export function getCalendarSyncAuditConfig(): { enabled: boolean; path: string | null } {
  const enabled = process.env.CALENDAR_SYNC_AUDIT_ENABLED !== "false";
  const path = readTrimmedEnv("CALENDAR_SYNC_AUDIT_PATH");
  return { enabled, path };
}

export function collectStartupConfigIssues(): StartupConfigIssue[] {
  const issues: StartupConfigIssue[] = [];
  const isProd = process.env.NODE_ENV === "production";

  const sessionSecret = readTrimmedEnv("SESSION_SECRET");
  if (isProd && (!sessionSecret || sessionSecret === DEFAULT_SESSION_SECRET)) {
    issues.push({
      feature: "core",
      severity: "ERROR",
      message: "SESSION_SECRET is missing or using the development fallback in production.",
      variables: ["SESSION_SECRET"],
    });
  }

  if (isProd && !getMongoUrl()) {
    issues.push({
      feature: "database",
      severity: "ERROR",
      message: "No MongoDB connection variable is set for production.",
      variables: ["MONGODB_URL", "DATABASE_URL"],
    });
  }

  const googleClientId = getGoogleClientId();
  const googleClientSecret = getGoogleClientSecret();
  if ((googleClientId && !googleClientSecret) || (!googleClientId && googleClientSecret)) {
    issues.push({
      feature: "google-calendar",
      severity: "WARN",
      message: "Google Calendar is partially configured; both client ID and client secret are required.",
      variables: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"],
    });
  }

  if (isProd && !getAppleSyncEncryptionKey()) {
    issues.push({
      feature: "apple-calendar",
      severity: "WARN",
      message: "Apple Calendar encryption key is missing; Apple sync will be unavailable.",
      variables: ["APPLE_SYNC_ENCRYPTION_KEY"],
    });
  }

  const provider = getDefaultAiProvider();
  if (provider === "openai" && !getOpenAiApiKey()) {
    issues.push({
      feature: "ai",
      severity: "WARN",
      message: "DEFAULT_AI_PROVIDER is openai but no OpenAI API key was found.",
      variables: ["OPENAI_API_KEY", "OPENAI_API_KEY_ENV_VAR"],
    });
  }

  if (provider === "gemini" && !readTrimmedEnv("GEMINI_API_KEY")) {
    issues.push({
      feature: "ai",
      severity: "WARN",
      message: "DEFAULT_AI_PROVIDER is gemini but GEMINI_API_KEY is not set.",
      variables: ["GEMINI_API_KEY"],
    });
  }

  const feedSecret = readTrimmedEnv("CALENDAR_FEED_SECRET");
  const adminToken = readTrimmedEnv("ADMIN_TOKEN");
  if (isProd && !feedSecret) {
    issues.push({
      feature: "feeds-admin",
      severity: "WARN",
      message: "CALENDAR_FEED_SECRET is missing; calendar feed signing/validation will use the development fallback.",
      variables: ["CALENDAR_FEED_SECRET"],
    });
  }

  if (isProd && !adminToken) {
    issues.push({
      feature: "feeds-admin",
      severity: "WARN",
      message: "ADMIN_TOKEN is missing; admin/testing override controls will be unavailable.",
      variables: ["ADMIN_TOKEN"],
    });
  }

  return issues;
}

export function logStartupConfigDiagnostics(): void {
  const issues = collectStartupConfigIssues();
  if (issues.length === 0) {
    console.log("[CONFIG] Startup diagnostics: no configuration issues detected.");
    return;
  }

  for (const issue of issues) {
    const names = issue.variables.join(", ");
    console.log(
      `[CONFIG][${issue.severity}][${issue.feature}] ${issue.message} Variables: ${names}`,
    );
  }
}
