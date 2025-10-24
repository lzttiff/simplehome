import { generateMaintenanceSchedule, normalizeToMaintenanceAiResult } from '../../server/services/maintenanceAi';

const provider = (process.env.PROVIDER as 'gemini' | 'openai') || 'gemini';

describe('normalizeToMaintenanceAiResult', () => {
  const oneWeek = new Date();
  oneWeek.setDate(oneWeek.getDate() + 7);

  test('happy path: already correct shape', () => {
    const raw = {
      name: 'Boiler',
      nextMaintenanceDates: { minor: new Date().toISOString(), major: new Date(Date.now() + 1000 * 60 * 60 * 24 * 400).toISOString() },
      maintenanceSchedule: { minorIntervalMonths: '12', minorTasks: ['Inspect'], majorIntervalMonths: '60', majorTasks: ['Overhaul'] },
      reasoning: 'Because.'
    };
    const out = normalizeToMaintenanceAiResult(raw, 'Boiler', oneWeek);
    expect(out.name).toBe('Boiler');
    expect(Array.isArray(out.maintenanceSchedule.minorTasks)).toBe(true);
    expect(out.maintenanceSchedule.minorIntervalMonths).toBe('12');
  });

  test('accepts string task lists and interval words', () => {
    const raw = {
      name: 'Pump',
      nextMaintenanceDates: { minor: '2020-01-01T00:00:00.000Z', major: '2020-01-01T00:00:00.000Z' },
      maintenanceSchedule: { minorIntervalMonths: 'Annually', minorTasks: 'Inspect; Clean', majorIntervalMonths: '5 years', majorTasks: 'Overhaul' },
      reasoning: 'Legacy'
    };
    const out = normalizeToMaintenanceAiResult(raw, 'Pump', oneWeek);
    expect(out.maintenanceSchedule.minorTasks.length).toBeGreaterThan(0);
    expect(out.maintenanceSchedule.minorIntervalMonths).toBe('12');
    expect(out.nextMaintenanceDates.minor).toBe(oneWeek.toISOString());
  });
});

describe('generateMaintenanceSchedule integration', () => {
  it(`should return valid schedule for a sample item (provider: ${provider})`, async () => {
    const item = {
      id: '1',
      name: 'HVAC',
      brand: 'Carrier',
      model: 'Infinity',
      installationDate: '2022-01-01',
      lastMinorServiceDate: '2023-01-01',
      lastMajorServiceDate: '2023-06-01',
      location: 'Basement',
      maintenanceSchedule: { minor: 'Annual', major: 'Biannual' },
      provider: provider as 'gemini' | 'openai',
    } as any;
    const result = await generateMaintenanceSchedule(item);
    // New shape: nextMaintenanceDates
    expect(result).toHaveProperty('nextMaintenanceDates');
    expect(result).toHaveProperty('maintenanceSchedule');
    expect(result).toHaveProperty('reasoning');
  }, 50000);
});
