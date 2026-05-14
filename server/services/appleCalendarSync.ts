import type express from "express";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { storage, type AppleCalendarSyncSelection } from "../storage";
import { DAVClient, type DAVCalendar, type DAVCalendarObject } from "tsdav";
import {
  normalizeCalendarExports,
  normalizeDateOnly,
  serializeCalendarExports,
  type CalendarExportRecord,
  type MaintenanceTask,
} from "@shared/schema";
import { deriveDoneCompletionDates, deriveRescheduleBacklogState } from "./googleCalendarSync";

type AppleSyncSelection = {
  taskId: string;
  includeMinor: boolean;
  includeMajor: boolean;
};

type AppleCalendarSyncStatus = {
  configured: boolean;
  connected: boolean;
  accountEmail: string | null;
  calendarId: string | null;
  resolvedCalendarDisplayName?: string | null;
  resolvedCalendarUrl?: string | null;
  lastSyncedAt: string | null;
  activeScopeCount?: number;
  syncScopeVersion?: number;
  syncScopeUpdatedAt?: string | null;
};

type DisconnectAppleCalendarOptions = {
  deleteCalendar?: boolean;
};

type DisconnectAppleCalendarOutcome = {
  disconnected: true;
  calendarDeleteRequested: boolean;
  calendarDeleted: boolean;
  calendarDeleteMessage: string | null;
  eventsDeleted: number;
  eventsFailed: number;
};

type AppleSyncOutcome = {
  syncedTasks: number;
  pushedEvents: number;
  pulledChanges: number;
  createdEvents: number;
  updatedEvents: number;
  completedFromApple: number;
  rescheduledFromApple: number;
  failedOperations?: number;
  lastSyncedAt: string;
  calendarId: string;
};

type ConnectAppleCalendarInput = {
  appleIdEmail: string;
  appSpecificPassword: string;
  calendarId?: string | null;
};

type SyncScopeOutcome = {
  activeSelections: AppleSyncSelection[];
  initializedFromRequest: boolean;
};

type SyncKind = "minor" | "major";
type ScopeRemoval = {
  taskId: string;
  kind: SyncKind;
};
type SyncErrorCategory = "network" | "auth" | "provider" | "unknown";
type AppleConflictWinner = "local" | "remote";
type ResolveAppleConflictArgs = {
  localChanged: boolean;
  remoteChanged: boolean;
  localUpdatedAt: Date | string | null | undefined;
  remoteLastModifiedAt: Date | string | null | undefined;
  lastSyncedAt: Date | string | null | undefined;
};

type AppleSyncErrorDiagnostics = {
  category: SyncErrorCategory;
  status: number | null;
  code: string | null;
  name: string | null;
  signalText: string;
  message: string;
};

const SAFE_APPLE_ERROR_MESSAGES = new Set([
  "Not authenticated",
  "Select at least one task to sync.",
  "Select at least one task to include in sync scope.",
  "Apple Calendar is not connected.",
  "Apple Calendar credentials are missing. Reconnect Apple Calendar.",
  "Apple Calendar sync is not configured. Set APPLE_SYNC_ENCRYPTION_KEY.",
  "Provide a valid Apple ID email.",
  "Provide an app-specific password.",
  "Unable to authenticate Apple CalDAV credentials. Check Apple ID and app-specific password.",
  "No Apple calendars were found for this account.",
  "Invalid encrypted Apple credential payload.",
]);

const APPLE_SYNC_DEBUG = process.env.APPLE_SYNC_DEBUG === "true";
const DEV_FALLBACK_KEY = "simplehome-dev-apple-sync-key";
const APPLE_SYNC_PROVIDER = "apple";
const APPLE_SYNC_MODE = "direct";
const DEFAULT_APPLE_CALDAV_SERVER_URL = "https://caldav.icloud.com";

function logAppleSyncDebug(message: string) {
  if (APPLE_SYNC_DEBUG) {
    console.log(`[Apple Sync] ${message}`);
  }
}

function logAppleSyncInfo(message: string) {
  console.log(`[Apple Sync] ${message}`);
}

