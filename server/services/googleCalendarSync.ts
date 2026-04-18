import type express from "express";
import { randomBytes } from "crypto";
import { google, type calendar_v3 } from "googleapis";
import {
  addMonthsToDateOnly,
  normalizeDateOnly,
  normalizeCalendarExports,
  serializeCalendarExports,
  type CalendarExportRecord,
  type MaintenanceTask,
} from "@shared/schema";
import { storage } from "../storage";
import { logWithLevel } from "./logWithLevel";

export type GoogleSyncSelection = {
  taskId: string;
  includeMinor: boolean;
  includeMajor: boolean;
};

type SyncKind = "minor" | "major";

type DoneCandidate = {
  kind: SyncKind;
  taskTitle: string;
  event: calendar_v3.Schema$Event;
};

type GoogleCalendarSyncStatus = {
  configured: boolean;
  connected: boolean;
  accountEmail: string | null;
  calendarId: string | null;
  lastSyncedAt: string | null;
  activeScopeCount?: number;
  syncScopeVersion?: number;
  syncScopeUpdatedAt?: string | null;
};

type SyncOutcome = {
  syncedTasks: number;
  pushedEvents: number;
  pulledChanges: number;
  createdEvents: number;
  updatedEvents: number;
  completedFromGoogle: number;
  rescheduledFromGoogle: number;
  lastSyncedAt: string;
  calendarId: string;
};

type SyncScopeOutcome = {
  activeSelections: GoogleSyncSelection[];
  initializedFromRequest: boolean;
};

type ScopeRemoval = {
  taskId: string;
  kind: SyncKind;
};

type ManagedEventReference = {
  taskId: string;
  kind: SyncKind;
  eventId: string;
};

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/userinfo.email",
];

const GOOGLE_SYNC_PROVIDER = "google";
const GOOGLE_SYNC_MODE = "direct";
const GOOGLE_CALENDAR_NAME = "SimpleHome Maintenance";
const GOOGLE_SYNC_DEBUG = process.env.GOOGLE_SYNC_DEBUG === "true";

function logGoogleSyncDebug(message: string) {
  if (GOOGLE_SYNC_DEBUG) {
    logWithLevel("INFO", message);
  }
}

function getGoogleClientId(): string | null {
  return process.env.GOOGLE_CLIENT_ID?.trim() || null;
}

function getGoogleClientSecret(): string | null {
  return process.env.GOOGLE_CLIENT_SECRET?.trim() || null;
}

function isGoogleCalendarConfigured(): boolean {
  return !!(getGoogleClientId() && getGoogleClientSecret());
}

function normalizeSelections(selections: GoogleSyncSelection[]): GoogleSyncSelection[] {
  return selections
    .map((selection) => ({
      taskId: (selection.taskId || "").trim(),
      includeMinor: !!selection.includeMinor,
      includeMajor: !!selection.includeMajor,
    }))
    .filter((selection) => !!selection.taskId && (selection.includeMinor || selection.includeMajor));
}

function inferBaseUrl(req: express.Request): string {
  const protocol = req.headers["x-forwarded-proto"]?.toString().split(",")[0] || req.protocol;
  const host = req.get("host") || "localhost:5000";
  const inferredBase = `${protocol}://${host}`;
  const configuredBase = process.env.PUBLIC_BASE_URL?.trim();
  return configuredBase && configuredBase.length > 0 ? configuredBase.replace(/\/$/, "") : inferredBase;
}

function getRedirectUri(req: express.Request): string {
  return `${inferBaseUrl(req)}/api/calendar/google/oauth/callback`;
}

function createOAuthClient(req: express.Request) {
  const clientId = getGoogleClientId();
  const clientSecret = getGoogleClientSecret();

  if (!clientId || !clientSecret) {
    throw new Error("Google Calendar sync is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
  }

  return new google.auth.OAuth2(clientId, clientSecret, getRedirectUri(req));
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

function hasDoneMarker(event: calendar_v3.Schema$Event | null | undefined): boolean {
  if (!event) return false;
  const text = `${event.summary ?? ""}\n${event.description ?? ""}`;
  return /\[done\]/i.test(text);
}

export function deriveDoneCompletionDates(
  task: MaintenanceTask,
  kind: SyncKind,
  completionDateRaw: string | null | undefined,
): { completedDateOnly: string; nextDateOnly: string } | null {
  const completedDateOnly = normalizeDateOnly(completionDateRaw);
  if (!completedDateOnly) {
    return null;
  }

  const intervalMonths = kind === "minor" ? task.minorIntervalMonths : task.majorIntervalMonths;
  const nextDateOnly =
    normalizeDateOnly(
      typeof intervalMonths === "number" && intervalMonths > 0
        ? addMonthsToDateOnly(completedDateOnly, intervalMonths)
        : completedDateOnly,
    ) ?? completedDateOnly;

  return {
    completedDateOnly,
    nextDateOnly,
  };
}

function getTodayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
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

export function deriveRescheduleBacklogState(args: {
  currentDateOnly: string | null;
  googleDateOnly: string | null;
  existingBacklog: boolean;
  existingOverdueSince: string | null;
  todayDateOnly?: string;
}): {
  rescheduled: boolean;
  backlog: boolean;
  overdueSince: string | null;
} {
  const currentDateOnly = normalizeDateOnly(args.currentDateOnly);
  const googleDateOnly = normalizeDateOnly(args.googleDateOnly);
  const existingOverdueSince = normalizeDateOnly(args.existingOverdueSince);
  const todayDateOnly = normalizeDateOnly(args.todayDateOnly) ?? getTodayDateOnly();

  if (!googleDateOnly || googleDateOnly === currentDateOnly) {
    return {
      rescheduled: false,
      backlog: !!args.existingBacklog,
      overdueSince: existingOverdueSince,
    };
  }

  const wasOverdueBeforeReschedule = !!currentDateOnly && currentDateOnly < todayDateOnly;
  if (wasOverdueBeforeReschedule) {
    return {
      rescheduled: true,
      backlog: true,
      overdueSince: existingOverdueSince ?? currentDateOnly,
    };
  }

  return {
    rescheduled: true,
    backlog: false,
    overdueSince: null,
  };
}

function parseTaskSteps(raw: string | null): string[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0);
  } catch {
    return [];
  }
}

