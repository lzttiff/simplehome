import { sanitizeAppleSyncErrorMessage } from '../../server/services/appleCalendarSync';

describe('sanitizeAppleSyncErrorMessage', () => {
  test('keeps approved safe messages', () => {
    const out = sanitizeAppleSyncErrorMessage(
      new Error('Apple Calendar is not connected.'),
      'Apple Calendar sync failed',
    );

    expect(out).toBe('Apple Calendar is not connected.');
  });

  test('redacts unknown sensitive message content', () => {
    const out = sanitizeAppleSyncErrorMessage(
      new Error('Provider auth failed: password=abcd token=1234'),
      'Apple Calendar sync failed',
    );

    expect(out).toBe('Apple Calendar sync failed');
    expect(out.toLowerCase()).not.toContain('password');
    expect(out.toLowerCase()).not.toContain('token');
  });

  test('redacts unknown provider/internal messages', () => {
    const out = sanitizeAppleSyncErrorMessage(
      new Error('Unexpected DAV failure at /calendars/user/private-id with upstream detail'),
      'Failed to connect Apple Calendar',
    );

    expect(out).toBe('Failed to connect Apple Calendar');
    expect(out).not.toContain('private-id');
  });
});
