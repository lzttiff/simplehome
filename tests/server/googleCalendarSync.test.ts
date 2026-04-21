import type { MaintenanceTask } from '../../shared/schema';
import {
  buildCalendarTaskDescription,
  disconnectGoogleCalendar,
  deriveDoneCompletionDates,
  deriveRescheduleBacklogState,
} from '../../server/services/googleCalendarSync';
import { storage } from '../../server/storage';
import { google } from 'googleapis';

var calendarGetImpl: any;
var calendarDeleteImpl: any;
var revokeCredentialsImpl: any;
var eventsListImpl: any;
var eventsDeleteImpl: any;

jest.mock('../../server/storage', () => ({
  storage: {
    getGoogleCalendarConnection: jest.fn(),
    upsertGoogleCalendarConnection: jest.fn(),
    deleteGoogleCalendarConnection: jest.fn(),
  },
}));

jest.mock('googleapis', () => ({
  google: {
    __mock: {
      oauthClient: {
        setCredentials: jest.fn(),
        revokeCredentials: jest.fn((...args: any[]) => revokeCredentialsImpl(...args)),
        on: jest.fn(),
      },
      calendarApi: {
        calendars: {
          get: jest.fn((...args: any[]) => calendarGetImpl(...args)),
          delete: jest.fn((...args: any[]) => calendarDeleteImpl(...args)),
        },
        events: {
          list: jest.fn((...args: any[]) => eventsListImpl(...args)),
          delete: jest.fn((...args: any[]) => eventsDeleteImpl(...args)),
        },
      },
    },
    auth: {
      OAuth2: jest.fn(function () {
        return (google as any).__mock.oauthClient;
      }),
    },
    calendar: jest.fn(function () {
      return (google as any).__mock.calendarApi;
    }),
    oauth2: jest.fn(() => ({
      userinfo: {
        get: jest.fn(),
      },
    })),
  },
}));

