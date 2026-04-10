import { log } from "console";
import { logWithLevel, LogLevel, LOG_LEVEL } from "./logWithLevel";
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { OpenAI } from "openai";
import { normalizeDateOnly } from "../../shared/schema";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "default_key"
});

type AiProvider = "openai" | "gemini";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientAiError(error: unknown): boolean {
  const e = error as any;
  const status = Number(e?.status ?? e?.response?.status ?? e?.code);
  if ([408, 409, 425, 429, 500, 502, 503, 504].includes(status)) {
    return true;
  }

  const code = String(e?.code ?? "").toUpperCase();
  if (["ETIMEDOUT", "ECONNRESET", "ECONNABORTED", "EAI_AGAIN", "ENOTFOUND"].includes(code)) {
    return true;
  }

  const message = String(e?.message ?? e ?? "").toLowerCase();
  return (
    message.includes("rate limit") ||
    message.includes("quota") ||
    message.includes("timeout") ||
    message.includes("temporar") ||
    message.includes("unavailable") ||
    message.includes("overloaded")
  );
}

async function runWithExponentialBackoff<T>(
  opName: string,
  fn: () => Promise<T>,
  maxAttempts = 4,
  baseDelayMs = 700,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const retryable = isTransientAiError(error);
      if (!retryable || attempt === maxAttempts) {
        throw error;
      }
      const jitter = Math.floor(Math.random() * 200);
      const waitMs = baseDelayMs * (2 ** (attempt - 1)) + jitter;
      logWithLevel("WARN", `[AI] ${opName} transient failure attempt ${attempt}/${maxAttempts}; retrying in ${waitMs}ms`);
      await delay(waitMs);
    }
  }
  throw lastError;
}

function stripJsonCodeFence(raw: string): string {
  let content = raw.trim();
  if (content.startsWith("```json")) content = content.replace(/^```json/, "").replace(/```$/, "").trim();
  if (content.startsWith("```")) content = content.replace(/^```/, "").replace(/```$/, "").trim();
  return content;
}

function parseProviderJson(rawResult: unknown): { parsed?: any; rawText: string; error?: string } {
  if (typeof rawResult === "object" && rawResult !== null) {
    return { parsed: rawResult, rawText: JSON.stringify(rawResult) };
  }
  if (typeof rawResult !== "string") {
    return { rawText: String(rawResult), error: "Provider returned non-string/non-object payload" };
  }

  const rawText = rawResult;
  try {
    return { parsed: JSON.parse(stripJsonCodeFence(rawResult)), rawText };
  } catch (error) {
    return {
      rawText,
      error: error instanceof Error ? error.message : "Failed to parse JSON",
    };
  }
}

async function requestSchemaRepair(
  provider: AiProvider,
  rawText: string,
  itemName: string,
): Promise<unknown> {
  const repairPrompt = `Fix this payload so it is valid JSON and EXACTLY matches this schema. Return ONLY JSON, no markdown, no explanation.

Schema:
{
  "name": "string",
  "nextMaintenanceDates": {
    "minor": "YYYY-MM-DD",
    "major": "YYYY-MM-DD"
  },
  "maintenanceSchedule": {
    "minorIntervalMonths": "string",
    "minorTasks": ["task 1", "task 2", "task 3"],
    "majorIntervalMonths": "string",
    "majorTasks": ["task 1", "task 2", "task 3"]
  },
  "reasoning": "string"
}

Item name: ${itemName}
Payload to fix:
${rawText.slice(0, 12000)}`;

  if (provider === "gemini") {
    const { generateGeminiContent } = await import("./gemini");
    return runWithExponentialBackoff(`Gemini schema repair for ${itemName}`, async () =>
      generateGeminiContent(repairPrompt),
    );
  }

  const repaired = await runWithExponentialBackoff(`OpenAI schema repair for ${itemName}`, async () =>
    openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You repair malformed JSON into an exact target schema." },
        { role: "user", content: repairPrompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0,
      max_tokens: 500,
    }),
  );
  return repaired.choices[0].message.content || "{}";
}

