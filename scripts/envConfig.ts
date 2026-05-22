const warnedLegacyEnv = new Set<string>();

export type ScriptEnvResolution = {
  value: string;
  source: "target" | "legacy" | "default";
  variableName: string;
};

function readTrimmedEnv(name: string): string | null {
  const raw = process.env[name];
  if (!raw) {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function warnLegacyFallback(
  component: string,
  legacyName: string,
  targetName: string,
  removeByVersion: string,
): void {
  const warningKey = `${component}:${legacyName}`;
  if (warnedLegacyEnv.has(warningKey)) {
    return;
  }

  warnedLegacyEnv.add(warningKey);
  console.warn(
    `[CONFIG_DEPRECATION] using legacy env ${legacyName}; prefer ${targetName}; component=${component}; remove by ${removeByVersion}`,
  );
}

export function getMongoUrlForScript(component: string): string {
  return getMongoUrlResolutionForScript(component).value;
}

export function getMongoUrlResolutionForScript(component: string): ScriptEnvResolution {
  const primary = readTrimmedEnv("MONGODB_URL");
  if (primary) {
    return { value: primary, source: "target", variableName: "MONGODB_URL" };
  }

  const legacy = readTrimmedEnv("DATABASE_URL");
  if (legacy) {
    warnLegacyFallback(component, "DATABASE_URL", "MONGODB_URL", "v2026.08");
    return { value: legacy, source: "legacy", variableName: "DATABASE_URL" };
  }

  return {
    value: "mongodb://localhost:27017",
    source: "default",
    variableName: "mongodb://localhost:27017",
  };
}

export function getMongoDbNameForScript(): string {
  return readTrimmedEnv("MONGODB_DB_NAME") || "simplehome";
}
