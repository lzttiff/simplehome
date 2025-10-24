import { log } from "console";
import { logWithLevel, LogLevel, LOG_LEVEL } from "./logWithLevel";
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import { OpenAI } from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "default_key"
});

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

  // Ensure dates are at least one week from today
  const oneWeek = oneWeekFromToday.toISOString();
  try {
    const minorDate = new Date(out.nextMaintenanceDates.minor as string);
    if (isNaN(minorDate.getTime()) || minorDate < oneWeekFromToday) out.nextMaintenanceDates.minor = oneWeek;
  } catch {}
  try {
    const majorDate = new Date(out.nextMaintenanceDates.major as string);
    if (isNaN(majorDate.getTime()) || majorDate < oneWeekFromToday) out.nextMaintenanceDates.major = oneWeek;
  } catch {}

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
        minor: { type: 'string', format: 'date-time' },
        major: { type: 'string', format: 'date-time' }
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
      "minorTasks": ["string"],
      "majorIntervalMonths": "string (e.g. 60)",
      "majorTasks": ["string"]
    },
    "reasoning": "string"
  }

If a date would be in the past, set it to a date one week from today. Use ISO 8601 for dates (e.g. 2025-10-25T00:00:00.000Z). If you are unsure about task lists, provide reasonable placeholders (e.g. ["Inspect for cracks", "Check for moisture"]).

Item details:\n- Name: ${item.name}\n- Model: ${item.model || "N/A"}\n- Brand: ${item.brand || "N/A"}\n- Installation Date: ${item.installationDate}\n- Location: ${item.location}\n- Last maintenance Dates: minor=${minorDate}, major=${majorDate}\n
Respond ONLY with valid JSON exactly matching the schema above. No explanations, no markdown fences, no leading/trailing text.`;

  // Support provider selection: "openai" (default) or "gemini"
  const oneWeekFromToday = new Date();
  oneWeekFromToday.setDate(oneWeekFromToday.getDate() + 7);
  const provider = (item as any).provider || "openai";
  logWithLevel("DEBUG", `[AI] Using provider: ${provider} for item: ${item.name} with prompt: ${prompt}`);
  if (provider === "gemini") {
    const { generateGeminiContent } = await import("./gemini");
    const geminiResult = await generateGeminiContent(prompt);
    // Debug: log raw Gemini response (trim large responses)
    try {
      const rawPreview = typeof geminiResult === 'string' ? geminiResult.slice(0, 2000) : JSON.stringify(geminiResult).slice(0, 2000);
      logWithLevel('DEBUG', `[AI] Raw Gemini response preview: ${rawPreview}`);
    } catch (e) {
      logWithLevel('DEBUG', `[AI] Raw Gemini response could not be stringified`);
    }
    // Try to parse Gemini result as JSON and normalize
    let geminiJson: any;
    if (typeof geminiResult === "string") {
      logWithLevel("DEBUG", `[AI] Gemini raw result is a string: ${geminiResult}`);
      try {
        // strip markdown fences if present
        let raw = geminiResult.trim();
        if (raw.startsWith("```json")) raw = raw.replace(/^```json/, "").replace(/```$/, "").trim();
        if (raw.startsWith("```")) raw = raw.replace(/^```/, "").replace(/```$/, "").trim();
        geminiJson = JSON.parse(raw);
      } catch (e) {
        logWithLevel("ERROR", `[AI] Failed to parse Gemini JSON: ${e}`);
        return { error: "Gemini response not valid JSON", raw: geminiResult } as any;
      }
    } else if (typeof geminiResult === "object" && geminiResult !== null) {
      geminiJson = geminiResult;
    } else {
      return { error: "Gemini response not valid format", raw: geminiResult } as any;
    }

    try {
      // If geminiJson is an array, use the first element
      if (Array.isArray(geminiJson)) {
        logWithLevel("DEBUG", `[AI] Gemini result is an array, using first element`);
        geminiJson = geminiJson[0];
        logWithLevel("DEBUG", `[AI] Gemini first element: ${JSON.stringify(geminiJson)}`);
      }
      // Defensive: If geminiJson is still invalid, return an error
      if (!geminiJson || typeof geminiJson !== "object") {
        return { error: "Gemini response does not contain a valid object", raw: geminiJson } as any;
      }

      const normalized = normalizeToMaintenanceAiResult(geminiJson, item.name, oneWeekFromToday);
      // Validate normalized object
      const valid = validateMaintenanceAi(normalized);
      if (!valid) {
        logWithLevel('ERROR', `[AI] Validation failed for Gemini-normalized output: ${JSON.stringify(validateMaintenanceAi.errors)}`);
        const diag: any = { error: 'Normalized result failed schema validation', validationErrors: validateMaintenanceAi.errors, normalized };
        // Include raw only when enabled by env var
        if (process.env.MAINT_AI_INCLUDE_RAW === 'true') diag.raw = geminiResult;
        pushDiagnostic({ provider: 'gemini', itemName: item.name, ...diag });
        return diag as any;
      }
      return normalized;
    } catch (e) {
      logWithLevel("ERROR", `[AI] Gemini processing error: ${e}`);
      const diag: any = { error: 'Gemini response processing error' };
      if (process.env.MAINT_AI_INCLUDE_RAW === 'true') diag.raw = geminiResult;
      pushDiagnostic({ provider: 'gemini', itemName: item.name, ...diag });
      return diag as any;
    }
  } else {
    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are a home maintenance expert." },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" },
      temperature: 0.5,
      max_tokens: 400
    });
    // OpenAI branch: try to parse JSON and normalize to the same shape
    let openaiJson: any = {};
    try {
      const raw = response.choices[0].message.content || "{}";
      // Debug: log raw OpenAI response (trimmed)
      try {
        const preview = String(raw).slice(0, 2000);
        logWithLevel('DEBUG', `[AI] Raw OpenAI response preview: ${preview}`);
      } catch (e) {
        logWithLevel('DEBUG', `[AI] Raw OpenAI response could not be stringified`);
      }
      let content = String(raw).trim();
      if (content.startsWith("```json")) content = content.replace(/^```json/, "").replace(/```$/, "").trim();
      if (content.startsWith("```")) content = content.replace(/^```/, "").replace(/```$/, "").trim();
      openaiJson = JSON.parse(content);
    } catch (e) {
      logWithLevel("ERROR", `[OPENAI] Failed to parse JSON response: ${e}`);
      return { error: "OpenAI response not valid JSON", raw: response.choices[0].message.content } as any;
    }
    const normalizedOpen = normalizeToMaintenanceAiResult(openaiJson, item.name, oneWeekFromToday);
    const validOpen = validateMaintenanceAi(normalizedOpen);
    if (!validOpen) {
      logWithLevel('ERROR', `[AI] Validation failed for OpenAI-normalized output: ${JSON.stringify(validateMaintenanceAi.errors)}`);
      const diag: any = { error: 'Normalized result failed schema validation', validationErrors: validateMaintenanceAi.errors, normalized: normalizedOpen };
      if (process.env.MAINT_AI_INCLUDE_RAW === 'true') diag.raw = response;
      pushDiagnostic({ provider: 'openai', itemName: item.name, ...diag });
      return diag as any;
    }
    return normalizedOpen;
  }
}