async function callProviderGenerate(provider: AiProvider, prompt: string, itemName: string): Promise<unknown> {
  if (provider === "gemini") {
    const { generateGeminiContent } = await import("./gemini");
    return runWithExponentialBackoff(`Gemini request for ${itemName}`, async () => generateGeminiContent(prompt));
  }

  const response = await runWithExponentialBackoff(`OpenAI request for ${itemName}`, async () =>
    openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are a home maintenance expert." },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.5,
      max_tokens: 400
    }),
  );
  return response.choices[0].message.content || "{}";
}

async function normalizeWithRepair(
  provider: AiProvider,
  rawResult: unknown,
  itemName: string,
  oneWeekFromToday: Date,
): Promise<{ normalized?: MaintenanceAiResult; repaired: boolean; error?: string }> {
  const firstPass = parseProviderJson(rawResult);
  if (firstPass.parsed && typeof firstPass.parsed === "object") {
    const normalized = normalizeToMaintenanceAiResult(firstPass.parsed, itemName, oneWeekFromToday);
    if (validateMaintenanceAi(normalized)) {
      return { normalized, repaired: false };
    }
  }

  try {
    const repairedRaw = await requestSchemaRepair(provider, firstPass.rawText, itemName);
    const repairedParsed = parseProviderJson(repairedRaw);
    if (repairedParsed.parsed && typeof repairedParsed.parsed === "object") {
      const repairedNormalized = normalizeToMaintenanceAiResult(repairedParsed.parsed, itemName, oneWeekFromToday);
      if (validateMaintenanceAi(repairedNormalized)) {
        return { normalized: repairedNormalized, repaired: true };
      }
      return { repaired: true, error: "Validation failed after schema repair" };
    }
    return { repaired: true, error: repairedParsed.error || "Schema repair output not parseable" };
  } catch (error) {
    return {
      repaired: false,
      error: error instanceof Error ? error.message : "Schema repair failed",
    };
  }
}

export interface CatalogItem {
  id: string;
  name: string;
  brand?: string;
  model?: string; // Some items may use as Type
  installationDate: string;
  lastMaintenanceDates?: {
    minor?: string;
    major?: string;
  };
  location: string;
  notes?: string;
  maintenanceSchedule: {
    minor: string;
    major: string;
  };
  reasoning?: string;
  provider?: "openai" | "gemini";
}

export interface MaintenanceAiResult {
  nextMaintenanceDates: {
    minor: string;
    major: string;
  };
  name: string;
  maintenanceSchedule: {
    minorIntervalMonths: string;
    minorTasks: Array<string>;
    majorIntervalMonths: string;
    majorTasks: Array<string>;
  };
  reasoning: string;
}

