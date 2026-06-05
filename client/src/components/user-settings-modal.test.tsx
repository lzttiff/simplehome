/** @jest-environment jsdom */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import UserSettingsModal from './user-settings-modal';

jest.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: any) => (open ? <div>{children}</div> : null),
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
}));

jest.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled, type = 'button' }: any) => (
    <button type={type} onClick={onClick} disabled={disabled}>{children}</button>
  ),
}));

jest.mock('@/components/ui/input', () => ({
  Input: ({ ...props }: any) => <input {...props} />,
}));

jest.mock('@/components/ui/label', () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}));

jest.mock('@/components/ui/switch', () => ({
  Switch: ({ checked, onCheckedChange, disabled, id }: any) => (
    <input
      id={id}
      type="checkbox"
      checked={checked}
      onChange={(e) => onCheckedChange?.(e.target.checked)}
      disabled={disabled}
    />
  ),
}));

jest.mock('@/components/ui/select', () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children }: any) => <div>{children}</div>,
  SelectTrigger: ({ children }: any) => <button type="button">{children}</button>,
  SelectValue: ({ children }: any) => <>{children}</>,
}));

jest.mock('@/components/ui/tabs', () => {
  const React = require('react');

  type TabsContextValue = {
    value: string;
    onValueChange?: (value: string) => void;
  };

  const TabsContext = React.createContext({ value: 'profile' } as TabsContextValue);

  return {
    Tabs: ({ value, onValueChange, children }: any) => (
      <TabsContext.Provider value={{ value, onValueChange }}>
        <div>{children}</div>
      </TabsContext.Provider>
    ),
    TabsList: ({ children }: any) => <div>{children}</div>,
    TabsTrigger: ({ children, value }: any) => {
      const ctx = React.useContext(TabsContext);
      return (
        <button
          type="button"
          role="tab"
          aria-selected={ctx.value === value}
          onClick={() => ctx.onValueChange?.(value)}
        >
          {children}
        </button>
      );
    },
    TabsContent: ({ children, value }: any) => {
      const ctx = React.useContext(TabsContext);
      return ctx.value === value ? <div>{children}</div> : null;
    },
  };
});

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

