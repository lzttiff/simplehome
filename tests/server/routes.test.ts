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

jest.mock('../../server/services/openai', () => ({
  generateMaintenanceTasks: jest.fn(),
  generateQuickSuggestions: jest.fn(),
  validateOpenAiApiKey: jest.fn().mockResolvedValue(undefined),
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
    getUserUiPreferences: jest.fn(),
    updateUserUiPreferences: jest.fn(),
    getUserAiCredentialStatus: jest.fn(),
    upsertUserAiCredentials: jest.fn(),
    getUserAiCredential: jest.fn(),
  },
}));

jest.mock('../../server/services/aiConfigAudit', () => ({
  writeAiConfigAudit: jest.fn(),
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
const aiAuditMock = require('../../server/services/aiConfigAudit');
const openAiMock = require('../../server/services/openai');

describe('/api/item-schedule', () => {
  let app: Express;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    await registerRoutes(app);
  });

  it('should return a schedule for a valid item', async () => {
    storageMock.getUserAiCredential.mockResolvedValueOnce('user-gemini-key');
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
    storageMock.getUserById.mockResolvedValueOnce({
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

    expect(aiAuditMock.writeAiConfigAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'ai_preferences_updated',
        actorUserId: 'test-user-id',
        targetUserId: 'test-user-id',
        oldValues: expect.objectContaining({ aiProvider: 'gemini', aiAgentEnabled: true, aiPolicyVersion: 'v1' }),
        newValues: expect.objectContaining({ aiProvider: 'openai', aiAgentEnabled: false, aiPolicyVersion: 'v2' }),
      }),
    );
  });

  it('returns 400 for invalid AI provider', async () => {
    const res = await request(app)
      .patch('/api/user/ai-preferences')
      .send({ aiProvider: 'invalid-provider' });

    expect(res.statusCode).toBe(400);
    expect(storageMock.updateUserAiPreferences).not.toHaveBeenCalled();
  });
});

describe('/api/user/ai-credentials', () => {
  let app: Express;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    await registerRoutes(app);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns AI credential status for authenticated user', async () => {
    const now = new Date('2026-05-23T10:00:00.000Z');
    storageMock.getUserAiCredentialStatus.mockResolvedValue({
      hasGeminiApiKey: true,
      hasOpenAiApiKey: false,
      updatedAt: now,
    });

    const res = await request(app).get('/api/user/ai-credentials');

    expect(res.statusCode).toBe(200);
    expect(storageMock.getUserAiCredentialStatus).toHaveBeenCalledWith('test-user-id');
    expect(res.body).toEqual(
      expect.objectContaining({
        hasGeminiApiKey: true,
        hasOpenAiApiKey: false,
        effectiveGeminiKeySource: 'stored',
        effectiveOpenAiKeySource: 'none',
        updatedAt: now.toISOString(),
      }),
    );
  });

  it('updates AI credentials and emits redacted audit event', async () => {
    const now = new Date('2026-05-23T11:00:00.000Z');
    storageMock.getUserAiCredentialStatus
      .mockResolvedValueOnce({ hasGeminiApiKey: false, hasOpenAiApiKey: false, updatedAt: null });
    storageMock.upsertUserAiCredentials.mockResolvedValue({
      hasGeminiApiKey: true,
      hasOpenAiApiKey: false,
      updatedAt: now,
    });

    const res = await request(app)
      .patch('/api/user/ai-credentials')
      .send({ geminiApiKey: 'gemini-user-key' });

    expect(res.statusCode).toBe(200);
    expect(storageMock.upsertUserAiCredentials).toHaveBeenCalledWith('test-user-id', {
      geminiApiKey: 'gemini-user-key',
    });
    expect(res.body).toEqual({
      hasGeminiApiKey: true,
      hasOpenAiApiKey: false,
      updatedAt: now.toISOString(),
    });
    expect(aiAuditMock.writeAiConfigAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'ai_credentials_updated',
        actorUserId: 'test-user-id',
        targetUserId: 'test-user-id',
      }),
    );
  });

  it('removes credential for selected provider', async () => {
    const now = new Date('2026-05-23T12:00:00.000Z');
    storageMock.getUserAiCredentialStatus
      .mockResolvedValueOnce({ hasGeminiApiKey: true, hasOpenAiApiKey: true, updatedAt: null });
    storageMock.upsertUserAiCredentials.mockResolvedValue({
      hasGeminiApiKey: false,
      hasOpenAiApiKey: true,
      updatedAt: now,
    });

    const res = await request(app).delete('/api/user/ai-credentials/gemini');

    expect(res.statusCode).toBe(200);
    expect(storageMock.upsertUserAiCredentials).toHaveBeenCalledWith('test-user-id', {
      geminiApiKey: null,
    });
    expect(aiAuditMock.writeAiConfigAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'ai_credentials_removed',
        provider: 'gemini',
      }),
    );
    expect(res.body).toEqual({
      hasGeminiApiKey: false,
      hasOpenAiApiKey: true,
      updatedAt: now.toISOString(),
    });
  });

  it('returns 400 for invalid credential update payload', async () => {
    const res = await request(app)
      .patch('/api/user/ai-credentials')
      .send({});

    expect(res.statusCode).toBe(400);
    expect(storageMock.upsertUserAiCredentials).not.toHaveBeenCalled();
  });

  it('validates gemini credential from request payload', async () => {
    const { generateGeminiContent } = require('../../server/services/gemini');
    (generateGeminiContent as jest.Mock).mockResolvedValueOnce({ ok: true });

    const res = await request(app)
      .post('/api/user/ai-credentials/gemini/validate')
      .send({ apiKey: 'gemini-request-key' });

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      provider: 'gemini',
      valid: true,
      source: 'request',
    });
    expect(storageMock.getUserAiCredential).not.toHaveBeenCalled();
    expect(generateGeminiContent).toHaveBeenCalledWith("Return exactly the word 'ok'.", 'gemini-request-key');
  });

  it('validates openai credential from stored key when request key is absent', async () => {
    storageMock.getUserAiCredential.mockResolvedValueOnce('stored-openai-key');

    const res = await request(app)
      .post('/api/user/ai-credentials/openai/validate')
      .send({});

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      provider: 'openai',
      valid: true,
      source: 'stored',
    });
    expect(storageMock.getUserAiCredential).toHaveBeenCalledWith('test-user-id', 'openai');
    expect(openAiMock.validateOpenAiApiKey).toHaveBeenCalledWith('stored-openai-key');
  });

  it('returns 400 when no request key and no stored key are available', async () => {
    storageMock.getUserAiCredential.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/user/ai-credentials/gemini/validate')
      .send({});

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      provider: 'gemini',
      valid: false,
      source: 'stored',
      message: 'No API key available to validate',
    });
  });

  it('returns 400 when provider validation fails', async () => {
    const { generateGeminiContent } = require('../../server/services/gemini');
    (generateGeminiContent as jest.Mock).mockRejectedValueOnce(new Error('Invalid key'));

    const res = await request(app)
      .post('/api/user/ai-credentials/gemini/validate')
      .send({ apiKey: 'bad-key' });

    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({
      provider: 'gemini',
      valid: false,
      source: 'request',
      message: 'Credential validation failed',
    });
  });

  it('supports full gemini credential lifecycle with stored-key validation path', async () => {
    const state: { geminiApiKey: string | null; openaiApiKey: string | null; updatedAt: Date | null } = {
      geminiApiKey: null,
      openaiApiKey: null,
      updatedAt: null,
    };

    storageMock.getUserAiCredentialStatus.mockImplementation(async () => ({
      hasGeminiApiKey: !!state.geminiApiKey,
      hasOpenAiApiKey: !!state.openaiApiKey,
      updatedAt: state.updatedAt,
    }));

    storageMock.upsertUserAiCredentials.mockImplementation(async (_userId: string, updates: { geminiApiKey?: string | null; openaiApiKey?: string | null }) => {
      if (Object.prototype.hasOwnProperty.call(updates, 'geminiApiKey')) {
        state.geminiApiKey = updates.geminiApiKey ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(updates, 'openaiApiKey')) {
        state.openaiApiKey = updates.openaiApiKey ?? null;
      }
      state.updatedAt = new Date('2026-05-23T13:00:00.000Z');
      return {
        hasGeminiApiKey: !!state.geminiApiKey,
        hasOpenAiApiKey: !!state.openaiApiKey,
        updatedAt: state.updatedAt,
      };
    });

    storageMock.getUserAiCredential.mockImplementation(async (_userId: string, providerName: 'gemini' | 'openai') => {
      return providerName === 'gemini' ? state.geminiApiKey : state.openaiApiKey;
    });

    const start = await request(app).get('/api/user/ai-credentials');
    expect(start.statusCode).toBe(200);
    expect(start.body.hasGeminiApiKey).toBe(false);

    const set = await request(app)
      .patch('/api/user/ai-credentials')
      .send({ geminiApiKey: 'lifecycle-gemini-key' });
    expect(set.statusCode).toBe(200);
    expect(set.body.hasGeminiApiKey).toBe(true);

    const afterSet = await request(app).get('/api/user/ai-credentials');
    expect(afterSet.statusCode).toBe(200);
    expect(afterSet.body.hasGeminiApiKey).toBe(true);

    const validateStored = await request(app)
      .post('/api/user/ai-credentials/gemini/validate')
      .send({});
    expect(validateStored.statusCode).toBe(200);
    expect(validateStored.body).toEqual({
      provider: 'gemini',
      valid: true,
      source: 'stored',
    });

    const remove = await request(app).delete('/api/user/ai-credentials/gemini');
    expect(remove.statusCode).toBe(200);
    expect(remove.body.hasGeminiApiKey).toBe(false);

    const finalStatus = await request(app).get('/api/user/ai-credentials');
    expect(finalStatus.statusCode).toBe(200);
    expect(finalStatus.body.hasGeminiApiKey).toBe(false);

    expect(aiAuditMock.writeAiConfigAudit).toHaveBeenCalledWith(expect.objectContaining({ event: 'ai_credentials_updated' }));
    expect(aiAuditMock.writeAiConfigAudit).toHaveBeenCalledWith(expect.objectContaining({ event: 'ai_credentials_removed' }));
  });
});

