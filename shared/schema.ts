import { z } from "zod";

// Pure TypeScript types - MongoDB handles validation via JSON Schema
// See shared/schemas/*.schema.json for MongoDB validation schemas

// User Types
export interface User {
  id: string;
  email: string;
  passwordHash: string;
  name: string;
  timezone: string | null;
  createdAt: Date;
}

export interface InsertUser {
  email: string;
  password: string;
  name: string;
  timezone?: string | null;
}

// Property Template Types
export interface PropertyTemplate {
  id: string;
  name: string;
  type: string;
  description: string;
  taskCount: number | null;
  createdAt: Date | null;
}

export interface InsertPropertyTemplate {
  name: string;
  type: string;
  description: string;
  taskCount?: number | null;
}

export interface CalendarExportRecord {
  provider: "google" | "apple";
  syncMode?: "subscription" | "direct" | "file";
  eventIds: {
    minor?: string;
    major?: string;
  };
  eventLinks?: {
    minor?: string;
    major?: string;
  };
  selected?: {
    minor?: boolean;
    major?: boolean;
  };
  syncedDates?: {
    minor?: string;
    major?: string;
  };
  calendarId?: string | null;
  lastSyncedAt: string;
}

type LegacyCalendarExportMap = Partial<
  Record<
    "google" | "apple",
    {
      eventIds?: {
        minor?: string;
        major?: string;
      };
      eventLinks?: {
        minor?: string;
        major?: string;
      };
      exportedAt?: string;
      lastSyncedAt?: string;
    }
  >
>;

export function normalizeCalendarExports(raw: string | null | undefined): CalendarExportRecord[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as CalendarExportRecord[] | LegacyCalendarExportMap;
    if (Array.isArray(parsed)) {
      return parsed
        .filter((entry) => entry && (entry.provider === "google" || entry.provider === "apple"))
        .map((entry) => ({
          provider: entry.provider,
          syncMode: entry.syncMode,
          eventIds: entry.eventIds ?? {},
          eventLinks: entry.eventLinks,
          selected: entry.selected,
          syncedDates: entry.syncedDates,
          calendarId: entry.calendarId ?? null,
          lastSyncedAt: entry.lastSyncedAt ?? new Date(0).toISOString(),
        }));
    }

    if (parsed && typeof parsed === "object") {
      return Object.entries(parsed)
        .filter(([provider]) => provider === "google" || provider === "apple")
        .map(([provider, value]) => ({
          provider: provider as "google" | "apple",
          eventIds: value?.eventIds ?? {},
          eventLinks: value?.eventLinks,
          lastSyncedAt: value?.lastSyncedAt ?? value?.exportedAt ?? new Date(0).toISOString(),
        }));
    }
  } catch {
    return [];
  }

  return [];
}

export function serializeCalendarExports(records: CalendarExportRecord[]): string | null {
  if (records.length === 0) {
    return null;
  }

  return JSON.stringify(records);
}

const DATE_ONLY_PREFIX_REGEX = /^(\d{4})-(\d{2})-(\d{2})/;

export function normalizeDateOnly(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  const prefixMatch = trimmed.match(DATE_ONLY_PREFIX_REGEX);
  if (prefixMatch) {
    return `${prefixMatch[1]}-${prefixMatch[2]}-${prefixMatch[3]}`;
  }

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }

  return parsed.toISOString().slice(0, 10);
}

export function toDateOnlyFromLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dateOnlyToUtcIsoString(value: string | null | undefined): string | null {
  const normalized = normalizeDateOnly(value);
  return normalized ? `${normalized}T00:00:00.000Z` : null;
}

export function addMonthsToDateOnly(value: string | null | undefined, months: number): string | null {
  const normalized = normalizeDateOnly(value);
  if (!normalized) {
    return null;
  }

  const [year, month, day] = normalized.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day));
  next.setUTCMonth(next.getUTCMonth() + months);
  return next.toISOString().slice(0, 10);
}

export function compareDateOnly(left: string | null | undefined, right: string | null | undefined): number {
  const a = normalizeDateOnly(left);
  const b = normalizeDateOnly(right);

  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  return a.localeCompare(b);
}

export function dayDiffDateOnly(target: string | null | undefined, baseline: string | null | undefined): number | null {
  const a = normalizeDateOnly(target);
  const b = normalizeDateOnly(baseline);
  if (!a || !b) {
    return null;
  }

  const [ay, am, ad] = a.split("-").map(Number);
  const [by, bm, bd] = b.split("-").map(Number);
  const aUtc = Date.UTC(ay, am - 1, ad);
  const bUtc = Date.UTC(by, bm - 1, bd);
  return Math.ceil((aUtc - bUtc) / (1000 * 60 * 60 * 24));
}

export type MaintenanceScheduleDates = {
  minor: string | null;
  major: string | null;
};

