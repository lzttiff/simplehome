import request from 'supertest';
import express, {Express} from 'express';
import { registerRoutes } from './routes';

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
      provider: 'openai',
    };
    const res = await request(app)
      .post('/api/item-schedule')
      .send({ item });
    expect(res.statusCode).toBe(200);
    expect(res.body.result).toHaveProperty('nextMinorServiceDate');
    expect(res.body.result).toHaveProperty('nextMajorServiceDate');
  });
});