function sanitizeAppleSyncDebugMessage(raw: unknown, fallbackMessage: string): string {
  const input = (typeof raw === "string" ? raw : errorToString(raw)).trim();
  if (!input) {
    return fallbackMessage;
  }

  // Redact likely credentials/secrets while preserving enough diagnostics to debug.
  const redacted = input
    .replace(/([\w.%+-]+)@([\w.-]+\.[A-Za-z]{2,})/g, "<redacted-email>")
    .replace(/\b(?:[A-Za-z0-9]{4}-){3}[A-Za-z0-9]{4}\b/g, "<redacted-app-password>")
    .replace(/\b(?:bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi, "<redacted-auth-header>")
    .replace(/\b(token|secret|password|credential)\s*[:=]\s*[^\s,;]+/gi, "$1=<redacted>");

  // Keep logs compact.
  return redacted.slice(0, 280);
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

function extractDavResponseSummary(response: unknown): string {
  const anyResponse = response as Record<string, unknown> | null;
  if (!anyResponse) {
    return "response=n/a";
  }

  const ok = typeof anyResponse.ok === "boolean" ? anyResponse.ok : null;
  const status = typeof anyResponse.status === "number" ? anyResponse.status : null;
  const statusText = typeof anyResponse.statusText === "string" ? anyResponse.statusText : null;

  return `response.ok=${ok === null ? "n/a" : String(ok)} status=${status === null ? "n/a" : String(status)} statusText=${statusText || "n/a"}`;
}

export function sanitizeAppleSyncErrorMessage(error: unknown, fallbackMessage: string): string {
  const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const message = (raw || "").trim();

  if (!message) {
    return fallbackMessage;
  }

  if (SAFE_APPLE_ERROR_MESSAGES.has(message)) {
    return message;
  }

  // Defensive redaction gate: if unknown message contains obvious secret-related tokens,
  // never return it to clients.
  const lower = message.toLowerCase();
  const hasSensitiveKeyword =
    lower.includes("password") ||
    lower.includes("authorization") ||
    lower.includes("bearer") ||
    lower.includes("basic ") ||
    lower.includes("token") ||
    lower.includes("credential") ||
    lower.includes("secret");

  if (hasSensitiveKeyword) {
    return fallbackMessage;
  }

  // Unknown provider/library errors should not be surfaced verbatim.
  return fallbackMessage;
}

function getUserId(req: express.Request): string {
  const userId = (req.user as { id?: string } | undefined)?.id;
  if (!userId) {
    throw new Error("Not authenticated");
  }
  return userId;
}

function getEncryptionSecret(): string | null {
  const configured = process.env.APPLE_SYNC_ENCRYPTION_KEY?.trim();
  if (configured) {
    return configured;
  }

  if (process.env.NODE_ENV === "production") {
    return null;
  }

  return DEV_FALLBACK_KEY;
}

function isAppleCalendarConfigured(): boolean {
  return !!getEncryptionSecret();
}

function toKey(secret: string): Buffer {
  return createHash("sha256").update(secret).digest();
}

function encryptSecret(plainText: string): string {
  const secret = getEncryptionSecret();
  if (!secret) {
    throw new Error("Apple Calendar sync is not configured. Set APPLE_SYNC_ENCRYPTION_KEY.");
  }

  const iv = randomBytes(12);
  const key = toKey(secret);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

function decryptSecret(value: string): string {
  const secret = getEncryptionSecret();
  if (!secret) {
    throw new Error("Apple Calendar sync is not configured. Set APPLE_SYNC_ENCRYPTION_KEY.");
  }

  const [ivRaw, tagRaw, payloadRaw] = value.split(".");
  if (!ivRaw || !tagRaw || !payloadRaw) {
    throw new Error("Invalid encrypted Apple credential payload.");
  }

  const key = toKey(secret);
  const iv = Buffer.from(ivRaw, "base64url");
  const tag = Buffer.from(tagRaw, "base64url");
  const payload = Buffer.from(payloadRaw, "base64url");

  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(payload), decipher.final()]);
  return decrypted.toString("utf8");
}

function normalizeSelections(selections: AppleSyncSelection[]): AppleCalendarSyncSelection[] {
  return selections
    .map((selection) => ({
      taskId: (selection.taskId || "").trim(),
      includeMinor: !!selection.includeMinor,
      includeMajor: !!selection.includeMajor,
    }))
    .filter((selection) => !!selection.taskId && (selection.includeMinor || selection.includeMajor));
}

function computeScopeRemovals(
  previousSelections: AppleSyncSelection[],
  nextSelections: AppleSyncSelection[],
): ScopeRemoval[] {
  const previousByTaskId = new Map(previousSelections.map((selection) => [selection.taskId, selection]));
  const nextByTaskId = new Map(nextSelections.map((selection) => [selection.taskId, selection]));
  const removals: ScopeRemoval[] = [];

  for (const [taskId, previousSelection] of Array.from(previousByTaskId.entries())) {
    const nextSelection = nextByTaskId.get(taskId);
    if (previousSelection.includeMinor && !nextSelection?.includeMinor) {
      removals.push({ taskId, kind: "minor" });
    }
    if (previousSelection.includeMajor && !nextSelection?.includeMajor) {
      removals.push({ taskId, kind: "major" });
    }
  }

  return removals;
}

function escapeICSText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function formatDateStamp(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  const seconds = String(date.getUTCSeconds()).padStart(2, "0");
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

function addOneDayDateOnly(dateOnly: string): string {
  const date = new Date(`${dateOnly}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toICSDateOnly(dateOnly: string): string {
  return dateOnly.replace(/-/g, "");
}

function buildEventSummary(task: MaintenanceTask, kind: SyncKind): string {
  return `${kind === "minor" ? "Minor" : "Major"} Maintenance: ${task.title}`;
}

function buildEventDescription(task: MaintenanceTask): string {
  if (task.description && task.description.trim()) {
    return task.description.trim();
  }
  return `Scheduled by SimpleHome for ${task.title}`;
}

function buildEventFilename(taskId: string, kind: SyncKind): string {
  return `simplehome-${taskId}-${kind}.ics`;
}

function buildEventUid(taskId: string, kind: SyncKind): string {
  return `simplehome-${taskId}-${kind}@simplehome.app`;
}

function buildCalendarObjectUrl(calendar: DAVCalendar, filename: string): string {
  const base = calendar.url.endsWith("/") ? calendar.url : `${calendar.url}/`;
  return `${base}${filename}`;
}

function buildICalString(task: MaintenanceTask, kind: SyncKind, dateOnly: string): string {
  const uid = buildEventUid(task.id, kind);
  const summary = escapeICSText(buildEventSummary(task, kind));
  const description = escapeICSText(buildEventDescription(task));
  const dtStart = toICSDateOnly(dateOnly);
  const dtEnd = toICSDateOnly(addOneDayDateOnly(dateOnly));
  const dtStamp = formatDateStamp(new Date());

  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SimpleHome//Apple Sync//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtStamp}`,
    `LAST-MODIFIED:${dtStamp}`,
    `DTSTART;VALUE=DATE:${dtStart}`,
    `DTEND;VALUE=DATE:${dtEnd}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
}

function getAppleCalDAVServerUrl(): string {
  return process.env.APPLE_CALDAV_SERVER_URL?.trim() || DEFAULT_APPLE_CALDAV_SERVER_URL;
}

async function createAppleDavClient(email: string, password: string): Promise<DAVClient> {
  const client = new DAVClient({
    serverUrl: getAppleCalDAVServerUrl(),
    credentials: {
      username: email,
      password,
    },
    authMethod: "Basic",
    defaultAccountType: "caldav",
  });

  await client.login({
    loadCollections: true,
    loadObjects: false,
  });

  return client;
}

function selectCalendar(
  calendars: DAVCalendar[],
  configuredCalendarId: string | null,
): { calendar: DAVCalendar; fallbackUsed: boolean } {
  if (calendars.length === 0) {
    throw new Error("No Apple calendars were found for this account.");
  }

  if (!configuredCalendarId) {
    return {
      calendar: calendars[0],
      fallbackUsed: true,
    };
  }

  const normalizedId = configuredCalendarId.toLowerCase();
  const matched = calendars.find((calendar) => {
    const displayName = String(calendar.displayName || "").toLowerCase();
    const url = String(calendar.url || "").toLowerCase();
    return displayName === normalizedId || displayName.includes(normalizedId) || url.includes(normalizedId);
  });

  if (matched) {
    return {
      calendar: matched,
      fallbackUsed: false,
    };
  }

  logAppleSyncInfo(
    `Configured calendar identifier \"${configuredCalendarId}\" was not found. Falling back to first available calendar.`,
  );
  return {
    calendar: calendars[0],
    fallbackUsed: true,
  };
}

async function upsertAppleCalendarObject(
  client: DAVClient,
  calendar: DAVCalendar,
  task: MaintenanceTask,
  kind: SyncKind,
  dateOnly: string,
  previousFilename?: string,
): Promise<{ filename: string; url: string; created: boolean; updated: boolean }> {
  const canonicalFilename = buildEventFilename(task.id, kind);
  let filename = previousFilename || canonicalFilename;
  let url = buildCalendarObjectUrl(calendar, filename);
  let objectUrls = [url];
  let existingObjects = await fetchCalendarObjectsSafe(client, calendar, objectUrls);

  // Recovery path: stale mapping may point to a deleted object while canonical object still exists.
  if ((!existingObjects || existingObjects.length === 0) && previousFilename && previousFilename !== canonicalFilename) {
    const canonicalUrl = buildCalendarObjectUrl(calendar, canonicalFilename);
    const recovered = await fetchCalendarObjectsSafe(client, calendar, [canonicalUrl]);
    if (recovered && recovered.length > 0) {
      filename = canonicalFilename;
      url = canonicalUrl;
      existingObjects = recovered;
    }
  }

  const iCalString = buildICalString(task, kind, dateOnly);
  if (!existingObjects || existingObjects.length === 0) {
    const response = await withAppleDavRetry(() =>
      client.createCalendarObject({
        calendar,
        filename: canonicalFilename,
        iCalString,
      }),
    );
    if (!response.ok) {
      throw new Error(
        `DAV_CREATE_FAILED task=${task.id} kind=${kind} calendarUrl=${String(calendar.url || "n/a")} ${extractDavResponseSummary(response)}`,
      );
    }
    return {
      filename: canonicalFilename,
      url: buildCalendarObjectUrl(calendar, canonicalFilename),
      created: true,
      updated: false,
    };
  }

  const existing = existingObjects[0];
  const existingData = String(existing.data || "");
  if (existingData === iCalString) {
    return { filename, url, created: false, updated: false };
  }

  existing.data = iCalString;
  const response = await withAppleDavRetry(() =>
    client.updateCalendarObject({
      calendarObject: existing,
    }),
  );
  if (!response.ok) {
    throw new Error(
      `DAV_UPDATE_FAILED task=${task.id} kind=${kind} calendarUrl=${String(calendar.url || "n/a")} ${extractDavResponseSummary(response)}`,
    );
  }

  return { filename, url, created: false, updated: true };
}

async function deleteAppleCalendarObjectIfExists(
  client: DAVClient,
  calendar: DAVCalendar,
  filename: string,
): Promise<boolean> {
  const objectUrls = [buildCalendarObjectUrl(calendar, filename)];
  const existingObjects = await fetchCalendarObjectsSafe(client, calendar, objectUrls);
  if (!existingObjects || existingObjects.length === 0) {
    return false;
  }

  const response = await withAppleDavRetry(() =>
    client.deleteCalendarObject({
      calendarObject: existingObjects[0] as DAVCalendarObject,
    }),
  );

  return response.ok;
}

function getTaskSchedule(task: MaintenanceTask): { minor?: string | null; major?: string | null } {
  if (!task.nextMaintenanceDate) {
    return {};
  }

  try {
    const parsed = JSON.parse(task.nextMaintenanceDate) as { minor?: string | null; major?: string | null };
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return {
      minor: normalizeDateOnly(parsed.minor ?? null),
      major: normalizeDateOnly(parsed.major ?? null),
    };
  } catch {
    return {};
  }
}

function getTaskLastMaintenance(task: MaintenanceTask): { minor?: string | null; major?: string | null } {
  if (!task.lastMaintenanceDate) {
    return {};
  }

  try {
    const parsed = JSON.parse(task.lastMaintenanceDate) as { minor?: string | null; major?: string | null };
    if (!parsed || typeof parsed !== "object") {
      return {};
    }

    return {
      minor: normalizeDateOnly(parsed.minor ?? null),
      major: normalizeDateOnly(parsed.major ?? null),
    };
  } catch {
    return {};
  }
}

function setTaskSchedule(
  task: MaintenanceTask,
  next: { minor?: string | null; major?: string | null },
): string {
  const current = getTaskSchedule(task);
  return JSON.stringify({
    minor: next.minor === undefined ? current.minor ?? null : next.minor,
    major: next.major === undefined ? current.major ?? null : next.major,
  });
}

function setTaskLastMaintenance(
  task: MaintenanceTask,
  next: { minor?: string | null; major?: string | null },
): string {
  const current = getTaskLastMaintenance(task);
  return JSON.stringify({
    minor: next.minor === undefined ? current.minor ?? null : next.minor,
    major: next.major === undefined ? current.major ?? null : next.major,
  });
}

function getTaskOverdueBacklog(task: MaintenanceTask): { minor: boolean; major: boolean } {
  if (!task.overdueBacklog) {
    return { minor: false, major: false };
  }

  try {
    const parsed = JSON.parse(task.overdueBacklog) as { minor?: boolean; major?: boolean };
    if (!parsed || typeof parsed !== "object") {
      return { minor: false, major: false };
    }

    return {
      minor: !!parsed.minor,
      major: !!parsed.major,
    };
  } catch {
    return { minor: false, major: false };
  }
}

function getTaskOverdueSince(task: MaintenanceTask): { minor: string | null; major: string | null } {
  if (!task.overdueSince) {
    return { minor: null, major: null };
  }

  try {
    const parsed = JSON.parse(task.overdueSince) as { minor?: string | null; major?: string | null };
    if (!parsed || typeof parsed !== "object") {
      return { minor: null, major: null };
    }

    return {
      minor: normalizeDateOnly(parsed.minor ?? null),
      major: normalizeDateOnly(parsed.major ?? null),
    };
  } catch {
    return { minor: null, major: null };
  }
}

function setTaskOverdueBacklog(
  task: MaintenanceTask,
  next: { minor?: boolean; major?: boolean },
): string {
  const current = getTaskOverdueBacklog(task);
  return JSON.stringify({
    minor: next.minor === undefined ? current.minor : !!next.minor,
    major: next.major === undefined ? current.major : !!next.major,
  });
}

function setTaskOverdueSince(
  task: MaintenanceTask,
  next: { minor?: string | null; major?: string | null },
): string {
  const current = getTaskOverdueSince(task);
  return JSON.stringify({
    minor: next.minor === undefined ? current.minor : normalizeDateOnly(next.minor),
    major: next.major === undefined ? current.major : normalizeDateOnly(next.major),
  });
}

function parseICalDateOnly(iCalString: string): string | null {
  const normalized = iCalString.replace(/\r\n[ \t]/g, "");
  const match = normalized.match(/(?:^|\n)DTSTART(?:;[^:\n]*)?:(\d{8})/i);
  if (!match?.[1]) {
    return null;
  }

  const raw = match[1];
  const year = raw.slice(0, 4);
  const month = raw.slice(4, 6);
  const day = raw.slice(6, 8);
  return normalizeDateOnly(`${year}-${month}-${day}`);
}

function parseICalDateTime(value: string | null | undefined): string | null {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }

  const utcMatch = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
  if (utcMatch) {
    return `${utcMatch[1]}-${utcMatch[2]}-${utcMatch[3]}T${utcMatch[4]}:${utcMatch[5]}:${utcMatch[6]}.000Z`;
  }

  const localMatch = raw.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
  if (localMatch) {
    return `${localMatch[1]}-${localMatch[2]}-${localMatch[3]}T${localMatch[4]}:${localMatch[5]}:${localMatch[6]}.000Z`;
  }

  return null;
}

function parseICalLastModified(iCalString: string): string | null {
  const normalized = iCalString.replace(/\r\n[ \t]/g, "");
  const lastModifiedMatch = normalized.match(/(?:^|\n)LAST-MODIFIED(?:;[^:\n]*)?:(\d{8}T\d{6}Z?)/i);
  if (lastModifiedMatch?.[1]) {
    return parseICalDateTime(lastModifiedMatch[1]);
  }

  const dtStampMatch = normalized.match(/(?:^|\n)DTSTAMP(?:;[^:\n]*)?:(\d{8}T\d{6}Z?)/i);
  if (dtStampMatch?.[1]) {
    return parseICalDateTime(dtStampMatch[1]);
  }

  return null;
}

export function hasDoneMarkerInAppleEventData(iCalString: string): boolean {
  const normalized = iCalString.replace(/\r\n[ \t]/g, "");
  const summaryMatch = normalized.match(/(?:^|\n)SUMMARY(?:;[^:\n]*)?:(.*)$/im);
  const descriptionMatch = normalized.match(/(?:^|\n)DESCRIPTION(?:;[^:\n]*)?:(.*)$/im);
  const haystack = `${summaryMatch?.[1] ?? ""}\n${descriptionMatch?.[1] ?? ""}`;
  return /\[done\]/i.test(haystack);
}

function getTimestamp(value: Date | string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const date = value instanceof Date ? value : new Date(value);
  const millis = date.getTime();
  return Number.isFinite(millis) ? millis : 0;
}

export function categorizeAppleSyncError(error: unknown): SyncErrorCategory {
  const diagnostics = getAppleSyncErrorDiagnostics(error);
  const message = diagnostics.signalText.toLowerCase();
  const code = (diagnostics.code || "").toLowerCase();

  if (diagnostics.status === 401 || diagnostics.status === 403) {
    return "auth";
  }
  if (
    message.includes("auth") ||
    message.includes("credential") ||
    message.includes("password") ||
    message.includes("unauthorized") ||
    code.includes("unauthorized") ||
    code.includes("forbidden")
  ) {
    return "auth";
  }
  if (
    diagnostics.status === 408 ||
    diagnostics.status === 429 ||
    diagnostics.status === 502 ||
    diagnostics.status === 503 ||
    diagnostics.status === 504 ||
    message.includes("timeout") ||
    message.includes("network") ||
    message.includes("econn") ||
    message.includes("socket") ||
    code.includes("econn") ||
    code.includes("etimedout")
  ) {
    return "network";
  }
  if (
    diagnostics.status === 404 ||
    (diagnostics.status !== null && diagnostics.status >= 400) ||
    message.includes("dav") ||
    message.includes("calendar") ||
    message.includes("not found") ||
    message.includes("collection query failed") ||
    message.includes("propfind") ||
    message.includes("report") ||
    message.includes("calendar-object")
  ) {
    return "provider";
  }
  return "unknown";
}

export function shouldRetryAppleSyncError(error: unknown): boolean {
  const category = categorizeAppleSyncError(error);
  return category === "network" || category === "provider";
}

export async function withAppleDavRetry<T>(operation: () => Promise<T>, maxAttempts = 2): Promise<T> {
  let attempt = 0;
  let lastError: unknown;

  while (attempt < maxAttempts) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      attempt += 1;
      if (attempt >= maxAttempts || !shouldRetryAppleSyncError(error)) {
        throw error;
      }
    }
  }

  throw lastError;
}