export function buildCalendarTaskDescription(task: MaintenanceTask, kind: SyncKind): string {
  const lines: string[] = [];
  const maintenanceLabel = kind === "minor" ? "Minor" : "Major";
  const steps = parseTaskSteps(kind === "minor" ? task.minorTasks : task.majorTasks);

  lines.push(`Task: ${task.title}`);
  lines.push(`Type: ${maintenanceLabel} maintenance`);

  if (task.category) {
    lines.push(`Category: ${task.category}`);
  }
  if (task.priority) {
    lines.push(`Priority: ${task.priority}`);
  }
  if (task.location) {
    lines.push(`Location: ${task.location}`);
  }

  lines.push("");

  if (steps.length > 0) {
    lines.push("Checklist:");
    for (const step of steps) {
      lines.push(`- ${step}`);
    }
    return lines.join("\n");
  }

  lines.push("Notes:");
  lines.push(task.description?.trim() || `Scheduled ${kind} maintenance`);
  return lines.join("\n");
}

function getTaskDescription(task: MaintenanceTask, kind: SyncKind): string {
  return buildCalendarTaskDescription(task, kind);
}

function getEventSummary(task: MaintenanceTask, kind: SyncKind): string {
  return `${kind === "minor" ? "Minor" : "Major"} Maintenance: ${task.title}`;
}

function normalizeTaskTitleKey(value: string): string {
  return value.trim().toLowerCase();
}

function doneCandidateKey(kind: SyncKind, taskTitle: string): string {
  return `${kind}|${normalizeTaskTitleKey(taskTitle)}`;
}

function parseDoneCandidate(event: calendar_v3.Schema$Event): DoneCandidate | null {
  const summary = String(event.summary ?? "").trim();
  const match = summary.match(/^\[done\]\s*(minor|major)\s+maintenance:\s*(.+)$/i);
  if (!match) return null;

  const kind = match[1].toLowerCase() as SyncKind;
  const taskTitle = match[2].trim();
  if (!taskTitle) return null;

  return {
    kind,
    taskTitle,
    event,
  };
}


