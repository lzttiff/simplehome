import request from 'supertest';
import express, { Express } from 'express';

// Mock the Gemini service to avoid network calls
jest.mock('../../server/services/gemini', () => ({
  generateGeminiContent: jest.fn(async (prompt: string, key?: string) => {
    const { MOCK_GEMINI_TASK_SUGGESTION } = require('./helpers/geminiMock');
    return { ...MOCK_GEMINI_TASK_SUGGESTION, promptSummary: prompt.slice(0, 100), keyUsed: key };
  }),
}));

jest.mock('../../server/auth', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    const headerValue = req.headers?.['x-ai-enabled'];
    const aiAgentEnabled = headerValue !== 'false';
    req.user = {
      id: 'test-user-id',
      email: 'test@example.com',
      aiAgentEnabled,
      aiProvider: null,
      createdAt: new Date(),
    };
    next();
  },
  hashPassword: jest.fn(async (password: string) => `hash-${password}`),
}));

jest.mock('../../server/storage', () => ({
  storage: {
    getUserAiCredential: jest.fn().mockResolvedValue(null),
  },
}));

import { registerRoutes } from '../../server/routes';
import { generateGeminiContent } from '../../server/services/gemini';
const storageMock = require('../../server/storage').storage;

describe('/api/user/ai/generate-tasks (strict per-user key mode)', () => {
  let app: Express;

  beforeAll(async () => {
    app = express();
    app.use(express.json());
    await registerRoutes(app);
  });

  afterEach(() => {
    (generateGeminiContent as jest.Mock).mockClear();
    jest.clearAllMocks();
  });

  it('returns 400 when provider=gemini and no key provided', async () => {
    const res = await request(app)
      .post('/api/user/ai/generate-tasks')
      .send({ propertyType: 'single_family', assessment: 'All looks good', provider: 'gemini' });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/Gemini API key required/);
    expect(generateGeminiContent).not.toHaveBeenCalled();
  });

  it('accepts geminiApiKey in request body and calls Gemini service', async () => {
    const res = await request(app)
      .post('/api/user/ai/generate-tasks')
      .send({ propertyType: 'single_family', assessment: 'Needs cleaning', provider: 'gemini', geminiApiKey: 'body-key' });

    expect(res.statusCode).toBe(200);
    expect(res.body.suggestions).toBeDefined();
    expect(Array.isArray(res.body.suggestions)).toBe(true);
    // our mock returns an object, and route wraps it in an array
    expect((generateGeminiContent as jest.Mock).mock.calls.length).toBe(1);
    const calledWithKey = (generateGeminiContent as jest.Mock).mock.calls[0][1];
    expect(calledWithKey).toBe('body-key');
  });

  it('uses stored user credential when request key is not provided', async () => {
    storageMock.getUserAiCredential.mockResolvedValueOnce('stored-user-key');

    const res = await request(app)
      .post('/api/user/ai/generate-tasks')
      .send({ propertyType: 'single_family', assessment: 'Filter maintenance needed', provider: 'gemini' });

    expect(res.statusCode).toBe(200);
    expect(storageMock.getUserAiCredential).toHaveBeenCalledWith('test-user-id', 'gemini');
    expect((generateGeminiContent as jest.Mock).mock.calls.length).toBe(1);
    const calledWithKey = (generateGeminiContent as jest.Mock).mock.calls[0][1];
    expect(calledWithKey).toBe('stored-user-key');
  });

  it('returns 403 when aiAgentEnabled is false for the authenticated user', async () => {
    const res = await request(app)
      .post('/api/user/ai/generate-tasks')
      .set('x-ai-enabled', 'false')
      .send({ propertyType: 'single_family', assessment: 'Needs cleaning', provider: 'gemini', geminiApiKey: 'body-key' });

    expect(res.statusCode).toBe(403);
    expect(res.body.message).toMatch(/AI agent is disabled/);
    expect(generateGeminiContent).not.toHaveBeenCalled();
  });
});