function getAppleSyncErrorDiagnostics(error: unknown): AppleSyncErrorDiagnostics {
  const anyError = error as Record<string, unknown> | null;
  const response = (anyError?.response as Record<string, unknown> | undefined) ?? undefined;

  const rawStatus =
    (typeof anyError?.status === "number" ? anyError.status : null) ??
    (typeof response?.status === "number" ? response.status : null);

  const rawCode =
    (typeof anyError?.code === "string" ? anyError.code : null) ??
    (typeof response?.code === "string" ? response.code : null);

  const rawName =
    (typeof anyError?.name === "string" ? anyError.name : null) ??
    (typeof response?.name === "string" ? response.name : null);

  const rawMessage =
    (typeof anyError?.message === "string" ? anyError.message : null) ??
    (typeof response?.statusText === "string" ? response.statusText : null) ??
    (typeof response?.message === "string" ? response.message : null) ??
    (error instanceof Error ? error.message : String(error || ""));

  const signalText = [
    rawMessage,
    rawCode || "",
    rawName || "",
    typeof response?.statusText === "string" ? response.statusText : "",
  ]
    .filter((part) => typeof part === "string" && part.trim().length > 0)
    .join(" ");

  const safeMessage = sanitizeAppleSyncDebugMessage(rawMessage, "Apple DAV operation failed");

  return {
    category: "unknown",
    status: rawStatus,
    code: rawCode,
    name: rawName,
    signalText,
    message: safeMessage,
  };
}

