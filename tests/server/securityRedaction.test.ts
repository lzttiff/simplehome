import {
  containsSensitiveContent,
  redactForLogging,
  redactSensitiveText,
  sanitizeUnknownErrorMessage,
} from "../../server/services/securityRedaction";

describe("securityRedaction", () => {
  test("redacts common secret patterns", () => {
    const input = "password=abcd token=1234 bearer abcdef user=test@example.com";
    const out = redactSensitiveText(input, 500);

    expect(out).not.toContain("abcd");
    expect(out).not.toContain("1234");
    expect(out.toLowerCase()).not.toContain("example.com");
    expect(out).toContain("<redacted>");
  });

  test("detects sensitive content", () => {
    expect(containsSensitiveContent("authorization: bearer 123")).toBe(true);
    expect(containsSensitiveContent("normal status message")).toBe(false);
  });

  test("keeps allowlisted message and suppresses unknown sensitive message", () => {
    const allowList = new Set(["known-safe"]);
    expect(sanitizeUnknownErrorMessage(new Error("known-safe"), "fallback", allowList)).toBe("known-safe");
    expect(sanitizeUnknownErrorMessage(new Error("token=abc"), "fallback", allowList)).toBe("fallback");
    expect(sanitizeUnknownErrorMessage(new Error("provider internal error"), "fallback", allowList)).toBe("fallback");
  });

  test("redacts sensitive object keys for log payloads", () => {
    const payload = {
      token: "abc",
      nested: {
        apiKey: "xyz",
        detail: "authorization bearer something",
      },
    };

    const out = redactForLogging(payload) as { token: string; nested: { apiKey: string; detail: string } };

    expect(out.token).toBe("<redacted>");
    expect(out.nested.apiKey).toBe("<redacted>");
    expect(out.nested.detail.toLowerCase()).not.toContain("bearer");
  });
});
