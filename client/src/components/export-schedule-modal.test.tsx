import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ExportScheduleModal from './export-schedule-modal';
import type { MaintenanceTask } from '@shared/schema';

jest.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: any) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
}));

jest.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));

const toastMock = jest.fn();

jest.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: toastMock,
  }),
}));

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });

const createMockTask = (overrides: Partial<MaintenanceTask> = {}): MaintenanceTask => ({
  id: 'task-1',
  userId: 'user-1',
  title: 'Replace HVAC Filter',
  description: 'Swap the main filter',
  category: 'HVAC & Mechanical',
  priority: 'Medium',
  status: 'pending',
  lastMaintenanceDate: JSON.stringify({ minor: null, major: null }),
  nextMaintenanceDate: JSON.stringify({
    minor: '2026-04-01T00:00:00.000Z',
    major: '2026-10-01T00:00:00.000Z',
  }),
  isTemplate: false,
  isAiGenerated: false,
  templateId: null,
  notes: null,
  brand: null,
  model: null,
  serialNumber: null,
  location: 'Hallway',
  installationDate: new Date('2020-01-01T00:00:00.000Z'),
  warrantyPeriodMonths: null,
  minorIntervalMonths: 6,
  majorIntervalMonths: 12,
  minorTasks: JSON.stringify(['Inspect airflow', 'Replace filter']),
  majorTasks: JSON.stringify(['Deep clean unit']),
  relatedItemIds: null,
  calendarExports: null,
  dueDate: null,
  createdAt: new Date('2025-01-01T00:00:00.000Z'),
  updatedAt: new Date('2025-01-01T00:00:00.000Z'),
  ...overrides,
});

describe('ExportScheduleModal Google sync', () => {
  const originalLocation = window.location;
  let assignMock: jest.Mock;

  beforeEach(() => {
    jest.resetAllMocks();
    assignMock = jest.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        pathname: '/dashboard/test-template',
        search: '',
        assign: assignMock,
      },
    });
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
    });
  });

  afterAll(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });

  it('starts Google OAuth when sync is configured but not connected', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/calendar/google/sync/status')) {
        return {
          ok: true,
          json: async () => ({
            configured: true,
            connected: false,
            accountEmail: null,
            calendarId: null,
            lastSyncedAt: null,
          }),
        } as Response;
      }
      if (url.includes('/api/calendar/google/sync/start')) {
        return {
          ok: true,
          json: async () => ({ authorizationUrl: 'https://accounts.google.com/mock-auth' }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method || 'GET'}`);
    }) as jest.Mock;

    render(
      <QueryClientProvider client={createQueryClient()}>
        <ExportScheduleModal isOpen={true} onClose={() => {}} tasks={[createMockTask()]} />
      </QueryClientProvider>,
    );

    const connectButton = await screen.findByRole('button', { name: /connect google calendar/i });
    fireEvent.click(connectButton);

    await waitFor(() => {
      expect(assignMock).toHaveBeenCalledWith('https://accounts.google.com/mock-auth');
    });
  });

  it('syncs selected tasks when Google Calendar is connected', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/calendar/google/sync/status')) {
        return {
          ok: true,
          json: async () => ({
            configured: true,
            connected: true,
            accountEmail: 'owner@example.com',
            calendarId: 'homeguard@example.com',
            lastSyncedAt: '2026-03-20T12:00:00.000Z',
          }),
        } as Response;
      }
      if (url.includes('/api/calendar/google/sync') && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({
            syncedTasks: 1,
            pushedEvents: 2,
            pulledChanges: 1,
            createdEvents: 1,
            updatedEvents: 1,
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method || 'GET'}`);
    }) as jest.Mock;

    render(
      <QueryClientProvider client={createQueryClient()}>
        <ExportScheduleModal isOpen={true} onClose={() => {}} tasks={[createMockTask()]} />
      </QueryClientProvider>,
    );

    const syncButton = await screen.findByRole('button', { name: /sync selected two-way/i });
    fireEvent.click(syncButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/calendar/google/sync',
        expect.objectContaining({
          method: 'POST',
          credentials: 'include',
        }),
      );
    });

    expect(toastMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Google Calendar Synced',
      }),
    );
  });
});
