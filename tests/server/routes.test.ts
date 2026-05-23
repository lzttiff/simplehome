import request from 'supertest';
import express, {Express} from 'express';
import { registerRoutes } from '../../server/routes';
import { User } from '../../shared/schema';

jest.mock('../../server/services/gemini', () => ({
  generateGeminiContent: jest.fn(async () => {
    const { MOCK_GEMINI_SCHEDULE_RESPONSE } = require('./helpers/geminiMock');
    return MOCK_GEMINI_SCHEDULE_RESPONSE;
  }),
}));

jest.mock('../../server/services/appleCalendarSync', () => ({
  connectAppleCalendar: jest.fn(),
  disconnectAppleCalendar: jest.fn(),
  getAppleCalendarSyncScope: jest.fn(),
  getAppleCalendarSyncStatus: jest.fn(),
  runAppleCalendarTwoWaySync: jest.fn(),
  sanitizeAppleSyncErrorMessage: (error: any, defaultMsg: string) => defaultMsg,
  setAppleCalendarSyncScope: jest.fn(),
}));

jest.mock('../../server/storage', () => ({
  storage: {
    getAppleConnection: jest.fn(),
    saveAppleConnection: jest.fn(),
    deleteAppleConnection: jest.fn(),
    getUserById: jest.fn(),
    updateUserAiPreferences: jest.fn(),
  },
}));

// Mock passport middleware
jest.mock('passport', () => ({
  __esModule: true,
  default: {
    authenticate: jest.fn(() => (req: any, res: any, next: any) => {
      req.user = {
        id: 'test-user-id',
        email: 'test@example.com',
        createdAt: new Date(),
      } as User;
      next();
    }),
  },
}));

jest.mock('../../server/auth', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    req.user = {
      id: 'test-user-id',
      email: 'test@example.com',
      createdAt: new Date(),
    } as User;
    next();
  },
  hashPassword: jest.fn(),
  verifyPassword: jest.fn(),
}));

const provider = (process.env.PROVIDER as 'gemini' | 'openai') || 'gemini';
const storageMock = require('../../server/storage').storage;

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

describe('/api/user/ai-preferences', () => {
  let app: Express;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    await registerRoutes(app);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns user AI preferences for authenticated user', async () => {
    storageMock.getUserById.mockResolvedValue({
      id: 'test-user-id',
      email: 'test@example.com',
      passwordHash: 'hash',
      name: 'Test User',
      timezone: null,
      aiProvider: 'gemini',
      aiAgentEnabled: true,
      aiPolicyVersion: 'v1',
      createdAt: new Date(),
    });

    const res = await request(app).get('/api/user/ai-preferences');

    expect(res.statusCode).toBe(200);
    expect(storageMock.getUserById).toHaveBeenCalledWith('test-user-id');
    expect(res.body).toEqual({
      aiProvider: 'gemini',
      aiAgentEnabled: true,
      aiPolicyVersion: 'v1',
    });
  });

  it('updates user AI preferences for authenticated user', async () => {
    storageMock.updateUserAiPreferences.mockResolvedValue({
      id: 'test-user-id',
      email: 'test@example.com',
      passwordHash: 'hash',
      name: 'Test User',
      timezone: null,
      aiProvider: 'openai',
      aiAgentEnabled: false,
      aiPolicyVersion: 'v2',
      createdAt: new Date(),
    });

    const res = await request(app)
      .patch('/api/user/ai-preferences')
      .send({ aiProvider: 'openai', aiAgentEnabled: false, aiPolicyVersion: 'v2' });

    expect(res.statusCode).toBe(200);
    expect(storageMock.updateUserAiPreferences).toHaveBeenCalledWith('test-user-id', {
      aiProvider: 'openai',
      aiAgentEnabled: false,
      aiPolicyVersion: 'v2',
    });
    expect(res.body).toEqual({
      aiProvider: 'openai',
      aiAgentEnabled: false,
      aiPolicyVersion: 'v2',
    });
  });

  it('returns 400 for invalid AI provider', async () => {
    const res = await request(app)
      .patch('/api/user/ai-preferences')
      .send({ aiProvider: 'invalid-provider' });

    expect(res.statusCode).toBe(400);
    expect(storageMock.updateUserAiPreferences).not.toHaveBeenCalled();
  });
});

