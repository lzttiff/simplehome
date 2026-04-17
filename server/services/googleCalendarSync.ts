import type express from "express";
import { randomBytes } from "crypto";
import { google, type calendar_v3 } from "googleapis";
import {
  normalizeDateOnly,
  normalizeCalendarExports,
  serializeCalendarExports,
  type CalendarExportRecord,
  type MaintenanceTask,
} from "@shared/schema";
import { storage } from "../storage";

export type GoogleSyncSelection = {
  taskId: string;
  includeMinor: boolean;
  includeMajor: boolean;
};

type SyncKind = "minor" | "major";

type GoogleCalendarSyncStatus = {
  configured: boolean;
  connected: boolean;
  accountEmail: string | null;
  calendarId: string | null;
  lastSyncedAt: string | null;
};

type SyncOutcome = {
  syncedTasks: number;
  pushedEvents: number;
  pulledChanges: number;
  createdEvents: number;
  updatedEvents: number;
  lastSyncedAt: string;
  calendarId: string;
};

const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/userinfo.email",
];

const GOOGLE_SYNC_PROVIDER = "google";
const GOOGLE_SYNC_MODE = "direct";
const GOOGLE_CALENDAR_NAME = "SimpleHome Maintenance";

function getGoogleClientId(): string | null {
  return process.env.GOOGLE_CLIENT_ID?.trim() || null;
}

function getGoogleClientSecret(): string | null {
  return process.env.GOOGLE_CLIENT_SECRET?.trim() || null;
}

function isGoogleCalendarConfigured(): boolean {
  return !!(getGoogleClientId() && getGoogleClientSecret());
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

function getTaskDescription(task: MaintenanceTask, kind: SyncKind): string {
  const raw = kind === "minor" ? task.minorTasks : task.majorTasks;
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.join("\n");
      }
    } catch {
      // Fall back to the task description below.
    }
  }

  return task.description || `Scheduled ${kind} maintenance`;
}

function getEventSummary(task: MaintenanceTask, kind: SyncKind): string {
  return `${kind === "minor" ? "Minor" : "Major"} Maintenance: ${task.title}`;
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

async function syncTaskEvent(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  task: MaintenanceTask,
  kind: SyncKind,
  selectionIncluded: boolean,
): Promise<{
  task: MaintenanceTask;
  pushedEvents: number;
  pulledChanges: number;
  createdEvents: number;
  updatedEvents: number;
}> {
  if (!selectionIncluded) {
    return { task, pushedEvents: 0, pulledChanges: 0, createdEvents: 0, updatedEvents: 0 };
  }

  const currentSchedule = getTaskSchedule(task);
  const currentDateOnly = normalizeDateOnly(currentSchedule[kind] ?? null);
  if (!currentDateOnly) {
    return { task, pushedEvents: 0, pulledChanges: 0, createdEvents: 0, updatedEvents: 0 };
  }

  const exportRecord = getGoogleSyncExport(task);
  const eventId = exportRecord?.eventIds?.[kind];
  const syncedDateOnly = normalizeDateOnly(exportRecord?.syncedDates?.[kind]);

  let event = eventId ? await getEventIfExists(calendar, calendarId, eventId) : null;
  let nextTask = task;
  let pulledChanges = 0;
  let pushedEvents = 0;
  let createdEvents = 0;
  let updatedEvents = 0;

  const googleDateOnly = normalizeDateOnly(event?.start?.date ?? event?.start?.dateTime ?? null);
  const localChanged = !!syncedDateOnly && currentDateOnly !== syncedDateOnly;
  const googleChanged = !!syncedDateOnly && googleDateOnly !== syncedDateOnly;

  let resolvedDateOnly = currentDateOnly;

  if (event && googleDateOnly) {
    if (!localChanged && googleChanged) {
      resolvedDateOnly = googleDateOnly;
      nextTask = {
        ...nextTask,
        nextMaintenanceDate: setTaskSchedule(nextTask, { [kind]: googleDateOnly }),
      };
      pulledChanges++;
    } else if (localChanged && googleChanged) {
      const googleUpdatedAt = event.updated ? new Date(event.updated).getTime() : 0;
      const taskUpdatedAt = nextTask.updatedAt ? new Date(nextTask.updatedAt).getTime() : 0;

      if (googleUpdatedAt > taskUpdatedAt) {
        resolvedDateOnly = googleDateOnly;
        nextTask = {
          ...nextTask,
          nextMaintenanceDate: setTaskSchedule(nextTask, { [kind]: googleDateOnly }),
        };
        pulledChanges++;
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

  if (selections.length === 0) {
    throw new Error("Select at least one task to sync.");
  }

  // Fetch user's timezone preference for the calendar.
  const userRecord = await storage.getUserById(userId);
  const userTimezone = userRecord?.timezone || "UTC";

  const { calendar, calendarId } = await ensureCalendar(req, userId, userTimezone);
  let syncedTasks = 0;
  let pushedEvents = 0;
  let pulledChanges = 0;
  let createdEvents = 0;
  let updatedEvents = 0;

  for (const selection of selections) {
    const task = await storage.getMaintenanceTask(selection.taskId, userId);
    if (!task) {
      continue;
    }

    let nextTask = task;
    const minorResult = await syncTaskEvent(calendar, calendarId, nextTask, "minor", selection.includeMinor);
    nextTask = minorResult.task;

    const majorResult = await syncTaskEvent(calendar, calendarId, nextTask, "major", selection.includeMajor);
    nextTask = majorResult.task;

    const totalChanges =
      minorResult.pushedEvents +
      minorResult.pulledChanges +
      majorResult.pushedEvents +
      majorResult.pulledChanges;

    if (totalChanges > 0 || nextTask.calendarExports !== task.calendarExports || nextTask.nextMaintenanceDate !== task.nextMaintenanceDate) {
      await storage.updateMaintenanceTask(
        task.id,
        {
          calendarExports: nextTask.calendarExports ?? null,
          nextMaintenanceDate: nextTask.nextMaintenanceDate ?? null,
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
