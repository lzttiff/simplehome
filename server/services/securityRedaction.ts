const SENSITIVE_KEY_PATTERN = /(token|secret|password|authorization|credential|api[_-]?key)/i;

export function redactSensitiveText(input: unknown, maxLength = 280): string {
  const text = typeof input === "string" ? input : errorToString(input);
  if (!text) {
    return "";
  }

  const redacted = text
    .replace(/([\w.%+-]+)@([\w.-]+\.[A-Za-z]{2,})/g, "<redacted-email>")
    .replace(/\b(?:[A-Za-z0-9]{4}-){3}[A-Za-z0-9]{4}\b/g, "<redacted-app-password>")
    .replace(/\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi, "<redacted-auth-header>")
    .replace(/\b(token|secret|password|credential|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=<redacted>")
    .replace(/([?&](?:key|api_key|access_token|refresh_token)=)[^&\s]+/gi, "$1<redacted>");

  return redacted.slice(0, maxLength);
}

export function containsSensitiveContent(input: unknown): boolean {
  const text = (typeof input === "string" ? input : errorToString(input)).toLowerCase();
  if (!text) {
    return false;
  }

  return (
    text.includes("password") ||
    text.includes("authorization") ||
    text.includes("bearer") ||
    text.includes("basic ") ||
    text.includes("token") ||
    text.includes("credential") ||
    text.includes("secret") ||
    text.includes("api_key") ||
    text.includes("apikey")
  );
}

export function sanitizeUnknownErrorMessage(
  error: unknown,
  fallbackMessage: string,
  allowList?: Set<string>,
): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const message = (raw || "").trim();

  if (!message) {
    return fallbackMessage;
  }

  if (allowList?.has(message)) {
    return message;
  }

  if (containsSensitiveContent(message)) {
    return fallbackMessage;
  }

  return fallbackMessage;
}

export function redactForLogging(value: unknown, depth = 0): unknown {
  if (value == null) {
    return value;
  }

  if (typeof value === "string") {
    return redactSensitiveText(value, 2000);
  }

  if (value instanceof Error) {
    return `${value.name}: ${redactSensitiveText(value.message, 500)}`;
  }

  if (typeof value !== "object") {
    return value;
  }

  if (depth >= 4) {
    return "[TruncatedObject]";
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactForLogging(entry, depth + 1));
  }

  const output: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      output[key] = "<redacted>";
      continue;
    }
    output[key] = redactForLogging(child, depth + 1);
  }

  return output;
}

function errorToString(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name || "Error";
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error || "");
  }
}