export function parseMaintenanceSchedule(raw: string | null | undefined): MaintenanceScheduleDates {
  if (!raw) {
    return { minor: null, major: null };
  }

  try {
    const parsed = JSON.parse(raw) as { minor?: string | null; major?: string | null };
    if (parsed && typeof parsed === "object") {
      return {
        minor: normalizeDateOnly(parsed.minor ?? null),
        major: normalizeDateOnly(parsed.major ?? null),
      };
    }
  } catch {
    // Legacy rows may store a plain date string instead of a JSON object.
    return { minor: normalizeDateOnly(raw), major: null };
  }

  return { minor: null, major: null };
}

export function serializeMaintenanceSchedule(value: MaintenanceScheduleDates): string {
  return JSON.stringify({
    minor: normalizeDateOnly(value.minor),
    major: normalizeDateOnly(value.major),
  });
}

// Maintenance Task Types
export interface MaintenanceTask {
  id: string;
  userId: string | null;
  title: string;
  description: string;
  category: string;
  priority: string; // Low, Medium, High, Urgent
  status: string; // pending, completed, overdue
  lastMaintenanceDate: string | null; // JSON: {minor: "YYYY-MM-DD"|null, major: "YYYY-MM-DD"|null}
  nextMaintenanceDate: string | null; // JSON: {minor: "YYYY-MM-DD"|null, major: "YYYY-MM-DD"|null}
  isTemplate: boolean | null;
  isAiGenerated: boolean | null;
  templateId: string | null;
  notes: string | null;
  brand: string | null;
  model: string | null;
  serialNumber: string | null;
  location: string | null;
  installationDate: Date | null;
  warrantyPeriodMonths: number | null;
  minorIntervalMonths: number | null;
  majorIntervalMonths: number | null;
  minorTasks: string | null; // JSON array stored as text
  majorTasks: string | null; // JSON array stored as text
  relatedItemIds: string | null; // JSON array stored as text
  calendarExports?: string | null; // JSON array stored as text
  dueDate?: Date | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface InsertMaintenanceTask {
  userId?: string | null;
  title: string;
  description: string;
  category: string;
  priority: string;
  status?: string;
  lastMaintenanceDate?: string | null;
  nextMaintenanceDate?: string | null;
  isTemplate?: boolean | null;
  isAiGenerated?: boolean | null;
  templateId?: string | null;
  notes?: string | null;
  brand?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  location?: string | null;
  installationDate?: Date | null;
  warrantyPeriodMonths?: number | null;
  minorIntervalMonths?: number | null;
  majorIntervalMonths?: number | null;
  minorTasks?: string | null;
  majorTasks?: string | null;
  relatedItemIds?: string | null;
  calendarExports?: string | null;
  dueDate?: Date | null;
}

// Questionnaire Response Types
export interface QuestionnaireResponse {
  id: string;
  userId: string | null;
  sessionId: string;
  responses: string; // JSON string
  propertyType: string;
  createdAt: Date | null;
}

export interface InsertQuestionnaireResponse {
  userId?: string | null;
  sessionId: string;
  responses: string;
  propertyType: string;
}

// Zod schemas for client-side form validation (kept for react-hook-form compatibility)
export const insertMaintenanceTaskSchema = z.object({
  title: z.string().min(1, "Title is required"),
  description: z.string(),
  category: z.string().min(1, "Category is required"),
  priority: z.string().min(1, "Priority is required"),
  status: z.string().optional(),
  lastMaintenanceDate: z.string().nullable().optional(),
  nextMaintenanceDate: z.string().nullable().optional(),
  isTemplate: z.boolean().nullable().optional(),
  isAiGenerated: z.boolean().nullable().optional(),
  templateId: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  brand: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  serialNumber: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  installationDate: z.date().nullable().optional(),
  warrantyPeriodMonths: z.number().nullable().optional(),
  minorIntervalMonths: z.number().nullable().optional(),
  majorIntervalMonths: z.number().nullable().optional(),
  minorTasks: z.string().nullable().optional(),
  majorTasks: z.string().nullable().optional(),
  relatedItemIds: z.string().nullable().optional(),
  calendarExports: z.string().nullable().optional(),
  dueDate: z.date().nullable().optional(),
});

export const insertQuestionnaireResponseSchema = z.object({
  sessionId: z.string().min(1, "Session ID is required"),
  responses: z.string().min(1, "Responses are required"),
  propertyType: z.string().min(1, "Property type is required"),
});

// Auth Zod schemas for client-side form validation
export const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  name: z.string().min(1, "Name is required"),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

// Validation helper for API routes
export function validateInsertMaintenanceTask(data: unknown): { valid: boolean; errors?: string[] } {
  const result = insertMaintenanceTaskSchema.safeParse(data);
  if (result.success) {
    return { valid: true };
  }
  return { 
    valid: false, 
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
  };
}

export function validateInsertQuestionnaireResponse(data: unknown): { valid: boolean; errors?: string[] } {
  const result = insertQuestionnaireResponseSchema.safeParse(data);
  if (result.success) {
    return { valid: true };
  }
  return { 
    valid: false, 
    errors: result.error.errors.map(e => `${e.path.join('.')}: ${e.message}`)
  };
}