describe('UserSettingsModal UI preferences (TD-UI-003C)', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('hydrates settings tab from persisted settingsActiveTab', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/user/ui-preferences')) {
        return {
          ok: true,
          json: async () => ({ settingsActiveTab: 'calendar' }),
        } as Response;
      }
      if (url.includes('/api/calendar/google/sync/status')) {
        return {
          ok: true,
          json: async () => ({ configured: false, connected: false, accountEmail: null, calendarId: null, lastSyncedAt: null }),
        } as Response;
      }
      if (url.includes('/api/calendar/apple/sync/status')) {
        return {
          ok: true,
          json: async () => ({ configured: false, connected: false, accountEmail: null, calendarId: null, lastSyncedAt: null }),
        } as Response;
      }
      if (url.includes('/api/user/ai-preferences')) {
        return {
          ok: true,
          json: async () => ({ aiProvider: null, aiAgentEnabled: false, aiPolicyVersion: null }),
        } as Response;
      }
      if (url.includes('/api/user/ai-credentials')) {
        return {
          ok: true,
          json: async () => ({
            hasGeminiApiKey: false,
            hasOpenAiApiKey: false,
            effectiveGeminiKeySource: 'none',
            effectiveOpenAiKeySource: 'none',
            updatedAt: null,
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as jest.Mock;

    render(
      <QueryClientProvider client={createQueryClient()}>
        <UserSettingsModal isOpen={true} onClose={() => {}} currentTimezone="UTC" currentName="Tester" />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /calendar/i }).getAttribute('aria-selected')).toBe('true');
    });

    expect(screen.getByText(/google calendar id/i)).toBeTruthy();
  });

  it('persists settings tab changes via debounced PATCH', async () => {
    jest.useFakeTimers();

    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/user/ui-preferences') && (!init?.method || init.method === 'GET')) {
        return {
          ok: true,
          json: async () => ({ settingsActiveTab: 'profile' }),
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
          json: async () => ({ configured: false, connected: false, accountEmail: null, calendarId: null, lastSyncedAt: null }),
        } as Response;
      }
      if (url.includes('/api/user/ai-preferences')) {
        return {
          ok: true,
          json: async () => ({ aiProvider: null, aiAgentEnabled: false, aiPolicyVersion: null }),
        } as Response;
      }
      if (url.includes('/api/user/ai-credentials')) {
        return {
          ok: true,
          json: async () => ({
            hasGeminiApiKey: false,
            hasOpenAiApiKey: false,
            effectiveGeminiKeySource: 'none',
            effectiveOpenAiKeySource: 'none',
            updatedAt: null,
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method || 'GET'}`);
    }) as jest.Mock;

    global.fetch = fetchMock;

    render(
      <QueryClientProvider client={createQueryClient()}>
        <UserSettingsModal isOpen={true} onClose={() => {}} currentTimezone="UTC" currentName="Tester" />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /profile/i }).getAttribute('aria-selected')).toBe('true');
    });

    await waitFor(() => {
      const getCalls = fetchMock.mock.calls.filter(
        ([url, config]) =>
          String(url).includes('/api/user/ui-preferences') &&
          (!(config as RequestInit | undefined)?.method || (config as RequestInit | undefined)?.method === 'GET'),
      );
      expect(getCalls.length).toBeGreaterThan(0);
    });

    fireEvent.click(screen.getByRole('tab', { name: /ai preferences/i }));

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /ai preferences/i }).getAttribute('aria-selected')).toBe('true');
    });

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
      expect(body.settingsActiveTab).toBe('ai-preferences');
    });

    jest.useRealTimers();
  });

  it('shows Apple Calendar setup in the calendar tab and can start a connection', async () => {
    const fetchMock = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/user/ui-preferences')) {
        return {
          ok: true,
          json: async () => ({ settingsActiveTab: 'calendar' }),
        } as Response;
      }
      if (url.includes('/api/calendar/google/sync/status')) {
        return {
          ok: true,
          json: async () => ({ configured: false, connected: false, accountEmail: null, calendarId: null, lastSyncedAt: null }),
        } as Response;
      }
      if (url.includes('/api/calendar/apple/sync/status')) {
        return {
          ok: true,
          json: async () => ({ configured: true, connected: false, accountEmail: null, calendarId: null, lastSyncedAt: null }),
        } as Response;
      }
      if (url.includes('/api/user/ai-preferences')) {
        return {
          ok: true,
          json: async () => ({ aiProvider: null, aiAgentEnabled: false, aiPolicyVersion: null }),
        } as Response;
      }
      if (url.includes('/api/user/ai-credentials')) {
        return {
          ok: true,
          json: async () => ({
            hasGeminiApiKey: false,
            hasOpenAiApiKey: false,
            effectiveGeminiKeySource: 'none',
            effectiveOpenAiKeySource: 'none',
            updatedAt: null,
          }),
        } as Response;
      }
      if (url.includes('/api/calendar/apple/sync/connect') && init?.method === 'POST') {
        return {
          ok: true,
          json: async () => ({ configured: true, connected: true, accountEmail: 'apple@example.com', calendarId: 'calendar-1', lastSyncedAt: null }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url} ${init?.method || 'GET'}`);
    }) as jest.Mock;

    global.fetch = fetchMock;

    render(
      <QueryClientProvider client={createQueryClient()}>
        <UserSettingsModal isOpen={true} onClose={() => {}} currentTimezone="UTC" currentName="Tester" />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /calendar/i }).getAttribute('aria-selected')).toBe('true');
    });

    expect(screen.getByText(/apple calendar is not connected/i)).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/apple id email/i), { target: { value: 'apple@example.com' } });
    fireEvent.change(screen.getByLabelText(/apple app-specific password/i), { target: { value: 'app-specific-password' } });
    fireEvent.change(screen.getByLabelText(/optional apple calendar id/i), { target: { value: 'calendar-1' } });

    fireEvent.click(screen.getByRole('button', { name: /^connect apple calendar$/i }));

    await waitFor(() => {
      const connectCalls = fetchMock.mock.calls.filter(
        ([url, config]) => String(url).includes('/api/calendar/apple/sync/connect') && (config as RequestInit | undefined)?.method === 'POST',
      );
      expect(connectCalls.length).toBeGreaterThan(0);
    });

    const connectCall = fetchMock.mock.calls.find(
      ([url, config]) => String(url).includes('/api/calendar/apple/sync/connect') && (config as RequestInit | undefined)?.method === 'POST',
    ) as [RequestInfo | URL, RequestInit] | undefined;
    expect(connectCall).toBeTruthy();
    const body = connectCall?.[1].body ? JSON.parse(String(connectCall[1].body)) : {};
    expect(body).toEqual({
      appleIdEmail: 'apple@example.com',
      appSpecificPassword: 'app-specific-password',
      calendarId: 'calendar-1',
    });
  });

  it('can reveal and re-hide the Apple app-specific password field', async () => {
    global.fetch = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/user/ui-preferences')) {
        return {
          ok: true,
          json: async () => ({ settingsActiveTab: 'calendar' }),
        } as Response;
      }
      if (url.includes('/api/calendar/google/sync/status')) {
        return {
          ok: true,
          json: async () => ({ configured: false, connected: false, accountEmail: null, calendarId: null, lastSyncedAt: null }),
        } as Response;
      }
      if (url.includes('/api/calendar/apple/sync/status')) {
        return {
          ok: true,
          json: async () => ({ configured: true, connected: false, accountEmail: null, calendarId: null, lastSyncedAt: null }),
        } as Response;
      }
      if (url.includes('/api/user/ai-preferences')) {
        return {
          ok: true,
          json: async () => ({ aiProvider: null, aiAgentEnabled: false, aiPolicyVersion: null }),
        } as Response;
      }
      if (url.includes('/api/user/ai-credentials')) {
        return {
          ok: true,
          json: async () => ({
            hasGeminiApiKey: false,
            hasOpenAiApiKey: false,
            effectiveGeminiKeySource: 'none',
            effectiveOpenAiKeySource: 'none',
            updatedAt: null,
          }),
        } as Response;
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }) as jest.Mock;

    render(
      <QueryClientProvider client={createQueryClient()}>
        <UserSettingsModal isOpen={true} onClose={() => {}} currentTimezone="UTC" currentName="Tester" />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(screen.getByRole('tab', { name: /calendar/i }).getAttribute('aria-selected')).toBe('true');
    });

    const passwordInput = screen.getByLabelText(/apple app-specific password/i);
    expect(passwordInput.getAttribute('type')).toBe('password');

    fireEvent.click(screen.getByRole('button', { name: /^show$/i }));
    expect(screen.getByLabelText(/apple app-specific password/i).getAttribute('type')).toBe('text');

    fireEvent.click(screen.getByRole('button', { name: /^hide$/i }));
    expect(screen.getByLabelText(/apple app-specific password/i).getAttribute('type')).toBe('password');
  });
});
