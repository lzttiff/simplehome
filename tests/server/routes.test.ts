import request from 'supertest';
import express, {Express} from 'express';
import { registerRoutes } from '../../server/routes';

const provider = (process.env.PROVIDER as 'gemini' | 'openai') || 'gemini';

describe('/api/item-schedule', () => {
  let app: Express;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    await registerRoutes(app);
  });

  it('should return a schedule for a valid item', async () => {
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
    };
    const res = await request(app)
      .post('/api/item-schedule')
      .send({ item });
    expect(res.statusCode).toBe(200);
    expect(res.body.result).toHaveProperty('nextMaintenanceDates');
    expect(res.body.result.nextMaintenanceDates).toHaveProperty('minor');
    expect(res.body.result.nextMaintenanceDates).toHaveProperty('major');
  }, 50000); // Increase timeout for Gemini;
});
