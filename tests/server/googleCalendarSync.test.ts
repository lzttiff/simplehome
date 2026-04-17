import type { MaintenanceTask } from '../../shared/schema';
import {
  buildCalendarTaskDescription,
  deriveDoneCompletionDates,
  deriveRescheduleBacklogState,
} from '../../server/services/googleCalendarSync';

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
