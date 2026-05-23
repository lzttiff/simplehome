import { resolveAiProvider } from "../../server/services/aiProviderResolver";

describe("resolveAiProvider", () => {
  const original = process.env.DEFAULT_AI_PROVIDER;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.DEFAULT_AI_PROVIDER;
    } else {
      process.env.DEFAULT_AI_PROVIDER = original;
    }
  });

  it("prefers request override when enabled", () => {
    const result = resolveAiProvider({
      requestProvider: "openai",
      userProvider: "gemini",
      allowRequestOverride: true,
    });

    expect(result).toEqual({
      provider: "openai",
      source: "request-override",
      requestOverrideApplied: true,
    });
  });

  it("ignores request override when disabled and uses user provider", () => {
    const result = resolveAiProvider({
      requestProvider: "openai",
      userProvider: "gemini",
      allowRequestOverride: false,
    });

    expect(result).toEqual({
      provider: "gemini",
      source: "user",
      requestOverrideApplied: false,
    });
  });

  it("uses context provider when user provider is missing", () => {
    const result = resolveAiProvider({
      contextProvider: "openai",
      allowRequestOverride: false,
    });

    expect(result).toEqual({
      provider: "openai",
      source: "context",
      requestOverrideApplied: false,
    });
  });

  it("falls back to default provider when no source is set", () => {
    process.env.DEFAULT_AI_PROVIDER = "openai";
    const result = resolveAiProvider({});

    expect(result).toEqual({
      provider: "openai",
      source: "default",
      requestOverrideApplied: false,
    });
  });
});
