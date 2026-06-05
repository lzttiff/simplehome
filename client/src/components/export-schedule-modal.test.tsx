/** @jest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

jest.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ children, open }: any) => (open ? <div>{children}</div> : null),
  AlertDialogAction: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
  AlertDialogCancel: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
  AlertDialogContent: ({ children }: any) => <div>{children}</div>,
  AlertDialogDescription: ({ children }: any) => <p>{children}</p>,
  AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: any) => <h3>{children}</h3>,
}));

jest.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
}));

jest.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children }: any) => <div>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
  TabsContent: ({ children }: any) => <div>{children}</div>,
}));

const toastMock = jest.fn();

jest.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: toastMock }),
}));

const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        queryFn: async ({ queryKey }) => {
          const url = String(queryKey[0]);
          const response = await fetch(url, {
            credentials: 'include',
            cache: 'no-store',
          });
          if (!response.ok) {
            throw new Error(`${response.status}: ${(await response.text()) || response.statusText}`);
          }
          return response.json();
        },
      },
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

describe('ExportScheduleModal UI preferences (TD-UI-003B)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('hydrates selected provider from persisted UI preferences', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/user/ui-preferences')) {
        return {
          ok: true,
          json: async () => ({ selectedProvider: 'google', keepOutOfScopeEvents: false }),
        } as Response;
      }
      if (url.includes('/api/calendar/google/sync/status')) {
        return {
          ok: true,
          json: async () => ({ configured: true, connected: false, accountEmail: null, calendarId: null, lastSyncedAt: null }),
        } as Response;
      }
      if (url.includes('/api/calendar/apple/sync/status')) {
        return {
          ok: true,
          json: async () => ({ configured: false, connected: false, accountEmail: null, calendarId: null, lastSyncedAt: null }),
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
    expect(connectButton).toBeTruthy();
  });

  it('persists provider preference changes with PATCH', async () => {
    jest.useFakeTimers();

    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/user/ui-preferences') && (!init?.method || init.method === 'GET')) {
        return {
          ok: true,
          json: async () => ({ selectedProvider: 'google', keepOutOfScopeEvents: false }),
        } as Response;
      }
      if (url.includes('/api/user/ui-preferences') && init?.method === 'PATCH') {
        return {
          ok: true,
          json: async () => ({ ok: true }),
        } as Response;
      }
      if (url.includes('/api/calendar/google/sync/status')) {
        return {
          ok: true,
          json: async () => ({ configured: true, connected: false, accountEmail: null, calendarId: null, lastSyncedAt: null }),
        } as Response;
      }
      if (url.includes('/api/calendar/apple/sync/status')) {
        return {
          ok: true,
          json: async () => ({ configured: false, connected: false, accountEmail: null, calendarId: null, lastSyncedAt: null }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method || 'GET'}`);
    }) as jest.Mock;

    global.fetch = fetchMock;

    render(
      <QueryClientProvider client={createQueryClient()}>
        <ExportScheduleModal isOpen={true} onClose={() => {}} tasks={[createMockTask()]} />
      </QueryClientProvider>,
    );

    await screen.findByRole('button', { name: /connect google calendar/i });

    const appleButton = await screen.findByRole('button', { name: /^apple$/i });
    fireEvent.click(appleButton);

    await act(async () => {
      jest.advanceTimersByTime(450);
    });

    await waitFor(() => {
      const patchCalls = fetchMock.mock.calls.filter(
        ([url, config]) => String(url).includes('/api/user/ui-preferences') && (config as RequestInit | undefined)?.method === 'PATCH',
      );
      expect(patchCalls.length).toBeGreaterThan(0);

      const latestPatch = patchCalls[patchCalls.length - 1] as [RequestInfo | URL, RequestInit];
      const body = latestPatch[1].body ? JSON.parse(String(latestPatch[1].body)) : {};
      expect(body.selectedProvider).toBe('apple');
      expect(body.keepOutOfScopeEvents).toBe(false);
    });

    jest.useRealTimers();
  });
});