function isAppleDavNotFoundError(error: unknown): boolean {
  const diagnostics = getAppleSyncErrorDiagnostics(error);
  const signal = diagnostics.signalText.toLowerCase();
  return (
    diagnostics.status === 404 ||
    signal.includes("404 not found") ||
    signal.includes("collection query failed")
  );
}

async function fetchCalendarObjectsSafe(
  client: DAVClient,
  calendar: DAVCalendar,
  objectUrls: string[],
): Promise<DAVCalendarObject[]> {
  try {
    const objects = await withAppleDavRetry(() => client.fetchCalendarObjects({ calendar, objectUrls }));
    return (objects as DAVCalendarObject[]) || [];
  } catch (error) {
    // Apple often returns 404 for object lookup when the target filename does not exist yet.
    if (isAppleDavNotFoundError(error)) {
      return [];
    }
    throw error;
  }
}

export function resolveAppleConflict(args: ResolveAppleConflictArgs): AppleConflictWinner {
  if (!args.remoteChanged) {
    return "local";
  }

  if (!args.localChanged) {
    return "remote";
  }

  const localTs = getTimestamp(args.localUpdatedAt);
  const remoteTs = getTimestamp(args.remoteLastModifiedAt);
  if (remoteTs > 0 && localTs > 0) {
    if (remoteTs > localTs) {
      return "remote";
    }
    if (remoteTs < localTs) {
      return "local";
    }
  }

  const syncedTs = getTimestamp(args.lastSyncedAt);
  if (remoteTs > syncedTs && localTs <= syncedTs) {
    return "remote";
  }

  // Deterministic tie-breaker: prefer local when both changed and remote freshness
  // cannot be proven newer.
  return "local";
}

