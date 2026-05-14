import { resolveAppleConflict, sanitizeAppleSyncErrorMessage } from '../../server/services/appleCalendarSync';

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

describe('resolveAppleConflict', () => {
  test('picks remote when only remote changed', () => {
    const out = resolveAppleConflict({
      localChanged: false,
      remoteChanged: true,
      localUpdatedAt: '2026-05-01T00:00:00.000Z',
      remoteLastModifiedAt: '2026-05-02T00:00:00.000Z',
      lastSyncedAt: '2026-04-30T00:00:00.000Z',
    });

    expect(out).toBe('remote');
  });

  test('picks newer side when both changed and remote timestamp is newer', () => {
    const out = resolveAppleConflict({
      localChanged: true,
      remoteChanged: true,
      localUpdatedAt: '2026-05-02T10:00:00.000Z',
      remoteLastModifiedAt: '2026-05-02T11:00:00.000Z',
      lastSyncedAt: '2026-05-01T00:00:00.000Z',
    });

    expect(out).toBe('remote');
  });

  test('uses deterministic local tie-breaker when remote freshness is not provably newer', () => {
    const out = resolveAppleConflict({
      localChanged: true,
      remoteChanged: true,
      localUpdatedAt: '2026-05-02T11:00:00.000Z',
      remoteLastModifiedAt: '2026-05-02T11:00:00.000Z',
      lastSyncedAt: '2026-05-01T00:00:00.000Z',
    });

    expect(out).toBe('local');
  });
});
