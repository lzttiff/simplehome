import { generateMaintenanceSchedule } from './maintenanceAi';

describe('generateMaintenanceSchedule', () => {
  it('should return valid schedule for a sample item', async () => {
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
      provider: 'openai',
    };
    const result = await generateMaintenanceSchedule(item);
    expect(result).toHaveProperty('nextMinorServiceDate');
    expect(result).toHaveProperty('nextMajorServiceDate');
    expect(result).toHaveProperty('reasoning');
  });
});