function getAppleSyncExport(task: MaintenanceTask): CalendarExportRecord | undefined {
  return normalizeCalendarExports(task.calendarExports).find(
    (record) => record.provider === APPLE_SYNC_PROVIDER && record.syncMode === APPLE_SYNC_MODE,
  );
}

function upsertAppleSyncExport(task: MaintenanceTask, updates: Partial<CalendarExportRecord>): string | null {
  const records = normalizeCalendarExports(task.calendarExports).filter(
    (record) => !(record.provider === APPLE_SYNC_PROVIDER && record.syncMode === APPLE_SYNC_MODE),
  );

  const existing = getAppleSyncExport(task);
  const nextRecord: CalendarExportRecord = {
    provider: APPLE_SYNC_PROVIDER,
    syncMode: APPLE_SYNC_MODE,
    eventIds: { ...(existing?.eventIds ?? {}), ...(updates.eventIds ?? {}) },
    eventLinks: { ...(existing?.eventLinks ?? {}), ...(updates.eventLinks ?? {}) },
    selected: { ...(existing?.selected ?? {}), ...(updates.selected ?? {}) },
    syncedDates: { ...(existing?.syncedDates ?? {}), ...(updates.syncedDates ?? {}) },
    calendarId: updates.calendarId ?? existing?.calendarId ?? null,
    lastSyncedAt: updates.lastSyncedAt ?? existing?.lastSyncedAt ?? new Date().toISOString(),
  };

  records.push(nextRecord);
  return serializeCalendarExports(records);
}

