import request from 'supertest';
import express, { Express } from 'express';
import fs from 'fs';
import path from 'path';

// Mock the Gemini service to avoid network calls
jest.mock('../../server/services/gemini', () => ({
  generateGeminiContent: jest.fn(async (prompt: string, key?: string) => {
    return { title: 'Mocked Gemini Response', promptSummary: prompt.slice(0, 100), keyUsed: key };
  }),
}));

import { registerRoutes } from '../../server/routes';
import { generateGeminiContent } from '../../server/services/gemini';

describe('/api/ai/generate-tasks (Gemini key support)', () => {
  let app: Express;

  beforeAll(async () => {
    // Ensure no GEMINI_API_KEY is set and no local gemini.key file exists for the negative test
    delete process.env.GEMINI_API_KEY;
    try {
      const fk = path.resolve(process.cwd(), 'gemini.key');
      if (fs.existsSync(fk)) fs.unlinkSync(fk);
    } catch (e) {
      // ignore
    }

    app = express();
    app.use(express.json());
    await registerRoutes(app);
  });

  afterEach(() => {
    // ensure env var doesn't leak between tests
    delete process.env.GEMINI_API_KEY;
    (generateGeminiContent as jest.Mock).mockClear();
  });

  it('returns 400 when provider=gemini and no key provided', async () => {
    const res = await request(app)
      .post('/api/ai/generate-tasks')
      .send({ propertyType: 'single_family', assessment: 'All looks good', provider: 'gemini' });

    expect(res.statusCode).toBe(400);
    expect(res.body.message).toMatch(/Gemini API key required/);
    expect(generateGeminiContent).not.toHaveBeenCalled();
  });

  it('accepts geminiApiKey in request body and calls Gemini service', async () => {
    const res = await request(app)
      .post('/api/ai/generate-tasks')
      .send({ propertyType: 'single_family', assessment: 'Needs cleaning', provider: 'gemini', geminiApiKey: 'body-key' });

    expect(res.statusCode).toBe(200);
    expect(res.body.suggestions).toBeDefined();
    expect(Array.isArray(res.body.suggestions)).toBe(true);
    // our mock returns an object, and route wraps it in an array
    expect((generateGeminiContent as jest.Mock).mock.calls.length).toBe(1);
    const calledWithKey = (generateGeminiContent as jest.Mock).mock.calls[0][1];
    expect(calledWithKey).toBe('body-key');
  });

  it('uses GEMINI_API_KEY env var when body key not provided', async () => {
    process.env.GEMINI_API_KEY = 'env-key';
    const res = await request(app)
      .post('/api/ai/generate-tasks')
      .send({ propertyType: 'condo', assessment: 'Some issues', provider: 'gemini' });

    expect(res.statusCode).toBe(200);
    expect((generateGeminiContent as jest.Mock).mock.calls.length).toBe(1);
    const calledWithKey = (generateGeminiContent as jest.Mock).mock.calls[0][1];
    expect(calledWithKey).toBe('env-key');
  });
});
