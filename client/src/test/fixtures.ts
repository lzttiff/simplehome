import type { MaintenanceTask } from '@shared/schema';

export function createMaintenanceTaskFixture(
  overrides: Partial<MaintenanceTask> = {},
): MaintenanceTask {
  return {
    id: '1',
    userId: 'user-1',
    templateId: 'template-1',
    title: 'Test Task',
    description: 'Test description',
    category: 'Appliances',
    priority: 'Medium',
    status: 'pending',
    brand: 'TestBrand',
    model: 'TestModel',
    serialNumber: null,
    location: 'Kitchen',
    installationDate: new Date('2020-01-01T00:00:00.000Z'),
    lastMaintenanceDate: JSON.stringify({ minor: null, major: null }),
    nextMaintenanceDate: JSON.stringify({ minor: '2026-03-01', major: '2027-01-01' }),
    overdueBacklog: null,
    overdueSince: null,
    isTemplate: false,
    isAiGenerated: false,
    minorIntervalMonths: 12,
    majorIntervalMonths: 60,
    minorTasks: JSON.stringify(['Minor task A', 'Minor task B']),
    majorTasks: JSON.stringify(['Major task A', 'Major task B']),
    notes: 'Fixture notes',
    calendarExports: null,
    warrantyPeriodMonths: null,
    relatedItemIds: null,
    dueDate: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}