async function resolveActiveSyncScope(
  userId: string,
  requestSelections: AppleSyncSelection[],
): Promise<SyncScopeOutcome> {
  const requested = normalizeSelections(requestSelections);
  const existingScope = normalizeSelections(await storage.getAppleCalendarSyncScope(userId));

  if (existingScope.length > 0) {
    return {
      activeSelections: existingScope,
      initializedFromRequest: false,
    };
  }

  if (requested.length === 0) {
    throw new Error("Select at least one task to sync.");
  }

  const connection = await storage.setAppleCalendarSyncScope(userId, requested);
  logAppleSyncDebug(`Initialized active sync scope with ${connection.activeSyncSelections.length} task(s) for user ${userId}`);

  return {
    activeSelections: normalizeSelections(connection.activeSyncSelections),
    initializedFromRequest: true,
  };
}

export async function getAppleCalendarSyncStatus(req: express.Request): Promise<AppleCalendarSyncStatus> {
  const userId = getUserId(req);

  if (!isAppleCalendarConfigured()) {
    return {
      configured: false,
      connected: false,
      accountEmail: null,
      calendarId: null,
      lastSyncedAt: null,
    };
  }

  const connection = await storage.getAppleCalendarConnection(userId);
  return {
    configured: true,
    connected: !!connection,
    accountEmail: connection?.email ?? null,
    calendarId: connection?.calendarId ?? null,
    resolvedCalendarDisplayName: connection?.resolvedCalendarDisplayName ?? null,
    resolvedCalendarUrl: connection?.resolvedCalendarUrl ?? null,
    lastSyncedAt: connection?.lastSyncedAt ? connection.lastSyncedAt.toISOString() : null,
    activeScopeCount: connection?.activeSyncSelections?.length ?? 0,
    syncScopeVersion: connection?.syncScopeVersion ?? undefined,
    syncScopeUpdatedAt: connection?.syncScopeUpdatedAt ? connection.syncScopeUpdatedAt.toISOString() : null,
  };
}

export async function connectAppleCalendar(
  req: express.Request,
  input: ConnectAppleCalendarInput,
): Promise<AppleCalendarSyncStatus> {
  const userId = getUserId(req);

  if (!isAppleCalendarConfigured()) {
    throw new Error("Apple Calendar sync is not configured. Set APPLE_SYNC_ENCRYPTION_KEY.");
  }

  const email = input.appleIdEmail.trim().toLowerCase();
  const password = input.appSpecificPassword.trim();
  const calendarId = input.calendarId?.trim() || "simplehome-maintenance";

  if (!email || !email.includes("@")) {
    throw new Error("Provide a valid Apple ID email.");
  }

  if (!password) {
    throw new Error("Provide an app-specific password.");
  }

  // Validate credentials and basic CalDAV access at connect-time.
  let selectedCalendarDisplayName: string | null = null;
  let selectedCalendarUrl: string | null = null;
  try {
    const client = await createAppleDavClient(email, password);
    const calendars = await client.fetchCalendars();
    if (!calendars || calendars.length === 0) {
      throw new Error("No Apple calendars were found for this account.");
    }
    const selected = selectCalendar(calendars, calendarId);
    selectedCalendarDisplayName = String(selected.calendar.displayName || "").trim() || null;
    selectedCalendarUrl = String(selected.calendar.url || "").trim() || null;
    logAppleSyncInfo(
      `Connected Apple sync using calendar \"${selectedCalendarDisplayName || "(unnamed)"}\" (${selectedCalendarUrl || "no-url"}).`,
    );
  } catch (error) {
    throw new Error("Unable to authenticate Apple CalDAV credentials. Check Apple ID and app-specific password.");
  }

  const encryptedPassword = encryptSecret(password);

  await storage.upsertAppleCalendarConnection(userId, {
    email,
    calendarId,
    resolvedCalendarDisplayName: selectedCalendarDisplayName,
    resolvedCalendarUrl: selectedCalendarUrl,
    appSpecificPasswordEncrypted: encryptedPassword,
    connectedAt: new Date(),
  });

  return getAppleCalendarSyncStatus(req);
}

export async function getAppleCalendarSyncScope(req: express.Request): Promise<{ selections: AppleSyncSelection[]; count: number }> {
  const userId = getUserId(req);
  const selections = normalizeSelections(await storage.getAppleCalendarSyncScope(userId));
  return {
    selections,
    count: selections.length,
  };
}

