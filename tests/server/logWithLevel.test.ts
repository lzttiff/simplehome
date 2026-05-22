import { logWithLevel } from "../../server/services/logWithLevel";

describe("logWithLevel redaction", () => {
  test("redacts sensitive values before logging", () => {
    const spy = jest.spyOn(console, "log").mockImplementation(() => undefined);

    logWithLevel("INFO", "token=abc123", { password: "secret-value" });

    expect(spy).toHaveBeenCalled();
    const loggedArgs = spy.mock.calls[0] || [];
    const merged = JSON.stringify(loggedArgs);
    expect(merged).not.toContain("abc123");
    expect(merged).not.toContain("secret-value");
    expect(merged).toContain("<redacted>");

    spy.mockRestore();
  });
});