// Exported helper so we can unit test normalization logic separately
export function normalizeToMaintenanceAiResult(raw: any, fallbackName: string, oneWeekFromToday: Date): MaintenanceAiResult {
  const item = { name: fallbackName } as any;
  const normalizeDateValue = (value: string | null): string | null => {
    if (!value) return value;
    const trimmed = value.trim();
    if (!trimmed) return trimmed;

    return normalizeDateOnly(trimmed);
  };

  const out: any = {
    name: raw?.name || raw?.Name || fallbackName || "",
    nextMaintenanceDates: {
      minor: raw?.nextMaintenanceDates?.minor || raw?.nextMinorServiceDate || raw?.nextMinor || raw?.nextMinorService || raw?.nextMinorDate || null,
      major: raw?.nextMaintenanceDates?.major || raw?.nextMajorServiceDate || raw?.nextMajor || raw?.nextMajorService || raw?.nextMajorDate || null,
    },
    maintenanceSchedule: {
      minorIntervalMonths: "",
      minorTasks: [] as string[],
      majorIntervalMonths: "",
      majorTasks: [] as string[],
    },
    reasoning: raw?.reasoning || raw?.Reasoning || (raw && raw["Maintenance Schedule"] && raw["Maintenance Schedule"].reasoning) || raw?.reason || "",
  };

  // Repair dates: coerce to string when present
  if (out.nextMaintenanceDates.minor && typeof out.nextMaintenanceDates.minor !== 'string') {
    out.nextMaintenanceDates.minor = String(out.nextMaintenanceDates.minor);
  }
  if (out.nextMaintenanceDates.major && typeof out.nextMaintenanceDates.major !== 'string') {
    out.nextMaintenanceDates.major = String(out.nextMaintenanceDates.major);
  }

  out.nextMaintenanceDates.minor = normalizeDateValue(out.nextMaintenanceDates.minor);
  out.nextMaintenanceDates.major = normalizeDateValue(out.nextMaintenanceDates.major);

  // maintenance schedule variants
  const ms = raw?.maintenanceSchedule || raw?.maintenanceScheduleRecommendation || raw?.["Maintenance Schedule"] || raw?.["MaintenanceSchedule"] || {};
  const toArray = (v: any): string[] => {
    if (!v) return [];
    if (Array.isArray(v)) return v.map(String);
    if (typeof v === 'string') return v.split(/\n|;|,\s?/).map((s: string) => s.trim()).filter(Boolean);
    return [];
  }
  out.maintenanceSchedule.minorIntervalMonths = ms.minorIntervalMonths || ms.MinorIntervalMonths || ms.Minor || ms.minor || ms.minorInterval || "";
  out.maintenanceSchedule.majorIntervalMonths = ms.majorIntervalMonths || ms.MajorIntervalMonths || ms.Major || ms.major || ms.majorInterval || "";
  out.maintenanceSchedule.minorTasks = toArray(ms.minorTasks || ms.MinorTasks || ms.Minor || ms.minorTasksString || ms.minorTasksString || "");
  out.maintenanceSchedule.majorTasks = toArray(ms.majorTasks || ms.MajorTasks || ms.Major || ms.majorTasksString || ms.majorTasksString || "");

  // If intervals are words like 'Annually', try to convert to months (best-effort)
  const parseInterval = (s: string) => {
    if (!s) return s;
    const lower = s.toLowerCase();
    if (lower.includes('annual') || lower === 'annually') return '12';
    if (lower.includes('monthly') || lower === 'monthly') return '1';
    if (lower.includes('quarter') || lower.includes('3 months')) return '3';
    if (lower.includes('year') || lower.includes('5 years')) return '60';
    const m = s.match(/(\d+)\s*month/);
    if (m) return m[1];
    const n = s.match(/^(\d+)$/);
    if (n) return n[1];
    return s;
  }
  out.maintenanceSchedule.minorIntervalMonths = parseInterval(out.maintenanceSchedule.minorIntervalMonths || '');
  out.maintenanceSchedule.majorIntervalMonths = parseInterval(out.maintenanceSchedule.majorIntervalMonths || '');

  // Ensure dates are at least one week from today (date-only semantics).
  const oneWeek = normalizeDateOnly(oneWeekFromToday.toISOString()) as string;
  const ensureDateAtLeast = (value: string | null): string => {
    const normalized = normalizeDateOnly(value);
    if (!normalized || normalized < oneWeek) return oneWeek;
    return normalized;
  };
  out.nextMaintenanceDates.minor = ensureDateAtLeast(out.nextMaintenanceDates.minor);
  out.nextMaintenanceDates.major = ensureDateAtLeast(out.nextMaintenanceDates.major);

  return out as MaintenanceAiResult;
}