export async function setAppleCalendarSyncScope(
  req: express.Request,
  selections: AppleSyncSelection[],
): Promise<{
  selections: AppleSyncSelection[];
  count: number;
  syncScopeVersion: number;
  syncScopeUpdatedAt: string | null;
  removedEvents: number;
}> {
  const userId = getUserId(req);

  const normalized = normalizeSelections(selections);
  if (normalized.length === 0) {
    throw new Error("Select at least one task to include in sync scope.");
  }

  const previous = normalizeSelections(await storage.getAppleCalendarSyncScope(userId));
  const removals = computeScopeRemovals(previous, normalized);

  const connection = await storage.setAppleCalendarSyncScope(userId, normalized);

  let removedEvents = 0;
  if (connection.calendarId && removals.length > 0 && connection.email && connection.appSpecificPasswordEncrypted) {
    try {
      const decryptedPassword = decryptSecret(connection.appSpecificPasswordEncrypted);
      const client = await createAppleDavClient(connection.email, decryptedPassword);
      const calendars = await client.fetchCalendars();
      const selected = selectCalendar(calendars, connection.calendarId);
      const calendar = selected.calendar;

      for (const removal of removals) {
        const filename = buildEventFilename(removal.taskId, removal.kind);
        const removed = await deleteAppleCalendarObjectIfExists(client, calendar, filename);
        if (removed) {
          removedEvents += 1;
        }
      }
    } catch (error) {
      logAppleSyncDebug("Failed to remove one or more out-of-scope Apple events.");
    }
  }

  return {
    selections: normalizeSelections(connection.activeSyncSelections),
    count: connection.activeSyncSelections.length,
    syncScopeVersion: connection.syncScopeVersion,
    syncScopeUpdatedAt: connection.syncScopeUpdatedAt ? connection.syncScopeUpdatedAt.toISOString() : null,
    removedEvents,
  };
}

export async function disconnectAppleCalendar(
  req: express.Request,
  options: DisconnectAppleCalendarOptions = {},
): Promise<DisconnectAppleCalendarOutcome> {
  const userId = getUserId(req);

  await storage.deleteAppleCalendarConnection(userId);

  return {
    disconnected: true,
    calendarDeleteRequested: !!options.deleteCalendar,
    calendarDeleted: false,
    calendarDeleteMessage: options.deleteCalendar
      ? "Calendar deletion from Apple is not automated yet. Remove it from Apple Calendar manually if needed."
      : null,
    eventsDeleted: 0,
    eventsFailed: 0,
  };
}

