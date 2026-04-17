import type { MaintenanceTask } from '../../shared/schema';
import { deriveDoneCompletionDates } from '../../server/services/googleCalendarSync';

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
