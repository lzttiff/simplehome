import {
  categorizeAppleSyncError,
  hasDoneMarkerInAppleEventData,
  resolveAppleConflict,
  sanitizeAppleSyncErrorMessage,
  shouldRetryAppleSyncError,
  withAppleDavRetry,
} from '../../server/services/appleCalendarSync';

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

describe('hasDoneMarkerInAppleEventData', () => {
  test('detects [DONE] marker in summary', () => {
    const ical = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:[DONE] Minor Maintenance: HVAC Filter',
      'DESCRIPTION:Done in Apple Calendar',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    expect(hasDoneMarkerInAppleEventData(ical)).toBe(true);
  });

  test('detects [done] marker in description case-insensitively', () => {
    const ical = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:Minor Maintenance: HVAC Filter',
      'DESCRIPTION:completed today [done]',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    expect(hasDoneMarkerInAppleEventData(ical)).toBe(true);
  });

  test('detects plain DONE prefix in description', () => {
    const ical = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:Major Maintenance: Ceiling Fans',
      'DESCRIPTION:DONE Maintenance task for Ceiling Fans',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    expect(hasDoneMarkerInAppleEventData(ical)).toBe(true);
  });

  test('does not treat "Last done:" metadata as DONE marker', () => {
    const ical = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:Major Maintenance: Ceiling Fans',
      'DESCRIPTION:Regular maintenance\\nLast done: 2026-05-21\\nCategory: Electrical',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    expect(hasDoneMarkerInAppleEventData(ical)).toBe(false);
  });

  test('returns false when marker is absent', () => {
    const ical = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'SUMMARY:Minor Maintenance: HVAC Filter',
      'DESCRIPTION:Routine maintenance',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    expect(hasDoneMarkerInAppleEventData(ical)).toBe(false);
  });
});

describe('Apple retry resilience helpers', () => {
  test('categorizes auth/network/provider errors', () => {
    expect(categorizeAppleSyncError(new Error('invalid credential password rejected'))).toBe('auth');
    expect(categorizeAppleSyncError(new Error('socket timeout ECONNRESET from upstream'))).toBe('network');
    expect(categorizeAppleSyncError(new Error('DAV calendar object update failed'))).toBe('provider');
  });

  test('retries only retryable errors', () => {
    expect(shouldRetryAppleSyncError(new Error('network timeout'))).toBe(true);
    expect(shouldRetryAppleSyncError(new Error('DAV error while updating calendar'))).toBe(true);
    expect(shouldRetryAppleSyncError(new Error('invalid credential password'))).toBe(false);
  });

  test('withAppleDavRetry retries once then succeeds', async () => {
    let attempts = 0;
    const out = await withAppleDavRetry(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('network timeout');
      }
      return 'ok';
    }, 2);

    expect(out).toBe('ok');
    expect(attempts).toBe(2);
  });

  test('withAppleDavRetry does not retry auth errors', async () => {
    let attempts = 0;
    await expect(withAppleDavRetry(async () => {
      attempts += 1;
      throw new Error('invalid credential password');
    }, 3)).rejects.toThrow('invalid credential password');

    expect(attempts).toBe(1);
  });
});