async function loadDoneCandidates(
  calendar: calendar_v3.Calendar,
  calendarId: string,
): Promise<Map<string, calendar_v3.Schema$Event>> {
  const out = new Map<string, calendar_v3.Schema$Event>();
  let pageToken: string | undefined = undefined;

  do {
    const response: { data: calendar_v3.Schema$Events } = await calendar.events.list({
      calendarId,
      q: "[DONE]",
      singleEvents: true,
      showDeleted: false,
      maxResults: 250,
      orderBy: "updated",
      pageToken,
    }) as { data: calendar_v3.Schema$Events };

    const items = response.data.items ?? [];
    for (const item of items) {
      if (item.status === "cancelled") continue;
      const candidate = parseDoneCandidate(item);
      if (!candidate) continue;

      const key = doneCandidateKey(candidate.kind, candidate.taskTitle);
      const existing = out.get(key);
      if (!existing) {
        out.set(key, item);
        continue;
      }

      const existingUpdated = existing.updated ? new Date(existing.updated).getTime() : 0;
      const currentUpdated = item.updated ? new Date(item.updated).getTime() : 0;
      if (currentUpdated >= existingUpdated) {
        out.set(key, item);
      }
    }

    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  return out;
}

function getGoogleSyncExport(task: MaintenanceTask): CalendarExportRecord | undefined {
  return normalizeCalendarExports(task.calendarExports).find(
    (record) => record.provider === GOOGLE_SYNC_PROVIDER && record.syncMode === GOOGLE_SYNC_MODE,
  );
}

function upsertGoogleSyncExport(
  task: MaintenanceTask,
  updates: Partial<CalendarExportRecord>,
): string | null {
  const records = normalizeCalendarExports(task.calendarExports).filter(
    (record) => !(record.provider === GOOGLE_SYNC_PROVIDER && record.syncMode === GOOGLE_SYNC_MODE),
  );

  const existing = getGoogleSyncExport(task);
  const nextRecord: CalendarExportRecord = {
    provider: GOOGLE_SYNC_PROVIDER,
    syncMode: GOOGLE_SYNC_MODE,
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

function buildEventPayload(task: MaintenanceTask, kind: SyncKind, dateOnly: string): calendar_v3.Schema$Event {
  const eventDate = new Date(`${dateOnly}T00:00:00.000Z`);
  const endDate = new Date(eventDate.getTime());
  endDate.setUTCDate(endDate.getUTCDate() + 1);

  return {
    summary: getEventSummary(task, kind),
    description: getTaskDescription(task, kind),
    start: { date: dateOnly },
    end: { date: endDate.toISOString().slice(0, 10) },
    transparency: "transparent",
    extendedProperties: {
      private: {
        simplehomeTaskId: task.id,
        simplehomeMaintenanceType: kind,
      },
    },
    source: {
      title: "SimpleHome",
      url: process.env.PUBLIC_BASE_URL?.trim() || undefined,
    },
  };
}

function computeScopeRemovals(
  previousSelections: GoogleSyncSelection[],
  nextSelections: GoogleSyncSelection[],
): ScopeRemoval[] {
  const previousByTaskId = new Map(previousSelections.map((selection) => [selection.taskId, selection]));
  const nextByTaskId = new Map(nextSelections.map((selection) => [selection.taskId, selection]));
  const removals: ScopeRemoval[] = [];

  for (const [taskId, previousSelection] of previousByTaskId.entries()) {
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

function detachGoogleSyncExportKind(task: MaintenanceTask, kind: SyncKind): string | null {
  const records = normalizeCalendarExports(task.calendarExports).map((record) => {
    if (!(record.provider === GOOGLE_SYNC_PROVIDER && record.syncMode === GOOGLE_SYNC_MODE)) {
      return record;
    }

    const nextEventIds = { ...(record.eventIds ?? {}) };
    delete nextEventIds[kind];

    const nextEventLinks = { ...(record.eventLinks ?? {}) };
    delete nextEventLinks[kind];

    const nextSyncedDates = { ...(record.syncedDates ?? {}) };
    delete nextSyncedDates[kind];

    const nextSelected = { ...(record.selected ?? {}) };
    nextSelected[kind] = false;

    return {
      ...record,
      eventIds: nextEventIds,
      eventLinks: Object.keys(nextEventLinks).length > 0 ? nextEventLinks : undefined,
      syncedDates: Object.keys(nextSyncedDates).length > 0 ? nextSyncedDates : undefined,
      selected: nextSelected,
      lastSyncedAt: new Date().toISOString(),
    };
  });

  return serializeCalendarExports(records);
}

function buildSelectionIndex(selections: GoogleSyncSelection[]): Map<string, { minor: boolean; major: boolean }> {
  const index = new Map<string, { minor: boolean; major: boolean }>();
  for (const selection of selections) {
    index.set(selection.taskId, {
      minor: !!selection.includeMinor,
      major: !!selection.includeMajor,
    });
  }
  return index;
}

function parseManagedEventReference(event: calendar_v3.Schema$Event): ManagedEventReference | null {
  if (!event.id || event.status === "cancelled") {
    return null;
  }

  const props = event.extendedProperties?.private ?? {};
  const taskId = props.simplehomeTaskId ?? props.homeguardTaskId;
  const rawKind = props.simplehomeMaintenanceType ?? props.homeguardMaintenanceType;

  if (!taskId || (rawKind !== "minor" && rawKind !== "major")) {
    return null;
  }

  return {
    taskId,
    kind: rawKind,
    eventId: event.id,
  };
}

async function detachTaskExportsForKinds(
  userId: string,
  refs: Array<{ taskId: string; kind: SyncKind }>,
): Promise<void> {
  if (refs.length === 0) {
    return;
  }

  const refsByTaskId = new Map<string, Set<SyncKind>>();
  for (const ref of refs) {
    const kinds = refsByTaskId.get(ref.taskId) ?? new Set<SyncKind>();
    kinds.add(ref.kind);
    refsByTaskId.set(ref.taskId, kinds);
  }

  for (const [taskId, kinds] of refsByTaskId.entries()) {
    const task = await storage.getMaintenanceTask(taskId, userId);
    if (!task) {
      continue;
    }

    let nextCalendarExports = task.calendarExports;
    for (const kind of kinds.values()) {
      const next = detachGoogleSyncExportKind({ ...task, calendarExports: nextCalendarExports }, kind);
      nextCalendarExports = next;
    }

    if (nextCalendarExports !== task.calendarExports) {
      await storage.updateMaintenanceTask(task.id, { calendarExports: nextCalendarExports }, userId);
    }
  }
}

async function reconcileOutOfScopeGoogleEvents(args: {
  req: express.Request;
  userId: string;
  calendarId: string;
  activeSelections: GoogleSyncSelection[];
}): Promise<number> {
  const { req, userId, calendarId, activeSelections } = args;
  const selectionIndex = buildSelectionIndex(activeSelections);
  const { calendar } = await getAuthorizedCalendar(req, userId);

  let removedEvents = 0;
  let pageToken: string | undefined;
  const detachedRefs: Array<{ taskId: string; kind: SyncKind }> = [];

  do {
    const response = await calendar.events.list({
      calendarId,
      singleEvents: true,
      showDeleted: false,
      maxResults: 250,
      orderBy: "updated",
      pageToken,
    });

    const items = response.data.items ?? [];
    for (const item of items) {
      const ref = parseManagedEventReference(item);
      if (!ref) {
        continue;
      }

      const scoped = selectionIndex.get(ref.taskId);
      const shouldKeep = ref.kind === "minor" ? !!scoped?.minor : !!scoped?.major;
      if (shouldKeep) {
        continue;
      }

      try {
        await calendar.events.delete({ calendarId, eventId: ref.eventId });
        removedEvents++;
        detachedRefs.push({ taskId: ref.taskId, kind: ref.kind });
      } catch (error: any) {
        if (error?.code !== 404) {
          throw error;
        }
      }
    }

    pageToken = response.data.nextPageToken ?? undefined;
  } while (pageToken);

  await detachTaskExportsForKinds(userId, detachedRefs);
  return removedEvents;
}

async function removeOutOfScopeGoogleEvents(args: {
  req: express.Request;
  userId: string;
  calendarId: string;
  removals: ScopeRemoval[];
}): Promise<number> {
  const { req, userId, calendarId, removals } = args;
  if (removals.length === 0) {
    return 0;
  }

  const { calendar } = await getAuthorizedCalendar(req, userId);
  let removedEvents = 0;
  const detachedRefs: Array<{ taskId: string; kind: SyncKind }> = [];

  for (const removal of removals) {
    const task = await storage.getMaintenanceTask(removal.taskId, userId);
    if (!task) {
      continue;
    }

    const exportRecord = getGoogleSyncExport(task);
    const eventId = exportRecord?.eventIds?.[removal.kind];

    if (eventId) {
      try {
        await calendar.events.delete({ calendarId, eventId });
        removedEvents++;
        detachedRefs.push({ taskId: task.id, kind: removal.kind });
      } catch (error: any) {
        if (error?.code !== 404) {
          throw error;
        }
      }
    } else {
      const fallbackEvent = await findEventByTaskAndKind(calendar, calendarId, task.id, removal.kind);
      if (fallbackEvent?.id) {
        try {
          await calendar.events.delete({ calendarId, eventId: fallbackEvent.id });
          removedEvents++;
          detachedRefs.push({ taskId: task.id, kind: removal.kind });
        } catch (error: any) {
          if (error?.code !== 404) {
            throw error;
          }
        }
      }
    }
  }

  await detachTaskExportsForKinds(userId, detachedRefs);

  return removedEvents;
}

async function getAuthorizedCalendar(req: express.Request, userId: string) {
  const connection = await storage.getGoogleCalendarConnection(userId);
  if (!connection || (!connection.refreshToken && !connection.accessToken)) {
    throw new Error("Google Calendar is not connected for this account.");
  }

  const oauth2Client = createOAuthClient(req);
  oauth2Client.setCredentials({
    access_token: connection.accessToken ?? undefined,
    refresh_token: connection.refreshToken ?? undefined,
    expiry_date: connection.expiryDate ?? undefined,
    scope: connection.scope ?? undefined,
    token_type: connection.tokenType ?? undefined,
  });

  oauth2Client.on("tokens", (tokens) => {
    void storage.upsertGoogleCalendarConnection(userId, {
      accessToken: tokens.access_token ?? connection.accessToken,
      refreshToken: tokens.refresh_token ?? connection.refreshToken,
      expiryDate: tokens.expiry_date ?? connection.expiryDate,
      scope: tokens.scope ?? connection.scope,
      tokenType: tokens.token_type ?? connection.tokenType,
    }).catch((error) => {
      console.error("Failed to persist refreshed Google OAuth tokens:", error);
    });
  });

  return {
    calendar: google.calendar({ version: "v3", auth: oauth2Client }),
    connection,
    oauth2Client,
  };
}

async function ensureCalendar(
  req: express.Request,
  userId: string,
  timezone = "UTC",
): Promise<{ calendar: calendar_v3.Calendar; calendarId: string }> {
  const { calendar, connection } = await getAuthorizedCalendar(req, userId);

  if (connection.calendarId) {
    try {
      await calendar.calendars.get({ calendarId: connection.calendarId });
      return { calendar, calendarId: connection.calendarId };
    } catch {
      // Recreate the calendar below if it no longer exists.
    }
  }

  const created = await calendar.calendars.insert({
    requestBody: {
      summary: GOOGLE_CALENDAR_NAME,
      description: "Two-way synced maintenance schedule from SimpleHome.",
      timeZone: timezone,
    },
  });

  const calendarId = created.data.id;
  if (!calendarId) {
    throw new Error("Google Calendar did not return a calendar ID.");
  }

  await storage.upsertGoogleCalendarConnection(userId, {
    calendarId,
  });

  return { calendar, calendarId };
}

async function getEventIfExists(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  eventId: string,
): Promise<calendar_v3.Schema$Event | null> {
  try {
    const response = await calendar.events.get({ calendarId, eventId });
    return response.data;
  } catch (error: any) {
    if (error?.code === 404) {
      return null;
    }
    throw error;
  }
}

async function findEventByTaskAndKind(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  taskId: string,
  kind: SyncKind,
): Promise<calendar_v3.Schema$Event | null> {
  const findWithTaskIdProperty = async (
    taskIdProperty: string,
    maintenanceTypeProperty: string,
  ): Promise<calendar_v3.Schema$Event | null> => {
    const response = await calendar.events.list({
      calendarId,
      privateExtendedProperty: [taskIdProperty],
      singleEvents: true,
      showDeleted: false,
      maxResults: 50,
      orderBy: "updated",
    });

    const items = (response.data.items ?? []).filter((item) => item.status !== "cancelled");
    if (items.length === 0) return null;

    const matchesKind = items.filter((item) => {
      const props = item.extendedProperties?.private ?? {};
      return props[maintenanceTypeProperty] === kind;
    });

    if (matchesKind.length === 0) return null;

    return matchesKind[0] ?? null;
  };

  const simpleHome = await findWithTaskIdProperty(`simplehomeTaskId=${taskId}`, "simplehomeMaintenanceType");
  if (simpleHome) {
    return simpleHome;
  }

  return findWithTaskIdProperty(`homeguardTaskId=${taskId}`, "homeguardMaintenanceType");
}

async function syncTaskEvent(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  task: MaintenanceTask,
  kind: SyncKind,
  selectionIncluded: boolean,
  doneCandidates: Map<string, calendar_v3.Schema$Event>,
): Promise<{
  task: MaintenanceTask;
  pushedEvents: number;
  pulledChanges: number;
  createdEvents: number;
  updatedEvents: number;
  completedFromGoogle: number;
  rescheduledFromGoogle: number;
}> {
  if (!selectionIncluded) {
    return {
      task,
      pushedEvents: 0,
      pulledChanges: 0,
      createdEvents: 0,
      updatedEvents: 0,
      completedFromGoogle: 0,
      rescheduledFromGoogle: 0,
    };
  }

  const currentSchedule = getTaskSchedule(task);
  const currentDateOnly = normalizeDateOnly(currentSchedule[kind] ?? null);
  if (!currentDateOnly) {
    return {
      task,
      pushedEvents: 0,
      pulledChanges: 0,
      createdEvents: 0,
      updatedEvents: 0,
      completedFromGoogle: 0,
      rescheduledFromGoogle: 0,
    };
  }

  const exportRecord = getGoogleSyncExport(task);
  const eventId = exportRecord?.eventIds?.[kind];
  const syncedDateOnly = normalizeDateOnly(exportRecord?.syncedDates?.[kind]);

  let event = eventId ? await getEventIfExists(calendar, calendarId, eventId) : null;
  if (!event) {
    // Support legacy or missing local mapping by finding matching event metadata on Google.
    event = await findEventByTaskAndKind(calendar, calendarId, task.id, kind);
    if (event?.id) {
      logGoogleSyncDebug(`[Google Sync] Recovered event mapping for task=${task.id} kind=${kind} eventId=${event.id}`);
    }
  } else if (eventId) {
    logGoogleSyncDebug(`[Google Sync] Using stored event mapping for task=${task.id} kind=${kind} eventId=${eventId}`);
  }

  if (!hasDoneMarker(event)) {
    const candidate = doneCandidates.get(doneCandidateKey(kind, task.title));
    if (candidate) {
      event = candidate;
      logGoogleSyncDebug(`[Google Sync] Matched [DONE] candidate by title for task=${task.id} kind=${kind} eventId=${candidate.id ?? "unknown"}`);
    }
  }
  let nextTask = task;
  let pulledChanges = 0;
  let pushedEvents = 0;
  let createdEvents = 0;
  let updatedEvents = 0;
  let completedFromGoogle = 0;
  let rescheduledFromGoogle = 0;

  const googleDateOnly = normalizeDateOnly(event?.start?.date ?? event?.start?.dateTime ?? null);
  const localChanged = !!syncedDateOnly && currentDateOnly !== syncedDateOnly;
  const googleChanged = !!syncedDateOnly && googleDateOnly !== syncedDateOnly;

  let resolvedDateOnly = currentDateOnly;

  // Treat [DONE] in Google as task completion, then roll to the next scheduled date.
  if (event && hasDoneMarker(event)) {
    const completion = deriveDoneCompletionDates(task, kind, event.start?.date ?? event.start?.dateTime ?? currentDateOnly);
    if (completion) {
      logWithLevel(
        "INFO",
        `[Google Sync] Applying [DONE] completion for task=${task.id} kind=${kind} completed=${completion.completedDateOnly} next=${completion.nextDateOnly}`,
      );
      const currentLast = getTaskLastMaintenance(nextTask);
      const existingCompletedDateOnly = normalizeDateOnly(currentLast[kind] ?? null);
      const existingNextDateOnly = normalizeDateOnly(currentSchedule[kind] ?? null);

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
        pulledChanges++;
      }

      completedFromGoogle++;

      resolvedDateOnly = completion.nextDateOnly;

      try {
        if (event.id) {
          await calendar.events.delete({ calendarId, eventId: event.id });
        }
      } catch {
        // Best effort delete to avoid duplicate done events.
      }

      // Force recreation of the next event after completion.
      event = null;
    }
  }

  if (event && googleDateOnly) {
    if (!localChanged && googleChanged) {
      const currentOverdueBacklog = getTaskOverdueBacklog(nextTask);
      const currentOverdueSince = getTaskOverdueSince(nextTask);
      const transition = deriveRescheduleBacklogState({
        currentDateOnly,
        googleDateOnly,
        existingBacklog: currentOverdueBacklog[kind],
        existingOverdueSince: currentOverdueSince[kind],
      });
      resolvedDateOnly = googleDateOnly;
      nextTask = {
        ...nextTask,
        nextMaintenanceDate: setTaskSchedule(nextTask, { [kind]: googleDateOnly }),
        overdueBacklog: setTaskOverdueBacklog(nextTask, { [kind]: transition.backlog }),
        overdueSince: setTaskOverdueSince(nextTask, { [kind]: transition.overdueSince }),
      };
      pulledChanges++;
      if (transition.rescheduled) {
        rescheduledFromGoogle++;
      }
    } else if (localChanged && googleChanged) {
      const googleUpdatedAt = event.updated ? new Date(event.updated).getTime() : 0;
      const taskUpdatedAt = nextTask.updatedAt ? new Date(nextTask.updatedAt).getTime() : 0;

      if (googleUpdatedAt > taskUpdatedAt) {
        const currentOverdueBacklog = getTaskOverdueBacklog(nextTask);
        const currentOverdueSince = getTaskOverdueSince(nextTask);
        const transition = deriveRescheduleBacklogState({
          currentDateOnly,
          googleDateOnly,
          existingBacklog: currentOverdueBacklog[kind],
          existingOverdueSince: currentOverdueSince[kind],
        });
        resolvedDateOnly = googleDateOnly;
        nextTask = {
          ...nextTask,
          nextMaintenanceDate: setTaskSchedule(nextTask, { [kind]: googleDateOnly }),
          overdueBacklog: setTaskOverdueBacklog(nextTask, { [kind]: transition.backlog }),
          overdueSince: setTaskOverdueSince(nextTask, { [kind]: transition.overdueSince }),
        };
        pulledChanges++;
        if (transition.rescheduled) {
          rescheduledFromGoogle++;
        }
      }
    }
  }

  const payload = buildEventPayload(nextTask, kind, resolvedDateOnly);

  if (!event) {
    const inserted = await calendar.events.insert({
      calendarId,
      requestBody: payload,
    });
    event = inserted.data;
    pushedEvents++;
    createdEvents++;
  } else if (!googleDateOnly || googleDateOnly !== resolvedDateOnly || event.summary !== payload.summary || event.description !== payload.description) {
    const updated = await calendar.events.patch({
      calendarId,
      eventId: event.id!,
      requestBody: payload,
    });
    event = updated.data;
    pushedEvents++;
    updatedEvents++;
  }

  const link = event?.htmlLink ?? undefined;
  const resultingEventId = event?.id ?? eventId;

  nextTask = {
    ...nextTask,
    calendarExports: upsertGoogleSyncExport(nextTask, {
      eventIds: { [kind]: resultingEventId },
      eventLinks: link ? { [kind]: link } : undefined,
      selected: { [kind]: true },
      syncedDates: { [kind]: resolvedDateOnly ?? currentSchedule[kind] ?? undefined },
      calendarId,
      lastSyncedAt: new Date().toISOString(),
    }),
  };

  return {
    task: nextTask,
    pushedEvents,
    pulledChanges,
    createdEvents,
    updatedEvents,
    completedFromGoogle,
    rescheduledFromGoogle,
  };
}

export async function getGoogleCalendarSyncStatus(req: express.Request): Promise<GoogleCalendarSyncStatus> {
  const userId = (req.user as { id?: string } | undefined)?.id;
  if (!userId) {
    throw new Error("Not authenticated");
  }

  if (!isGoogleCalendarConfigured()) {
    return {
      configured: false,
      connected: false,
      accountEmail: null,
      calendarId: null,
      lastSyncedAt: null,
    };
  }

  const connection = await storage.getGoogleCalendarConnection(userId);
  return {
    configured: true,
    connected: !!connection,
    accountEmail: connection?.email ?? null,
    calendarId: connection?.calendarId ?? null,
    lastSyncedAt: connection?.lastSyncedAt ? connection.lastSyncedAt.toISOString() : null,
    activeScopeCount: connection?.activeSyncSelections?.length ?? 0,
    syncScopeVersion: connection?.syncScopeVersion ?? undefined,
    syncScopeUpdatedAt: connection?.syncScopeUpdatedAt ? connection.syncScopeUpdatedAt.toISOString() : null,
  };
}

async function resolveActiveSyncScope(
  userId: string,
  requestSelections: GoogleSyncSelection[],
): Promise<SyncScopeOutcome> {
  const requested = normalizeSelections(requestSelections);
  const existingScope = normalizeSelections(await storage.getGoogleCalendarSyncScope(userId));

  if (existingScope.length > 0) {
    return {
      activeSelections: existingScope,
      initializedFromRequest: false,
    };
  }

  if (requested.length === 0) {
    throw new Error("Select at least one task to sync.");
  }

  const connection = await storage.setGoogleCalendarSyncScope(userId, requested);
  logWithLevel(
    "INFO",
    `[Google Sync] Initialized active sync scope with ${connection.activeSyncSelections.length} task(s) for user ${userId}`,
  );

  return {
    activeSelections: normalizeSelections(connection.activeSyncSelections),
    initializedFromRequest: true,
  };
}

export async function getGoogleCalendarSyncScope(req: express.Request): Promise<{ selections: GoogleSyncSelection[]; count: number }> {
  const userId = (req.user as { id?: string } | undefined)?.id;
  if (!userId) {
    throw new Error("Not authenticated");
  }

  const selections = normalizeSelections(await storage.getGoogleCalendarSyncScope(userId));
  return {
    selections,
    count: selections.length,
  };
}

export async function setGoogleCalendarSyncScope(
  req: express.Request,
  selections: GoogleSyncSelection[],
): Promise<{
  selections: GoogleSyncSelection[];
  count: number;
  syncScopeVersion: number;
  syncScopeUpdatedAt: string | null;
  removedEvents: number;
}> {
  const userId = (req.user as { id?: string } | undefined)?.id;
  if (!userId) {
    throw new Error("Not authenticated");
  }

  const normalized = normalizeSelections(selections);
  if (normalized.length === 0) {
    throw new Error("Select at least one task to include in sync scope.");
  }

  const previous = normalizeSelections(await storage.getGoogleCalendarSyncScope(userId));
  const removals = computeScopeRemovals(previous, normalized);

  const connection = await storage.setGoogleCalendarSyncScope(userId, normalized);

  let removedEvents = 0;
  if (removals.length > 0 && connection.calendarId) {
    removedEvents = await removeOutOfScopeGoogleEvents({
      req,
      userId,
      calendarId: connection.calendarId,
      removals,
    });
  }

  if (connection.calendarId) {
    removedEvents += await reconcileOutOfScopeGoogleEvents({
      req,
      userId,
      calendarId: connection.calendarId,
      activeSelections: normalized,
    });
  }

  return {
    selections: normalizeSelections(connection.activeSyncSelections),
    count: connection.activeSyncSelections.length,
    syncScopeVersion: connection.syncScopeVersion,
    syncScopeUpdatedAt: connection.syncScopeUpdatedAt ? connection.syncScopeUpdatedAt.toISOString() : null,
    removedEvents,
  };
}

export function createGoogleCalendarAuthorizationUrl(req: express.Request, returnPath: string | undefined): string {
  const oauth2Client = createOAuthClient(req);
  const state = randomBytes(24).toString("hex");
  (req.session as any).googleCalendarOAuth = {
    state,
    returnPath: returnPath && returnPath.startsWith("/") ? returnPath : "/",
  };

  return oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: GOOGLE_SCOPES,
    state,
  });
}

export async function handleGoogleCalendarOAuthCallback(req: express.Request): Promise<string> {
  const sessionState = (req.session as any).googleCalendarOAuth;
  const userId = (req.user as { id?: string } | undefined)?.id;
  if (!userId) {
    throw new Error("Not authenticated");
  }

  if (!sessionState?.state || req.query.state !== sessionState.state) {
    throw new Error("Google Calendar authorization state did not match.");
  }

  const code = typeof req.query.code === "string" ? req.query.code : null;
  if (!code) {
    throw new Error("Google Calendar authorization code is missing.");
  }

  const oauth2Client = createOAuthClient(req);
  const existing = await storage.getGoogleCalendarConnection(userId);
  const tokenResult = await oauth2Client.getToken(code);
  oauth2Client.setCredentials(tokenResult.tokens);

  const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
  const profile = await oauth2.userinfo.get();

  await storage.upsertGoogleCalendarConnection(userId, {
    email: profile.data.email ?? existing?.email ?? null,
    accessToken: tokenResult.tokens.access_token ?? existing?.accessToken ?? null,
    refreshToken: tokenResult.tokens.refresh_token ?? existing?.refreshToken ?? null,
    scope: tokenResult.tokens.scope ?? existing?.scope ?? null,
    tokenType: tokenResult.tokens.token_type ?? existing?.tokenType ?? null,
    expiryDate: tokenResult.tokens.expiry_date ?? existing?.expiryDate ?? null,
    connectedAt: new Date(),
  });

  const returnPath = sessionState.returnPath || "/";
  delete (req.session as any).googleCalendarOAuth;
  return returnPath;
}

export async function disconnectGoogleCalendar(req: express.Request): Promise<void> {
  const userId = (req.user as { id?: string } | undefined)?.id;
  if (!userId) {
    throw new Error("Not authenticated");
  }

  const connection = await storage.getGoogleCalendarConnection(userId);
  if (!connection) {
    return;
  }

  try {
    const oauth2Client = createOAuthClient(req);
    oauth2Client.setCredentials({
      access_token: connection.accessToken ?? undefined,
      refresh_token: connection.refreshToken ?? undefined,
    });
    await oauth2Client.revokeCredentials();
  } catch {
    // Best effort only; local disconnect still proceeds.
  }

  await storage.deleteGoogleCalendarConnection(userId);
}

export async function runGoogleCalendarTwoWaySync(
  req: express.Request,
  selections: GoogleSyncSelection[],
): Promise<SyncOutcome> {
  const userId = (req.user as { id?: string } | undefined)?.id;
  if (!userId) {
    throw new Error("Not authenticated");
  }

  if (!isGoogleCalendarConfigured()) {
    throw new Error("Google Calendar sync is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.");
  }

  const { activeSelections } = await resolveActiveSyncScope(userId, selections);

  // Fetch user's timezone preference for the calendar.
  const userRecord = await storage.getUserById(userId);
  const userTimezone = userRecord?.timezone || "UTC";

  const { calendar, calendarId } = await ensureCalendar(req, userId, userTimezone);
  const doneCandidates = await loadDoneCandidates(calendar, calendarId);
  if (doneCandidates.size > 0) {
    logGoogleSyncDebug(`[Google Sync] Loaded ${doneCandidates.size} [DONE] candidate event(s) from calendar ${calendarId}`);
  }
  let syncedTasks = 0;
  let pushedEvents = 0;
  let pulledChanges = 0;
  let createdEvents = 0;
  let updatedEvents = 0;
  let completedFromGoogle = 0;
  let rescheduledFromGoogle = 0;

  for (const selection of activeSelections) {
    const task = await storage.getMaintenanceTask(selection.taskId, userId);
    if (!task) {
      continue;
    }

    let nextTask = task;
    const minorResult = await syncTaskEvent(calendar, calendarId, nextTask, "minor", selection.includeMinor, doneCandidates);
    nextTask = minorResult.task;

    const majorResult = await syncTaskEvent(calendar, calendarId, nextTask, "major", selection.includeMajor, doneCandidates);
    nextTask = majorResult.task;

    const totalChanges =
      minorResult.pushedEvents +
      minorResult.pulledChanges +
      majorResult.pushedEvents +
      majorResult.pulledChanges;

      if (
        totalChanges > 0 ||
        nextTask.calendarExports !== task.calendarExports ||
        nextTask.nextMaintenanceDate !== task.nextMaintenanceDate ||
        nextTask.lastMaintenanceDate !== task.lastMaintenanceDate ||
        nextTask.overdueBacklog !== task.overdueBacklog ||
        nextTask.overdueSince !== task.overdueSince
      ) {
      await storage.updateMaintenanceTask(
        task.id,
        {
          calendarExports: nextTask.calendarExports ?? null,
          nextMaintenanceDate: nextTask.nextMaintenanceDate ?? null,
          lastMaintenanceDate: nextTask.lastMaintenanceDate ?? null,
          overdueBacklog: nextTask.overdueBacklog ?? null,
          overdueSince: nextTask.overdueSince ?? null,
        },
        userId,
      );
    }

    if (selection.includeMinor || selection.includeMajor) {
      syncedTasks++;
    }

    pushedEvents += minorResult.pushedEvents + majorResult.pushedEvents;
    pulledChanges += minorResult.pulledChanges + majorResult.pulledChanges;
    createdEvents += minorResult.createdEvents + majorResult.createdEvents;
    updatedEvents += minorResult.updatedEvents + majorResult.updatedEvents;
    completedFromGoogle += minorResult.completedFromGoogle + majorResult.completedFromGoogle;
    rescheduledFromGoogle += minorResult.rescheduledFromGoogle + majorResult.rescheduledFromGoogle;
  }

  const lastSyncedAt = new Date();
  await storage.upsertGoogleCalendarConnection(userId, {
    calendarId,
    lastSyncedAt,
  });

  return {
    syncedTasks,
    pushedEvents,
    pulledChanges,
    createdEvents,
    updatedEvents,
    completedFromGoogle,
    rescheduledFromGoogle,
    lastSyncedAt: lastSyncedAt.toISOString(),
    calendarId,
  };
}

/**
 * Deletes Google Calendar events associated with a task's direct-sync export record.
 * Called before a task is permanently deleted so the corresponding calendar events
 * are removed as well.  Failures are swallowed so the caller can still delete the task.
 */
export async function deleteGoogleCalendarEventsForTask(
  req: express.Request,
  task: MaintenanceTask,
): Promise<void> {
  const userId = (req.user as { id?: string } | undefined)?.id;
  if (!userId || !isGoogleCalendarConfigured()) return;

  const exportRecord = getGoogleSyncExport(task);
  if (!exportRecord || !exportRecord.eventIds) return;

  const connection = await storage.getGoogleCalendarConnection(userId);
  if (!connection) return;

  const calendarId = exportRecord.calendarId ?? connection.calendarId;
  if (!calendarId) return;

  const { calendar } = await getAuthorizedCalendar(req, userId);

  for (const kind of ["minor", "major"] as SyncKind[]) {
    const eventId = exportRecord.eventIds[kind];
    if (!eventId) continue;
    try {
      await calendar.events.delete({ calendarId, eventId });
    } catch {
      // Best effort — event may already be gone or never existed via direct sync.
    }
  }
}
