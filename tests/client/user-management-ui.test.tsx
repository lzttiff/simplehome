/** @jest-environment jsdom */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import AccountMenu from '../../client/src/components/account-menu';
import BulkFillDatesModal from '../../client/src/components/bulk-fill-dates-modal';
import UserSettingsModal from '../../client/src/components/user-settings-modal';

jest.mock('../../client/src/hooks/use-toast', () => ({
  useToast: () => ({ toast: jest.fn() }),
}));

// Make date selection deterministic for the modal tests.
jest.mock('../../client/src/components/ui/calendar', () => ({
  Calendar: ({ onSelect }: { onSelect?: (d: Date) => void }) => (
    <button type="button" onClick={() => onSelect?.(new Date('2026-05-15T00:00:00Z'))}>
      Select test date
    </button>
  ),
}));

const mockUser: any = {
  id: 'user-1',
  email: 'test@example.com',
  passwordHash: 'hash',
  name: 'Test User',
  timezone: 'America/New_York',
  createdAt: new Date(),
};

function renderWithClient(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>);
}

describe('Account Menu - UI Tests', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  it('renders initials button from user name', () => {
    renderWithClient(<AccountMenu user={mockUser} />);
    expect(screen.getByRole('button', { name: 'TU' })).toBeInTheDocument();
  });

  it('opens dropdown and shows logout option', async () => {
    const user = userEvent.setup();
    renderWithClient(<AccountMenu user={mockUser} />);

    await user.click(screen.getByRole('button', { name: 'TU' }));

    await waitFor(() => {
      expect(screen.getByRole('menuitem', { name: /log out/i })).toBeInTheDocument();
    });
  });

  it('calls logout endpoint when clicking log out', async () => {
    const user = userEvent.setup();
    renderWithClient(<AccountMenu user={mockUser} />);

    await user.click(screen.getByRole('button', { name: 'TU' }));
    const logoutButton = await screen.findByRole('menuitem', { name: /log out/i });
    await user.click(logoutButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/auth/logout',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  it('opens change password dialog from menu', async () => {
    const user = userEvent.setup();
    renderWithClient(<AccountMenu user={mockUser} />);

    await user.click(screen.getByRole('button', { name: 'TU' }));
    await user.click(await screen.findByRole('menuitem', { name: /change password/i }));

    expect(await screen.findByText(/change password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/current password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^new password/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/confirm new password/i)).toBeInTheDocument();
  });

  it('opens delete account dialog and shows calendar data checkbox', async () => {
    const user = userEvent.setup();
    renderWithClient(<AccountMenu user={mockUser} />);

    await user.click(screen.getByRole('button', { name: 'TU' }));
    await user.click(await screen.findByRole('menuitem', { name: /delete account/i }));

    expect(await screen.findByRole('heading', { name: /delete account/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/enter your password to confirm/i)).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
  });
});

describe('Bulk Fill Dates Modal - UI Tests', () => {
  const onClose = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders selected count and required selectors', () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    renderWithClient(
      <BulkFillDatesModal
        isOpen={true}
        onClose={onClose}
        selectedCount={2}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByText(/update 2 selected item\(s\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/date kind/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/apply mode/i)).toBeInTheDocument();
  });

  it('keeps apply button disabled until a date is selected', () => {
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    renderWithClient(
      <BulkFillDatesModal
        isOpen={true}
        onClose={onClose}
        selectedCount={1}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByRole('button', { name: /apply/i })).toBeDisabled();
  });

  it('enables apply and submits payload after date selection', async () => {
    const user = userEvent.setup();
    const onSubmit = jest.fn().mockResolvedValue(undefined);
    renderWithClient(
      <BulkFillDatesModal
        isOpen={true}
        onClose={onClose}
        selectedCount={1}
        onSubmit={onSubmit}
      />,
    );

    const dateTrigger = screen.getByLabelText(/^date$/i);
    await user.click(dateTrigger);
    await user.click(await screen.findByRole('button', { name: /select test date/i }));

    const apply = screen.getByRole('button', { name: /apply/i });
    expect(apply).not.toBeDisabled();

    fireEvent.click(apply);

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
      const payload = onSubmit.mock.calls[0][0];
      expect(payload.kind).toBe('minor');
      expect(payload.mode).toBe('fill-empty-only');
      expect(payload.date).toMatch(/^2026-05-\d{2}$/);
    });
  });
});

describe('User Settings Modal - Google Calendar tests', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('shows disconnected state when status reports not connected', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ configured: true, connected: false, calendarId: null, accountEmail: null }),
    });

    renderWithClient(
      <UserSettingsModal
        isOpen={true}
        onClose={jest.fn()}
        currentTimezone="America/New_York"
        currentName="Test User"
      />,
    );

    expect(await screen.findByText(/google calendar id/i)).toBeInTheDocument();
    expect(await screen.findByText(/not connected/i)).toBeInTheDocument();
  });

  it('shows connected calendar details and actions', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        configured: true,
        connected: true,
        calendarId: 'test@gmail.com',
        accountEmail: 'test@gmail.com',
        lastSyncedAt: new Date().toISOString(),
      }),
    });

    renderWithClient(
      <UserSettingsModal
        isOpen={true}
        onClose={jest.fn()}
        currentTimezone="America/New_York"
        currentName="Test User"
      />,
    );

    expect(await screen.findByText('test@gmail.com')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy calendar id/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /open google calendar settings/i })).toBeInTheDocument();
  });
});