export async function runAppleCalendarTwoWaySync(
  req: express.Request,
  selections: AppleSyncSelection[],
): Promise<AppleSyncOutcome> {
  const userId = getUserId(req);

  if (!isAppleCalendarConfigured()) {
    throw new Error("Apple Calendar sync is not configured. Set APPLE_SYNC_ENCRYPTION_KEY.");
  }

  const connection = await storage.getAppleCalendarConnection(userId);
  if (!connection) {
    throw new Error("Apple Calendar is not connected.");
  }

  if (!connection.appSpecificPasswordEncrypted) {
    throw new Error("Apple Calendar credentials are missing. Reconnect Apple Calendar.");
  }

  // Validate that credential payload can be decrypted with the active key.
  const decryptedPassword = decryptSecret(connection.appSpecificPasswordEncrypted);

  const client = await createAppleDavClient(connection.email || "", decryptedPassword);
  const calendars = await client.fetchCalendars();
  const selected = selectCalendar(calendars, connection.calendarId);
  const calendar = selected.calendar;
  const resolvedCalendarDisplayName = String(calendar.displayName || "").trim() || null;
  const resolvedCalendarUrl = String(calendar.url || "").trim() || null;
  logAppleSyncInfo(
    `Starting Apple two-way sync against calendar \"${resolvedCalendarDisplayName || "(unnamed)"}\" (${resolvedCalendarUrl || "no-url"}) for ${connection.email || "unknown-account"}.`,
  );

  const { activeSelections } = await resolveActiveSyncScope(userId, selections);

  let syncedTasks = 0;
  let pushedEvents = 0;
  let pulledChanges = 0;
  let createdEvents = 0;
  let updatedEvents = 0;
  let completedFromApple = 0;
  let rescheduledFromApple = 0;
  let failedOperations = 0;

  for (const selection of activeSelections) {
    const task = await storage.getMaintenanceTask(selection.taskId, userId);
    if (!task) {
      continue;
    }

    let nextTask = task;
    const schedule = getTaskSchedule(nextTask);
    const exportRecord = getAppleSyncExport(nextTask);

    for (const kind of ["minor", "major"] as SyncKind[]) {
      try {
        const included = kind === "minor" ? selection.includeMinor : selection.includeMajor;
        if (!included) {
          continue;
        }

        const currentDateOnly = schedule[kind] ?? null;
        if (!currentDateOnly) {
          continue;
        }

        const existingEventId = exportRecord?.eventIds?.[kind];
        const existingSyncedDate = normalizeDateOnly(exportRecord?.syncedDates?.[kind] ?? null);
        const previousFilename = existingEventId || undefined;

        const remoteObjectUrl = existingEventId ? buildCalendarObjectUrl(calendar, existingEventId) : null;
        const remoteObject = remoteObjectUrl
          ? (await fetchCalendarObjectsSafe(client, calendar, [remoteObjectUrl]))?.[0]
          : null;
        const remoteData = String(remoteObject?.data || "");
        const remoteDateOnly = normalizeDateOnly(parseICalDateOnly(String(remoteObject?.data || "")));
        const remoteLastModifiedAt = parseICalLastModified(String(remoteObject?.data || ""));

        const localChanged = !!existingSyncedDate && currentDateOnly !== existingSyncedDate;
        const remoteChanged = !!existingSyncedDate && !!remoteDateOnly && remoteDateOnly !== existingSyncedDate;
        const conflictWinner = resolveAppleConflict({
          localChanged,
          remoteChanged,
          localUpdatedAt: nextTask.updatedAt,
          remoteLastModifiedAt,
          lastSyncedAt: exportRecord?.lastSyncedAt,
        });

        let resolvedDateOnly = currentDateOnly;

        const hasDoneMarker = hasDoneMarkerInAppleEventData(remoteData);
        if (hasDoneMarker) {
          const completion = deriveDoneCompletionDates(
            nextTask,
            kind,
            remoteDateOnly ?? currentDateOnly,
          );

          if (completion) {
            const currentLast = getTaskLastMaintenance(nextTask);
            const existingCompletedDateOnly = normalizeDateOnly(currentLast[kind] ?? null);
            const existingNextDateOnly = normalizeDateOnly(currentDateOnly);

            if (
              existingCompletedDateOnly !== completion.completedDateOnly ||
              existingNextDateOnly !== completion.nextDateOnly
            ) {
              nextTask = {
                ...nextTask,
                lastMaintenanceDate: setTaskLastMaintenance(nextTask, { [kind]: completion.completedDateOnly }),
                nextMaintenanceDate: setTaskSchedule(nextTask, { [kind]: completion.nextDateOnly }),
                overdueBacklog: setTaskOverdueBacklog(nextTask, { [kind]: false }),
                overdueSince: setTaskOverdueSince(nextTask, { [kind]: null }),
              };
              pulledChanges += 1;
            }

            completedFromApple += 1;
            resolvedDateOnly = completion.nextDateOnly;

            if (existingEventId) {
              try {
                await deleteAppleCalendarObjectIfExists(client, calendar, existingEventId);
              } catch {
                // Best effort delete to avoid duplicate DONE events.
              }
            }
          }
        }

        if (!hasDoneMarker && remoteChanged && conflictWinner === "remote" && remoteDateOnly) {
          const currentOverdueBacklog = getTaskOverdueBacklog(nextTask);
          const currentOverdueSince = getTaskOverdueSince(nextTask);
          const transition = deriveRescheduleBacklogState({
            currentDateOnly,
            googleDateOnly: remoteDateOnly,
            existingBacklog: currentOverdueBacklog[kind],
            existingOverdueSince: currentOverdueSince[kind],
          });

          nextTask = {
            ...nextTask,
            nextMaintenanceDate: setTaskSchedule(nextTask, { [kind]: remoteDateOnly }),
            overdueBacklog: setTaskOverdueBacklog(nextTask, { [kind]: transition.backlog }),
            overdueSince: setTaskOverdueSince(nextTask, { [kind]: transition.overdueSince }),
          };

          resolvedDateOnly = remoteDateOnly;
          pulledChanges += 1;
          if (transition.rescheduled) {
            rescheduledFromApple += 1;
          }
        }

        const upserted = await upsertAppleCalendarObject(
          client,
          calendar,
          nextTask,
          kind,
          resolvedDateOnly,
          previousFilename,
        );

        const nextEventId = upserted.filename;

        if (upserted.created) {
          createdEvents += 1;
          pushedEvents += 1;
        } else if (upserted.updated || existingSyncedDate !== resolvedDateOnly) {
          updatedEvents += 1;
          pushedEvents += 1;
        }

        nextTask = {
          ...nextTask,
          calendarExports: upsertAppleSyncExport(nextTask, {
            eventIds: { [kind]: nextEventId },
            eventLinks: { [kind]: upserted.url },
            selected: { [kind]: true },
            syncedDates: { [kind]: resolvedDateOnly },
            calendarId: calendar.url,
            lastSyncedAt: new Date().toISOString(),
          }),
        };
      } catch (error) {
        failedOperations += 1;
        const diagnostics = getAppleSyncErrorDiagnostics(error);
        const category = categorizeAppleSyncError(error);
        logAppleSyncDebug(
          `Failed syncing task=${selection.taskId} kind=${kind} category=${category} status=${diagnostics.status ?? "n/a"} code=${diagnostics.code ?? "n/a"} name=${diagnostics.name ?? "n/a"} message=\"${diagnostics.message}\". Continuing with remaining items.`,
        );
        const details = sanitizeAppleSyncDebugMessage(error, "no-additional-error-details");
        if (details && details !== diagnostics.message) {
          logAppleSyncDebug(`Failure details task=${selection.taskId} kind=${kind}: \"${details}\"`);
        }
      }
    }

    if (nextTask.calendarExports !== task.calendarExports) {
      await storage.updateMaintenanceTask(
        task.id,
        {
          calendarExports: nextTask.calendarExports ?? null,
        },
        userId,
      );
    }

    if (selection.includeMinor || selection.includeMajor) {
      syncedTasks++;
    }
  }

  const lastSyncedAt = new Date();
  await storage.upsertAppleCalendarConnection(userId, {
    lastSyncedAt,
    resolvedCalendarDisplayName,
    resolvedCalendarUrl,
  });

  return {
    syncedTasks,
    pushedEvents,
    pulledChanges,
    createdEvents,
    updatedEvents,
    completedFromApple,
    rescheduledFromApple,
    lastSyncedAt: lastSyncedAt.toISOString(),
    calendarId: connection.calendarId ?? "simplehome-maintenance",
    ...(failedOperations > 0 ? { failedOperations } : {}),
  };
}
