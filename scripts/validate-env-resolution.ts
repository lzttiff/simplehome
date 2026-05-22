import {
  getMongoDbNameForScript,
  getMongoUrlResolutionForScript,
  type ScriptEnvResolution,
} from "./envConfig";

type PairResolution = {
  key: string;
  resolution: ScriptEnvResolution;
};

function resolvePair(targetName: string, legacyName: string, fallbackValue = "<unset>"): ScriptEnvResolution {
  const target = process.env[targetName]?.trim();
  if (target) {
    return { value: target, source: "target", variableName: targetName };
  }

  const legacy = process.env[legacyName]?.trim();
  if (legacy) {
    return { value: legacy, source: "legacy", variableName: legacyName };
  }

  return { value: fallbackValue, source: "default", variableName: fallbackValue };
}

function printResolution(item: PairResolution): void {
  const masked = maskValue(item.resolution.value, item.key);
  console.log(
    `${item.key}: source=${item.resolution.source} via=${item.resolution.variableName} value=${masked}`,
  );
}

function maskValue(value: string, key: string): string {
  const keyLower = key.toLowerCase();
  if (
    keyLower.includes("secret") ||
    keyLower.includes("token") ||
    keyLower.includes("password") ||
    keyLower.includes("key")
  ) {
    return value === "<unset>" ? value : "<redacted>";
  }

  return value;
}

function main() {
  const results: PairResolution[] = [
    {
      key: "mongo_url",
      resolution: getMongoUrlResolutionForScript("script-validate-env-resolution"),
    },
    {
      key: "mongo_db_name",
      resolution: {
        value: getMongoDbNameForScript(),
        source: process.env.MONGODB_DB_NAME?.trim() ? "target" : "default",
        variableName: process.env.MONGODB_DB_NAME?.trim() ? "MONGODB_DB_NAME" : "simplehome",
      },
    },
    {
      key: "apple_credential_encryption",
      resolution: resolvePair("CALENDAR_CREDENTIALS_ENCRYPTION_KEY", "APPLE_SYNC_ENCRYPTION_KEY"),
    },
    {
      key: "openai_api_key",
      resolution: resolvePair("OPENAI_API_KEY", "OPENAI_API_KEY_ENV_VAR"),
    },
    {
      key: "calendar_feed_secret",
      resolution: resolvePair("CALENDAR_FEED_SECRET", "ADMIN_TOKEN", "dev-calendar-feed-secret"),
    },
  ];

  console.log("[ENV_RESOLUTION] Target vs legacy resolution snapshot");
  results.forEach(printResolution);
}

main();
