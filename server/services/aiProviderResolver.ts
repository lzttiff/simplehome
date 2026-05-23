import type { AiProvider } from "@shared/schema";
import { getDefaultAiProvider } from "./runtimeConfig";

export type AiProviderResolutionSource = "request-override" | "user" | "context" | "default";

export type ResolveAiProviderInput = {
  requestProvider?: unknown;
  userProvider?: unknown;
  contextProvider?: unknown;
  allowRequestOverride?: boolean;
};

export type ResolveAiProviderResult = {
  provider: AiProvider;
  source: AiProviderResolutionSource;
  requestOverrideApplied: boolean;
};

function normalizeProvider(value: unknown): AiProvider | null {
  if (value === "openai" || value === "gemini") {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim().toLowerCase();
    if (trimmed === "openai" || trimmed === "gemini") {
      return trimmed;
    }
  }
  return null;
}

export function resolveAiProvider(input: ResolveAiProviderInput): ResolveAiProviderResult {
  const allowRequestOverride = input.allowRequestOverride !== false;
  const requestProvider = normalizeProvider(input.requestProvider);
  if (allowRequestOverride && requestProvider) {
    return {
      provider: requestProvider,
      source: "request-override",
      requestOverrideApplied: true,
    };
  }

  const userProvider = normalizeProvider(input.userProvider);
  if (userProvider) {
    return {
      provider: userProvider,
      source: "user",
      requestOverrideApplied: false,
    };
  }

  const contextProvider = normalizeProvider(input.contextProvider);
  if (contextProvider) {
    return {
      provider: contextProvider,
      source: "context",
      requestOverrideApplied: false,
    };
  }

  return {
    provider: getDefaultAiProvider(),
    source: "default",
    requestOverrideApplied: false,
  };
}