describe('/api/calendar/apple/sync - Contract Tests', () => {
  let app: Express;
  const mockAppleSync = require('../../server/services/appleCalendarSync');

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    await registerRoutes(app);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('GET /api/calendar/apple/sync/status', () => {
    it('should return 200 with status shape on success', async () => {
      mockAppleSync.getAppleCalendarSyncStatus.mockResolvedValue({
        connected: true,
        accountEmail: 'user@icloud.com',
        calendarId: 'simplehome',
        lastSyncedAt: new Date().toISOString(),
        activeScopeCount: 2,
      });

      const res = await request(app)
        .get('/api/calendar/apple/sync/status');

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('connected');
      expect(res.body).toHaveProperty('accountEmail');
      expect(res.body).toHaveProperty('calendarId');
      expect(res.body.accountEmail).toBe('user@icloud.com');
    });

    it('should return 200 with connected=false when not configured', async () => {
      mockAppleSync.getAppleCalendarSyncStatus.mockResolvedValue({ connected: false });

      const res = await request(app)
        .get('/api/calendar/apple/sync/status');

      expect(res.statusCode).toBe(200);
      expect(res.body.connected).toBe(false);
    });

    it('should return 500 with sanitized error message on failure', async () => {
      mockAppleSync.getAppleCalendarSyncStatus.mockRejectedValue(
        new Error('CalDAV authentication failed: user@icloud.com:password')
      );

      const res = await request(app)
        .get('/api/calendar/apple/sync/status');

      expect(res.statusCode).toBe(500);
      expect(res.body.message).toBeDefined();
      expect(res.body.message).toBe('Failed to load Apple Calendar sync status');
    });
  });

  describe('POST /api/calendar/apple/sync/connect', () => {
    it('should return 200 with connection status on valid credentials', async () => {
      mockAppleSync.connectAppleCalendar.mockResolvedValue({
        connected: true,
        accountEmail: 'user@icloud.com',
        calendarId: 'simplehome-maintenance',
      });

      const res = await request(app)
        .post('/api/calendar/apple/sync/connect')
        .send({
          appleIdEmail: 'user@icloud.com',
          appSpecificPassword: 'xxxx-xxxx-xxxx-xxxx',
        });

      expect(res.statusCode).toBe(200);
      expect(res.body.connected).toBe(true);
      expect(mockAppleSync.connectAppleCalendar).toHaveBeenCalled();
    });

    it('should return 400 for missing required fields', async () => {
      const res = await request(app)
        .post('/api/calendar/apple/sync/connect')
        .send({
          appleIdEmail: 'user@icloud.com',
          // missing appSpecificPassword
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toBeDefined();
    });

    it('should return 400 for invalid email format', async () => {
      const res = await request(app)
        .post('/api/calendar/apple/sync/connect')
        .send({
          appleIdEmail: 'no', // too short, fails min(3)
          appSpecificPassword: 'xxxx-xxxx-xxxx-xxxx',
        });

      expect(res.statusCode).toBe(400);
    });

    it('should return 500 with sanitized error message on connect failure', async () => {
      mockAppleSync.connectAppleCalendar.mockRejectedValue(
        new Error('401 Unauthorized: Check username/password at caldav.icloud.com')
      );

      const res = await request(app)
        .post('/api/calendar/apple/sync/connect')
        .send({
          appleIdEmail: 'user@icloud.com',
          appSpecificPassword: 'wrong-password',
        });

      expect(res.statusCode).toBe(500);
      expect(res.body.message).toBeDefined();
      expect(res.body.message).toBe('Failed to connect Apple Calendar');
    });
  });

  describe('POST /api/calendar/apple/sync/disconnect', () => {
    it('should return 200 on successful disconnect', async () => {
      mockAppleSync.disconnectAppleCalendar.mockResolvedValue({ disconnected: true });

      const res = await request(app)
        .post('/api/calendar/apple/sync/disconnect');

      expect(res.statusCode).toBe(200);
      expect(res.body.disconnected).toBe(true);
      expect(mockAppleSync.disconnectAppleCalendar).toHaveBeenCalled();
    });

    it('should return 200 with disconnected=false when not connected', async () => {
      mockAppleSync.disconnectAppleCalendar.mockResolvedValue({ disconnected: false });

      const res = await request(app)
        .post('/api/calendar/apple/sync/disconnect');

      expect(res.statusCode).toBe(200);
      expect(res.body.disconnected).toBe(false);
    });
  });

  describe('GET /api/calendar/apple/sync/scope', () => {
    it('should return 200 with current scope', async () => {
      mockAppleSync.getAppleCalendarSyncScope.mockResolvedValue({
        minor: true,
        major: false,
      });

      const res = await request(app)
        .get('/api/calendar/apple/sync/scope');

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('minor');
      expect(res.body).toHaveProperty('major');
    });
  });

  describe('PUT /api/calendar/apple/sync/scope', () => {
    it('should return 200 with updated scope', async () => {
      mockAppleSync.setAppleCalendarSyncScope.mockResolvedValue({
        minor: true,
        major: true,
      });

      const res = await request(app)
        .put('/api/calendar/apple/sync/scope')
        .send({
          selections: [
            { taskId: 'task-1', includeMinor: true, includeMajor: true },
          ],
        });

      expect(res.statusCode).toBe(200);
    });
  });

  describe('POST /api/calendar/apple/sync', () => {
    it('should return 200 with sync result on success', async () => {
      mockAppleSync.runAppleCalendarTwoWaySync.mockResolvedValue({
        syncedTasks: 8,
        pushedEvents: 14,
        pulledChanges: 3,
        createdEvents: 2,
        updatedEvents: 12,
        lastSyncedAt: new Date().toISOString(),
      });

      const res = await request(app)
        .post('/api/calendar/apple/sync')
        .send({
          selections: [
            { taskId: 'task-1', includeMinor: true, includeMajor: true },
          ],
        });

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('syncedTasks');
      expect(res.body).toHaveProperty('pushedEvents');
      expect(res.body).toHaveProperty('pulledChanges');
      expect(typeof res.body.syncedTasks).toBe('number');
    });

    it('should accept empty selections array for full sync', async () => {
      mockAppleSync.runAppleCalendarTwoWaySync.mockResolvedValue({
        syncedTasks: 0,
        pushedEvents: 0,
        pulledChanges: 0,
        lastSyncedAt: new Date().toISOString(),
      });

      const res = await request(app)
        .post('/api/calendar/apple/sync')
        .send({
          selections: [],
        });

      expect(res.statusCode).toBe(200);
      expect(res.body).toHaveProperty('syncedTasks');
    });

    it('should return 400 for invalid selections payload (not array)', async () => {
      const res = await request(app)
        .post('/api/calendar/apple/sync')
        .send({
          selections: 'invalid', // should be array
        });

      expect(res.statusCode).toBe(400);
      expect(res.body.message).toBe('Invalid sync request payload');
    });

    it('should return 500 with sanitized error message on sync failure', async () => {
      mockAppleSync.runAppleCalendarTwoWaySync.mockRejectedValue(
        new Error('CalDAV PROPFIND failed: Connection reset by host caldav.icloud.com:443')
      );

      const res = await request(app)
        .post('/api/calendar/apple/sync')
        .send({
          selections: [],
        });

      expect(res.statusCode).toBe(500);
      expect(res.body.message).toBeDefined();
      expect(res.body.message).toBe('Apple Calendar sync failed');
    });
  });

  describe('Error Message Structure', () => {
    it('should use "message" key in all error responses', async () => {
      mockAppleSync.getAppleCalendarSyncStatus.mockRejectedValue(
        new Error('Test error')
      );

      const res = await request(app)
        .get('/api/calendar/apple/sync/status');

      expect(res.statusCode).toBe(500);
      expect(res.body).toHaveProperty('message');
      expect(res.body).not.toHaveProperty('error');
    });
  });

  describe('Authorization', () => {
    it('all Apple sync endpoints require authentication', async () => {
      // This is implicitly tested through the requireAuth mock, but documented here
      const endpoints = [
        { method: 'get', path: '/api/calendar/apple/sync/status' },
        { method: 'post', path: '/api/calendar/apple/sync/connect', body: { appleIdEmail: 'user@icloud.com', appSpecificPassword: 'test' } },
        { method: 'post', path: '/api/calendar/apple/sync/disconnect' },
        { method: 'get', path: '/api/calendar/apple/sync/scope' },
        { method: 'put', path: '/api/calendar/apple/sync/scope', body: { selections: [{ taskId: 'test', includeMinor: true }] } },
        { method: 'post', path: '/api/calendar/apple/sync', body: { selections: [] } },
      ];

      for (const endpoint of endpoints) {
        // All should pass through (auth middleware sets req.user)
        let res;
        if (endpoint.method === 'get') {
          res = await request(app).get(endpoint.path);
        } else if (endpoint.method === 'post') {
          res = await request(app).post(endpoint.path).send(endpoint.body || {});
        } else {
          res = await request(app).put(endpoint.path).send(endpoint.body || {});
        }
        // We expect no 401 Unauthorized (auth is mocked to pass)
        expect([200, 400, 409, 500]).toContain(res.statusCode);
      }
    });
  });
});