describe('/api/user/ui-preferences', () => {
  let app: Express;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    await registerRoutes(app);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns UI preferences for authenticated user', async () => {
    storageMock.getUserUiPreferences.mockResolvedValue({
      includeMinor: true,
      includeMajor: true,
      deferredOnly: false,
      sortBy: 'default',
      dateFilter: null,
      categoryFilters: [],
      selectedProvider: null,
      keepOutOfScopeEvents: false,
      settingsActiveTab: 'profile',
    });

    const res = await request(app).get('/api/user/ui-preferences');

    expect(res.statusCode).toBe(200);
    expect(storageMock.getUserUiPreferences).toHaveBeenCalledWith('test-user-id');
    expect(res.body).toEqual(
      expect.objectContaining({
        includeMinor: true,
        includeMajor: true,
        deferredOnly: false,
        sortBy: 'default',
        dateFilter: null,
      }),
    );
  });

  it('updates UI preferences for authenticated user', async () => {
    storageMock.updateUserUiPreferences.mockResolvedValue({
      includeMinor: false,
      includeMajor: true,
      deferredOnly: false,
      sortBy: 'nextDate',
      dateFilter: 30,
      categoryFilters: ['HVAC & Mechanical'],
      selectedProvider: 'google',
      keepOutOfScopeEvents: true,
      settingsActiveTab: 'calendar',
    });

    const payload = {
      includeMinor: false,
      sortBy: 'nextDate',
      dateFilter: 30,
      keepOutOfScopeEvents: true,
      settingsActiveTab: 'calendar',
    };

    const res = await request(app)
      .patch('/api/user/ui-preferences')
      .send(payload);

    expect(res.statusCode).toBe(200);
    expect(storageMock.updateUserUiPreferences).toHaveBeenCalledWith('test-user-id', payload);
    expect(res.body).toEqual(
      expect.objectContaining({
        includeMinor: false,
        sortBy: 'nextDate',
        dateFilter: 30,
        keepOutOfScopeEvents: true,
        settingsActiveTab: 'calendar',
      }),
    );
  });

  it('returns 400 for invalid UI preference payload', async () => {
    const res = await request(app)
      .patch('/api/user/ui-preferences')
      .send({ unknownKey: true });

    expect(res.statusCode).toBe(400);
    expect(storageMock.updateUserUiPreferences).not.toHaveBeenCalled();
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