export async function generateCategoryMaintenanceSchedules(items: CatalogItem[]): Promise<any[]> {
  const results: any[] = [];
  const oneWeekFromToday = new Date();
  oneWeekFromToday.setDate(oneWeekFromToday.getDate() + 7);
  for (const item of items) {
    const result = await generateMaintenanceSchedule(item);
    // Ensure nextMaintenanceDates entries are at least a week from today
    try {
      const minor = result?.nextMaintenanceDates?.minor;
      if (minor) {
        const minorDate = new Date(minor);
        if (isNaN(minorDate.getTime()) || minorDate < oneWeekFromToday) {
          result.nextMaintenanceDates.minor = oneWeekFromToday.toISOString();
          logWithLevel("INFO", `[AI] Adjusted nextMaintenanceDates.minor for item: ${item.name} to ${result.nextMaintenanceDates.minor}`);
        }
      }
    } catch {}
    try {
      const major = result?.nextMaintenanceDates?.major;
      if (major) {
        const majorDate = new Date(major);
        if (isNaN(majorDate.getTime()) || majorDate < oneWeekFromToday) {
          result.nextMaintenanceDates.major = oneWeekFromToday.toISOString();
          logWithLevel("INFO", `[AI] Adjusted nextMaintenanceDates.major for item: ${item.name} to ${result.nextMaintenanceDates.major}`);
        }
      }
    } catch {}
    logWithLevel("DEBUG", `[AI] Generated maintenance schedule for item: ${item.name}`);
    results.push(result);
  }
  logWithLevel("DEBUG", `[AI] Generated maintenance schedules for category: ${JSON.stringify(results)}`);
  return results;
}
