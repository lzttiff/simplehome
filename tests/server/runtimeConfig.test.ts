import {
  __resetLegacyWarningsForTests,
  collectStartupConfigIssues,
  getAppleSyncEncryptionKey,
  getCalendarFeedSecret,
  getDefaultAiProvider,
  getMongoUrl,
  getOpenAiApiKey,
} from "../../server/services/runtimeConfig";

describe("runtimeConfig startup diagnostics", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    __resetLegacyWarningsForTests();
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test("reports core/database/feed issues in production when missing", () => {
    process.env.NODE_ENV = "production";
    delete process.env.SESSION_SECRET;
    delete process.env.MONGODB_URL;
    delete process.env.DATABASE_URL;
    delete process.env.CALENDAR_FEED_SECRET;
    delete process.env.ADMIN_TOKEN;

    const issues = collectStartupConfigIssues();

    expect(issues.some((issue) => issue.feature === "core" && issue.severity === "ERROR")).toBe(true);
    expect(issues.some((issue) => issue.feature === "database" && issue.severity === "ERROR")).toBe(true);
    expect(
      issues.some(
        (issue) => issue.feature === "feeds-admin" && issue.variables.includes("CALENDAR_FEED_SECRET"),
      ),
    ).toBe(true);
    expect(
      issues.some(
        (issue) => issue.feature === "feeds-admin" && issue.variables.includes("ADMIN_TOKEN"),
      ),
    ).toBe(true);
  });

  test("reports partial google configuration", () => {
    process.env.NODE_ENV = "development";
    process.env.GOOGLE_CLIENT_ID = "client-id";
    delete process.env.GOOGLE_CLIENT_SECRET;

    const issues = collectStartupConfigIssues();

    expect(issues.some((issue) => issue.feature === "google-calendar")).toBe(true);
  });

  test("defaults AI provider to gemini and normalizes openai", () => {
    delete process.env.DEFAULT_AI_PROVIDER;
    expect(getDefaultAiProvider()).toBe("gemini");

    process.env.DEFAULT_AI_PROVIDER = "openai";
    expect(getDefaultAiProvider()).toBe("openai");
  });

  test("prefers new variables and falls back to legacy names", () => {
    process.env.CALENDAR_CREDENTIALS_ENCRYPTION_KEY = "new-apple-key";
    process.env.APPLE_SYNC_ENCRYPTION_KEY = "legacy-apple-key";
    process.env.OPENAI_API_KEY = "new-openai-key";
    process.env.OPENAI_API_KEY_ENV_VAR = "legacy-openai-key";
    process.env.MONGODB_URL = "mongodb://new-host:27017";
    process.env.DATABASE_URL = "mongodb://legacy-host:27017";

    expect(getAppleSyncEncryptionKey()).toBe("new-apple-key");
    expect(getOpenAiApiKey()).toBe("new-openai-key");
    expect(getMongoUrl()).toBe("mongodb://new-host:27017");
  });

  test("emits deprecation warning when legacy fallback is used", () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    delete process.env.CALENDAR_CREDENTIALS_ENCRYPTION_KEY;
    process.env.APPLE_SYNC_ENCRYPTION_KEY = "legacy-apple-key";
    expect(getAppleSyncEncryptionKey()).toBe("legacy-apple-key");

    delete process.env.CALENDAR_FEED_SECRET;
    process.env.ADMIN_TOKEN = "legacy-admin-token";
    expect(getCalendarFeedSecret()).toBe("dev-calendar-feed-secret");

    expect(warnSpy).toHaveBeenCalled();
    const output = warnSpy.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(output).toContain("[CONFIG_DEPRECATION]");
    expect(output).toContain("APPLE_SYNC_ENCRYPTION_KEY");
    expect(output).not.toContain("ADMIN_TOKEN");

    warnSpy.mockRestore();
  });
});