function createTask(overrides: Partial<MaintenanceTask> = {}): MaintenanceTask {
  return {
    id: 'task-1',
    userId: 'user-1',
    title: 'Smoke Detectors',
    description: 'Replace batteries',
    category: 'Safety & Fire',
    priority: 'Medium',
    status: 'pending',
    lastMaintenanceDate: null,
    nextMaintenanceDate: null,
    isTemplate: false,
    isAiGenerated: true,
    templateId: null,
    notes: null,
    brand: null,
    model: null,
    serialNumber: null,
    location: 'Hallway',
    installationDate: null,
    warrantyPeriodMonths: null,
    minorIntervalMonths: 12,
    majorIntervalMonths: 60,
    minorTasks: null,
    majorTasks: null,
    relatedItemIds: null,
    calendarExports: null,
    dueDate: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('deriveDoneCompletionDates', () => {
  test('minor completion maps done date to next date using interval', () => {
    const task = createTask({ minorIntervalMonths: 6 });
    const out = deriveDoneCompletionDates(task, 'minor', '2026-04-16');

    expect(out).not.toBeNull();
    expect(out?.completedDateOnly).toBe('2026-04-16');
    expect(out?.nextDateOnly).toBe('2026-10-16');
  });

  test('major completion maps ISO date-time into date-only and applies interval', () => {
    const task = createTask({ majorIntervalMonths: 24 });
    const out = deriveDoneCompletionDates(task, 'major', '2026-04-16T11:13:10.000Z');

    expect(out).not.toBeNull();
    expect(out?.completedDateOnly).toBe('2026-04-16');
    expect(out?.nextDateOnly).toBe('2028-04-16');
  });

  test('falls back to completed date when interval is missing', () => {
    const task = createTask({ minorIntervalMonths: null });
    const out = deriveDoneCompletionDates(task, 'minor', '2026-04-16');

    expect(out).not.toBeNull();
    expect(out?.completedDateOnly).toBe('2026-04-16');
    expect(out?.nextDateOnly).toBe('2026-04-16');
  });

  test('returns null for invalid completion dates', () => {
    const task = createTask();
    const out = deriveDoneCompletionDates(task, 'minor', 'not-a-date');

    expect(out).toBeNull();
  });
});

describe('buildCalendarTaskDescription', () => {
  test('renders readable checklist details when task steps are present', () => {
    const task = createTask({
      minorTasks: JSON.stringify(['Replace battery', 'Test alarm']),
      location: 'Main Hall',
      priority: 'High',
    });

    const output = buildCalendarTaskDescription(task, 'minor');

    expect(output).toContain('Task: Smoke Detectors');
    expect(output).toContain('Type: Minor maintenance');
    expect(output).toContain('Category: Safety & Fire');
    expect(output).toContain('Priority: High');
    expect(output).toContain('Location: Main Hall');
    expect(output).toContain('Checklist:');
    expect(output).toContain('- Replace battery');
    expect(output).toContain('- Test alarm');
  });

  test('falls back to notes section when no steps exist', () => {
    const task = createTask({
      majorTasks: null,
      description: 'Inspect all detectors and replace as needed.',
    });

    const output = buildCalendarTaskDescription(task, 'major');

    expect(output).toContain('Type: Major maintenance');
    expect(output).toContain('Notes:');
    expect(output).toContain('Inspect all detectors and replace as needed.');
  });
});

describe('deriveRescheduleBacklogState', () => {
  test('marks backlog true when rescheduling an overdue task', () => {
    const out = deriveRescheduleBacklogState({
      currentDateOnly: '2026-04-01',
      googleDateOnly: '2026-04-20',
      existingBacklog: false,
      existingOverdueSince: null,
      todayDateOnly: '2026-04-17',
    });

    expect(out).toEqual({
      rescheduled: true,
      backlog: true,
      overdueSince: '2026-04-01',
    });
  });

  test('clears backlog when rescheduling a non-overdue task', () => {
    const out = deriveRescheduleBacklogState({
      currentDateOnly: '2026-04-25',
      googleDateOnly: '2026-05-01',
      existingBacklog: true,
      existingOverdueSince: '2026-04-10',
      todayDateOnly: '2026-04-17',
    });

    expect(out).toEqual({
      rescheduled: true,
      backlog: false,
      overdueSince: null,
    });
  });

  test('returns no reschedule when date is unchanged', () => {
    const out = deriveRescheduleBacklogState({
      currentDateOnly: '2026-04-25',
      googleDateOnly: '2026-04-25',
      existingBacklog: true,
      existingOverdueSince: '2026-04-10',
      todayDateOnly: '2026-04-17',
    });

    expect(out).toEqual({
      rescheduled: false,
      backlog: true,
      overdueSince: '2026-04-10',
    });
  });
});

describe('disconnectGoogleCalendar', () => {
  const previousClientId = process.env.GOOGLE_CLIENT_ID;
  const previousClientSecret = process.env.GOOGLE_CLIENT_SECRET;

  const requestStub = {
    user: { id: 'user-1' },
    protocol: 'https',
    headers: {},
    get: jest.fn(() => 'example.com'),
  } as any;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.GOOGLE_CLIENT_ID = 'test-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-client-secret';

    const storageMock = storage as any;
    const googleMock = (google as any).__mock;

    calendarGetImpl = async () => ({
      data: { summary: 'SimpleHome Maintenance' },
    });
    calendarDeleteImpl = async () => ({});
    revokeCredentialsImpl = async () => undefined;
    eventsListImpl = async () => ({ data: { items: [] } });
    eventsDeleteImpl = async () => ({});

    storageMock.deleteGoogleCalendarConnection.mockResolvedValue(true);
    storageMock.getGoogleCalendarConnection.mockResolvedValue({
      userId: 'user-1',
      email: 'user@example.com',
      calendarId: 'simplehome-calendar-id',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      scope: null,
      tokenType: null,
      expiryDate: null,
      connectedAt: new Date(),
      lastSyncedAt: null,
      activeSyncSelections: [],
      syncScopeVersion: 1,
      syncScopeUpdatedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    googleMock.calendarApi.calendars.get.mockImplementation((...args: any[]) => calendarGetImpl(...args));
    googleMock.calendarApi.calendars.delete.mockImplementation((...args: any[]) => calendarDeleteImpl(...args));
    googleMock.calendarApi.events.list.mockImplementation((...args: any[]) => eventsListImpl(...args));
    googleMock.calendarApi.events.delete.mockImplementation((...args: any[]) => eventsDeleteImpl(...args));
    googleMock.oauthClient.revokeCredentials.mockImplementation((...args: any[]) => revokeCredentialsImpl(...args));
  });

  afterAll(() => {
    process.env.GOOGLE_CLIENT_ID = previousClientId;
    process.env.GOOGLE_CLIENT_SECRET = previousClientSecret;
  });

  test('deletes managed calendar when requested and safe', async () => {
    const storageMock = storage as any;
    const googleMock = (google as any).__mock;
    const out = await disconnectGoogleCalendar(requestStub, { deleteCalendar: true });

    expect(googleMock.calendarApi.calendars.delete).toHaveBeenCalledWith({ calendarId: 'simplehome-calendar-id' });
    expect(storageMock.deleteGoogleCalendarConnection).toHaveBeenCalledWith('user-1');
    expect(out).toEqual({
      disconnected: true,
      calendarDeleteRequested: true,
      calendarDeleted: true,
      calendarDeleteMessage: null,
    });
  });

  test('still deletes by calendar id even when summary is renamed', async () => {
    const storageMock = storage as any;
    calendarGetImpl = async () => ({ data: { summary: 'Family Calendar' } });

    const out = await disconnectGoogleCalendar(requestStub, { deleteCalendar: true });

    expect(storageMock.deleteGoogleCalendarConnection).toHaveBeenCalledWith('user-1');
    expect(out.calendarDeleteRequested).toBe(true);
    expect(out.calendarDeleted).toBe(true);
    expect(out.calendarDeleteMessage).toBeNull();
  });

  test('disconnect still succeeds when calendar deletion fails and managed events are cleaned up', async () => {
    const storageMock = storage as any;
    const googleMock = (google as any).__mock;
    calendarGetImpl = async () => {
      throw { code: 500 };
    };
    calendarDeleteImpl = async () => {
      throw { code: 403 };
    };
    eventsListImpl = async () => ({
      data: {
        items: [
          {
            id: 'event-1',
            status: 'confirmed',
            extendedProperties: { private: { simplehomeTaskId: 'task-1' } },
          },
        ],
      },
    });

    const out = await disconnectGoogleCalendar(requestStub, { deleteCalendar: true });

    expect(storageMock.deleteGoogleCalendarConnection).toHaveBeenCalledWith('user-1');
    expect(googleMock.calendarApi.events.delete).toHaveBeenCalledWith({
      calendarId: 'simplehome-calendar-id',
      eventId: 'event-1',
    });
    expect(out.calendarDeleteRequested).toBe(true);
    expect(out.calendarDeleted).toBe(false);
    expect(out.calendarDeleteMessage).toContain('managed event(s) were removed');
  });

  test('fallback cleanup continues when some event deletes fail', async () => {
    const googleMock = (google as any).__mock;
    calendarDeleteImpl = async () => {
      throw { code: 403 };
    };
    eventsListImpl = async () => ({
      data: {
        items: [
          {
            id: 'event-ok',
            status: 'confirmed',
            extendedProperties: { private: { simplehomeTaskId: 'task-1' } },
          },
          {
            id: 'event-fail',
            status: 'confirmed',
            extendedProperties: { private: { simplehomeTaskId: 'task-2' } },
          },
          {
            id: 'event-source-title',
            status: 'confirmed',
            source: { title: 'SimpleHome' },
          },
        ],
      },
    });
    eventsDeleteImpl = async ({ eventId }: { eventId: string }) => {
      if (eventId === 'event-fail') {
        throw { code: 500 };
      }
      return {};
    };

    const out = await disconnectGoogleCalendar(requestStub, { deleteCalendar: true });

    expect(googleMock.calendarApi.events.delete).toHaveBeenCalledWith({
      calendarId: 'simplehome-calendar-id',
      eventId: 'event-ok',
    });
    expect(googleMock.calendarApi.events.delete).toHaveBeenCalledWith({
      calendarId: 'simplehome-calendar-id',
      eventId: 'event-fail',
    });
    expect(googleMock.calendarApi.events.delete).toHaveBeenCalledWith({
      calendarId: 'simplehome-calendar-id',
      eventId: 'event-source-title',
    });
    expect(out.calendarDeleted).toBe(false);
    expect(out.calendarDeleteMessage).toContain('could not be removed');
  });

  test('refuses delete when connected calendar is primary', async () => {
    const storageMock = storage as any;
    storageMock.getGoogleCalendarConnection.mockResolvedValue({
      userId: 'user-1',
      email: 'user@example.com',
      calendarId: 'primary',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      scope: null,
      tokenType: null,
      expiryDate: null,
      connectedAt: new Date(),
      lastSyncedAt: null,
      activeSyncSelections: [],
      syncScopeVersion: 1,
      syncScopeUpdatedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const out = await disconnectGoogleCalendar(requestStub, { deleteCalendar: true });

    expect(out.calendarDeleted).toBe(false);
    expect(out.calendarDeleteMessage).toContain('Refused to delete primary');
  });
});
