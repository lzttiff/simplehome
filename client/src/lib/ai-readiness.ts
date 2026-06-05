import type { UiSettingsTab } from "@shared/schema";

export type AiPreferencesSnapshot = {
  aiProvider: "gemini" | "openai" | null;
  aiAgentEnabled: boolean;
};

export type AiCredentialSnapshot = {
  hasGeminiApiKey: boolean;
  hasOpenAiApiKey: boolean;
};

export type AiReadinessResult = {
  ready: boolean;
  message: string;
};

export const OPEN_SETTINGS_EVENT = "simplehome:open-settings";

export function evaluateAiReadiness(
  preferences?: AiPreferencesSnapshot | null,
  credentials?: AiCredentialSnapshot | null,
): AiReadinessResult {
  if (!preferences) {
    return {
      ready: false,
      message: "AI settings are still loading. Please try again in a moment.",
    };
  }

  if (preferences.aiAgentEnabled !== true) {
    return {
      ready: false,
      message: "Enable AI Agent in AI Preferences before running AI suggestions.",
    };
  }

  if (!preferences.aiProvider) {
    return {
      ready: false,
      message: "Select an AI provider in AI Preferences before running AI suggestions.",
    };
  }

  if (!credentials) {
    return {
      ready: false,
      message: "AI credential status is still loading. Please try again in a moment.",
    };
  }

  if (preferences.aiProvider === "gemini" && !credentials.hasGeminiApiKey) {
    return {
      ready: false,
      message: "Add your Gemini API key in AI Preferences before running AI suggestions.",
    };
  }

  if (preferences.aiProvider === "openai" && !credentials.hasOpenAiApiKey) {
    return {
      ready: false,
      message: "Add your OpenAI API key in AI Preferences before running AI suggestions.",
    };
  }

  return {
    ready: true,
    message: "AI setup is ready.",
  };
}

export function openSettingsForTab(tab: UiSettingsTab = "ai-preferences"): void {
  window.dispatchEvent(new CustomEvent(OPEN_SETTINGS_EVENT, { detail: { tab } }));
}