// AJV schema to validate the normalized object at runtime
const ajv = new Ajv({ allErrors: true, coerceTypes: false, removeAdditional: false });
addFormats(ajv);
const maintenanceAiSchema = {
  type: 'object',
  required: ['name', 'nextMaintenanceDates', 'maintenanceSchedule', 'reasoning'],
  additionalProperties: false,
  properties: {
    name: { type: 'string' },
    nextMaintenanceDates: {
      type: 'object',
      required: ['minor', 'major'],
      additionalProperties: false,
      properties: {
        minor: { type: 'string', format: 'date' },
        major: { type: 'string', format: 'date' }
      }
    },
    maintenanceSchedule: {
      type: 'object',
      required: ['minorIntervalMonths', 'minorTasks', 'majorIntervalMonths', 'majorTasks'],
      additionalProperties: false,
      properties: {
        minorIntervalMonths: { type: 'string' },
        minorTasks: { type: 'array', items: { type: 'string' } },
        majorIntervalMonths: { type: 'string' },
        majorTasks: { type: 'array', items: { type: 'string' } }
      }
    },
    reasoning: { type: 'string' }
  }
};
const validateMaintenanceAi = ajv.compile(maintenanceAiSchema as any);

// In-memory diagnostics store (keep recent N entries)
const DIAGNOSTICS_MAX = 100;
const diagnosticsStore: Array<any> = [];

function pushDiagnostic(entry: any) {
  try {
    diagnosticsStore.push({ ts: new Date().toISOString(), ...entry });
    if (diagnosticsStore.length > DIAGNOSTICS_MAX) diagnosticsStore.shift();
  } catch (e) {
    // ignore
  }
}

export function getDiagnostics() {
  return diagnosticsStore.slice();
}

export function clearDiagnostics() {
  diagnosticsStore.length = 0;
}

export async function generateMaintenanceSchedule(item: CatalogItem): Promise<any> {
  // Use installationDate as fallback for missing service dates
  const minorDate = item.lastMaintenanceDates?.minor || item.installationDate;
  const majorDate = item.lastMaintenanceDates?.major || item.installationDate;

  // For Foundation, treat model as Type
  const typeOrModel = item.name === "Foundation" ? item.model : item.model;

  // Strongly worded prompt that requests an exact JSON schema matching MaintenanceAiResult
  const prompt = `You are a home maintenance expert. Given the following household item and its attributes, return ONLY a single JSON object that EXACTLY matches this schema (no extra text, no markdown):

  {
    "name": "string",
    "nextMaintenanceDates": {
      "minor": "ISO8601 date string",
      "major": "ISO8601 date string"
    },
    "maintenanceSchedule": {
      "minorIntervalMonths": "string (e.g. 12)",
      "minorTasks": ["task 1", "task 2", "task 3"],
      "majorIntervalMonths": "string (e.g. 60)",
      "majorTasks": ["task 1", "task 2", "task 3"]
    },
    "reasoning": "string"
  }

CRITICAL REQUIREMENTS:
1. minorTasks MUST be an array with at least 3-5 specific maintenance tasks
2. majorTasks MUST be an array with at least 3-5 specific maintenance tasks
3. Tasks must be specific to the item type (${item.name})
4. DO NOT return empty arrays [] for minorTasks or majorTasks
5. Use YYYY-MM-DD format for dates (e.g. 2025-12-12)
6. If a date would be in the past, set it to a date one week from today

Item details:
- Name: ${item.name}
- Model: ${item.model || "N/A"}
- Brand: ${item.brand || "N/A"}
- Installation Date: ${item.installationDate || "N/A"}
- Location: ${item.location}
- Last maintenance Dates: minor=${minorDate}, major=${majorDate}

Example for Indoor Lights:
minorTasks: ["Replace burnt out bulbs", "Clean light fixtures and shades", "Check for flickering or dimming", "Dust ceiling fixtures", "Test light switches"]
majorTasks: ["Inspect all wiring connections", "Replace aging light fixtures", "Upgrade to LED bulbs", "Check electrical panel connections", "Professional electrical inspection"]

Respond ONLY with valid JSON exactly matching the schema above. No explanations, no markdown fences, no leading/trailing text.`;

  // Support provider selection with automatic failover.
  const oneWeekFromToday = new Date();
  oneWeekFromToday.setDate(oneWeekFromToday.getDate() + 7);
  const primaryProvider = ((item as any).provider || process.env.DEFAULT_AI_PROVIDER || "gemini") as AiProvider;
  const secondaryProvider: AiProvider = primaryProvider === "gemini" ? "openai" : "gemini";
  const providersToTry: AiProvider[] = [primaryProvider, secondaryProvider];
  let lastFailure = "Unknown AI generation failure";

  for (let idx = 0; idx < providersToTry.length; idx++) {
    const provider = providersToTry[idx];
    try {
      logWithLevel("DEBUG", `[AI] Attempting provider=${provider} for item=${item.name}`);
      const raw = await callProviderGenerate(provider, prompt, item.name);
      const normalized = await normalizeWithRepair(provider, raw, item.name, oneWeekFromToday);
      if (normalized.normalized) {
        return {
          ...normalized.normalized,
          _meta: {
            providerUsed: provider,
            fallbackUsed: idx > 0,
            repaired: normalized.repaired,
          },
        } as any;
      }

      lastFailure = `${provider}: ${normalized.error || "normalized output invalid"}`;
      pushDiagnostic({
        provider,
        itemName: item.name,
        error: "Normalized result invalid",
        details: normalized.error,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      lastFailure = `${provider}: ${errorMessage}`;
      pushDiagnostic({ provider, itemName: item.name, error: "Provider request failed", details: errorMessage });
    }
  }

  return {
    error: "All providers failed",
    itemName: item.name,
    message: lastFailure,
    _meta: {
      providerUsed: primaryProvider,
      fallbackUsed: true,
      repaired: false,
    },
  } as any;
}

export async function generateCategoryMaintenanceSchedules(items: CatalogItem[]): Promise<any[]> {
  const results: any[] = [];
  const oneWeekFromToday = new Date();
  oneWeekFromToday.setDate(oneWeekFromToday.getDate() + 7);
  const oneWeek = normalizeDateOnly(oneWeekFromToday.toISOString()) as string;
  for (const item of items) {
    let result: any;
    try {
      result = await generateMaintenanceSchedule(item);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logWithLevel("ERROR", `[AI] Failed to generate maintenance schedule for ${item.name}: ${errorMessage}`);
      result = {
        error: "Provider request failed after retries",
        itemId: item.id,
        itemName: item.name,
        message: errorMessage,
      };
      results.push(result);
      continue;
    }
    // Ensure nextMaintenanceDates entries are at least a week from today
    try {
      const minor = normalizeDateOnly(result?.nextMaintenanceDates?.minor);
      if (minor) {
        if (minor < oneWeek) {
          result.nextMaintenanceDates.minor = oneWeek;
          logWithLevel("INFO", `[AI] Adjusted nextMaintenanceDates.minor for item: ${item.name} to ${result.nextMaintenanceDates.minor}`);
        }
      } else if (result?.nextMaintenanceDates) {
        result.nextMaintenanceDates.minor = oneWeek;
      }
    } catch {}
    try {
      const major = normalizeDateOnly(result?.nextMaintenanceDates?.major);
      if (major) {
        if (major < oneWeek) {
          result.nextMaintenanceDates.major = oneWeek;
          logWithLevel("INFO", `[AI] Adjusted nextMaintenanceDates.major for item: ${item.name} to ${result.nextMaintenanceDates.major}`);
        }
      } else if (result?.nextMaintenanceDates) {
        result.nextMaintenanceDates.major = oneWeek;
      }
    } catch {}
    logWithLevel("DEBUG", `[AI] Generated maintenance schedule for item: ${item.name}`);
    results.push(result);
  }
  logWithLevel("DEBUG", `[AI] Generated maintenance schedules for category: ${JSON.stringify(results)}`);
  return results;
}
