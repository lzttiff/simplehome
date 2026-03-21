import request from 'supertest';
import express from 'express';
import { registerRoutes } from '../../server/routes';

// Mock the AI service
jest.mock('../../server/services/maintenanceAi', () => ({
  generateMaintenanceSchedule: jest.fn().mockResolvedValue({
    name: 'Test Item',
    nextMaintenanceDates: {
      minor: '2026-03-01T00:00:00.000Z',
      major: '2027-01-01T00:00:00.000Z',
    },
    maintenanceSchedule: {
      minorIntervalMonths: '12',
      majorIntervalMonths: '60',
      minorTasks: ['Task 1', 'Task 2', 'Task 3'],
      majorTasks: ['Major 1', 'Major 2', 'Major 3'],
    },
    reasoning: 'Test reasoning',
  }),
  generateCategoryMaintenanceSchedules: jest.fn().mockResolvedValue([
    {
      name: 'Test Item 1',
      nextMaintenanceDates: {
        minor: '2026-03-01T00:00:00.000Z',
        major: '2027-01-01T00:00:00.000Z',
      },
      maintenanceSchedule: {
        minorIntervalMonths: '12',
        majorIntervalMonths: '60',
        minorTasks: ['Task 1', 'Task 2'],
        majorTasks: ['Major 1', 'Major 2'],
      },
      reasoning: 'Test reasoning',
    },
  ]),
  getDiagnostics: jest.fn().mockReturnValue([]),
  clearDiagnostics: jest.fn(),
}));

// Mock the storage module
jest.mock('../../server/storage', () => {
  const mockUpdateMaintenanceTask = jest.fn().mockResolvedValue({ id: 1 });
  return {
    storage: {
      getMaintenanceTasks: jest.fn().mockResolvedValue([]),
      updateMaintenanceTask: mockUpdateMaintenanceTask,
      getPropertyTemplates: jest.fn().mockResolvedValue([]),
      getPropertyTemplate: jest.fn().mockResolvedValue(null),
    },
  };
});

// Mock logWithLevel
jest.mock('../../server/services/logWithLevel', () => ({
  logWithLevel: jest.fn(),
}));

describe('AI Provider Route Tests', () => {
  let app: express.Express;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    registerRoutes(app as any);

    // Reset environment variables
    delete process.env.DEFAULT_AI_PROVIDER;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/item-schedule', () => {
    it('should use DEFAULT_AI_PROVIDER from environment when no provider is specified', async () => {
      process.env.DEFAULT_AI_PROVIDER = 'openai';
      const { generateMaintenanceSchedule } = await import('../../server/services/maintenanceAi');

      const response = await request(app)
        .post('/api/item-schedule')
        .send({
          item: {
            id: 'test-1',
            name: 'Test Item',
            brand: 'TestBrand',
            model: 'Model123',
            location: 'Kitchen',
            installationDate: '2020-01-01',
          },
        });

      expect(response.status).toBe(200);
      expect(generateMaintenanceSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'Test Item',
          provider: 'openai',
        })
      );
    });

    it('should use provider from request body when specified', async () => {
      process.env.DEFAULT_AI_PROVIDER = 'gemini';
      const { generateMaintenanceSchedule } = await import('../../server/services/maintenanceAi');

      const response = await request(app)
        .post('/api/item-schedule')
        .send({
          provider: 'openai',
          item: {
            id: 'test-1',
            name: 'Test Item',
            location: 'Kitchen',
          },
        });

      expect(response.status).toBe(200);
      expect(generateMaintenanceSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai',
        })
      );
    });

    it('should use provider from item field when specified', async () => {
      const { generateMaintenanceSchedule } = await import('../../server/services/maintenanceAi');

      const response = await request(app)
        .post('/api/item-schedule')
        .send({
          item: {
            id: 'test-1',
            name: 'Test Item',
            provider: 'gemini',
            location: 'Kitchen',
          },
        });

      expect(response.status).toBe(200);
      expect(generateMaintenanceSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'gemini',
        })
      );
    });

    it('should fallback to gemini when no provider is configured', async () => {
      const { generateMaintenanceSchedule } = await import('../../server/services/maintenanceAi');

      const response = await request(app)
        .post('/api/item-schedule')
        .send({
          item: {
            id: 'test-1',
            name: 'Test Item',
            location: 'Kitchen',
          },
        });

      expect(response.status).toBe(200);
      expect(generateMaintenanceSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'gemini',
        })
      );
    });

    it('should prioritize request body provider over environment variable', async () => {
      process.env.DEFAULT_AI_PROVIDER = 'gemini';
      const { generateMaintenanceSchedule } = await import('../../server/services/maintenanceAi');

      const response = await request(app)
        .post('/api/item-schedule')
        .send({
          provider: 'openai',
          item: {
            id: 'test-1',
            name: 'Test Item',
            location: 'Kitchen',
          },
        });

      expect(response.status).toBe(200);
      expect(generateMaintenanceSchedule).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: 'openai',
        })
      );
    });

    it('should return 400 when no item is provided', async () => {
      const response = await request(app)
        .post('/api/item-schedule')
        .send({});

      expect(response.status).toBe(400);
      expect(response.body.message).toContain('No item provided');
    });

    it('should handle validation errors from AI service', async () => {
      const { generateMaintenanceSchedule } = await import('../../server/services/maintenanceAi');
      (generateMaintenanceSchedule as jest.Mock).mockResolvedValueOnce({
        error: 'Validation failed',
        validationErrors: [{ field: 'minorTasks', message: 'Required' }],
      });

      const response = await request(app)
        .post('/api/item-schedule')
        .send({
          item: {
            id: 'test-1',
            name: 'Test Item',
            location: 'Kitchen',
          },
        });

      expect(response.status).toBe(500);
      expect(response.body.message).toContain('AI service validation failed');
      expect(response.body.details.error).toBe('Validation failed');
    });
  });

  describe('POST /api/category-schedule', () => {
    it('should use DEFAULT_AI_PROVIDER from environment when no provider is specified', async () => {
      process.env.DEFAULT_AI_PROVIDER = 'openai';
      const { generateCategoryMaintenanceSchedules } = await import('../../server/services/maintenanceAi');

      const response = await request(app)
        .post('/api/category-schedule')
        .send({
          householdCatalog: [
            {
              categoryName: 'Test Category',
              items: [
                {
                  id: 'test-1',
                  name: 'Test Item 1',
                  location: 'Kitchen',
                },
              ],
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(generateCategoryMaintenanceSchedules).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            name: 'Test Item 1',
            provider: 'openai',
          }),
        ])
      );
    });

    it('should use provider from request body when specified', async () => {
      process.env.DEFAULT_AI_PROVIDER = 'gemini';
      const { generateCategoryMaintenanceSchedules } = await import('../../server/services/maintenanceAi');

      const response = await request(app)
        .post('/api/category-schedule')
        .send({
          provider: 'openai',
          householdCatalog: [
            {
              categoryName: 'Test Category',
              items: [
                {
                  id: 'test-1',
                  name: 'Test Item 1',
                  location: 'Kitchen',
                },
              ],
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(generateCategoryMaintenanceSchedules).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            provider: 'openai',
          }),
        ])
      );
    });

    it('should apply provider to all items in the category', async () => {
      process.env.DEFAULT_AI_PROVIDER = 'openai';
      const { generateCategoryMaintenanceSchedules } = await import('../../server/services/maintenanceAi');

      const response = await request(app)
        .post('/api/category-schedule')
        .send({
          householdCatalog: [
            {
              categoryName: 'Test Category',
              items: [
                { id: 'test-1', name: 'Item 1', location: 'Kitchen' },
                { id: 'test-2', name: 'Item 2', location: 'Bathroom' },
                { id: 'test-3', name: 'Item 3', location: 'Bedroom' },
              ],
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(generateCategoryMaintenanceSchedules).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ name: 'Item 1', provider: 'openai' }),
          expect.objectContaining({ name: 'Item 2', provider: 'openai' }),
          expect.objectContaining({ name: 'Item 3', provider: 'openai' }),
        ])
      );
    });

    it('should fallback to gemini when no provider is configured', async () => {
      const { generateCategoryMaintenanceSchedules } = await import('../../server/services/maintenanceAi');

      const response = await request(app)
        .post('/api/category-schedule')
        .send({
          householdCatalog: [
            {
              categoryName: 'Test Category',
              items: [{ id: 'test-1', name: 'Test Item', location: 'Kitchen' }],
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(generateCategoryMaintenanceSchedules).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            provider: 'gemini',
          }),
        ])
      );
    });

    it('should load default template when no catalog is provided', async () => {
      // This test verifies the fallback to maintenance-template-singleFamilyHome.json
      const response = await request(app)
        .post('/api/category-schedule')
        .send({});

      // Should not fail even without provided catalog
      // Response will depend on whether default template exists
      expect([200, 404]).toContain(response.status);
    });

    it('should update tasks with AI results', async () => {
      const storage = await import('../../server/storage');

      const response = await request(app)
        .post('/api/category-schedule')
        .send({
          householdCatalog: [
            {
              categoryName: 'Test Category',
              items: [
                {
                  id: 'test-1',
                  name: 'Test Item',
                  location: 'Kitchen',
                },
              ],
            },
          ],
        });

      expect(response.status).toBe(200);
      expect(storage.storage.updateMaintenanceTask).toHaveBeenCalledWith(
        'test-1',
        expect.objectContaining({
          nextMaintenanceDate: expect.any(String),
          minorIntervalMonths: expect.any(Number),
          majorIntervalMonths: expect.any(Number),
          minorTasks: expect.any(String),
          majorTasks: expect.any(String),
        }),
        null,
      );
    });

    it('should skip updating tasks with errors', async () => {
      const { generateCategoryMaintenanceSchedules } = await import('../../server/services/maintenanceAi');
      const storage = await import('../../server/storage');
      
      // Mock one successful and one failed result
      (generateCategoryMaintenanceSchedules as jest.Mock).mockResolvedValueOnce([
        {
          name: 'Test Item 1',
          nextMaintenanceDates: { minor: '2026-03-01', major: '2027-01-01' },
          maintenanceSchedule: {
            minorIntervalMonths: '12',
            majorIntervalMonths: '60',
            minorTasks: ['Task 1'],
            majorTasks: ['Major 1'],
          },
          reasoning: 'OK',
        },
        {
          error: 'Validation failed',
        },
      ]);

      const response = await request(app)
        .post('/api/category-schedule')
        .send({
          householdCatalog: [
            {
              categoryName: 'Test Category',
              items: [
                { id: 'test-1', name: 'Test Item 1', location: 'Kitchen' },
                { id: 'test-2', name: 'Test Item 2', location: 'Bathroom' },
              ],
            },
          ],
        });

      expect(response.status).toBe(200);
      // Should only update the successful one
      expect(storage.storage.updateMaintenanceTask).toHaveBeenCalledTimes(1);
      expect(storage.storage.updateMaintenanceTask).toHaveBeenCalledWith('test-1', expect.any(Object), null);
    });
  });

  describe('Provider Priority Order', () => {
    it('should follow correct priority: request body > item field > env > fallback', async () => {
      const testCases = [
        {
          name: 'Request body provider takes priority',
          env: 'gemini',
          requestBody: { provider: 'openai' },
          item: { provider: 'gemini' },
          expected: 'openai',
        },
        {
          name: 'Item provider used when no request body provider',
          env: 'gemini',
          requestBody: {},
          item: { provider: 'openai' },
          expected: 'openai',
        },
        {
          name: 'Environment provider used when no request or item provider',
          env: 'openai',
          requestBody: {},
          item: {},
          expected: 'openai',
        },
        {
          name: 'Fallback to gemini when nothing configured',
          env: undefined,
          requestBody: {},
          item: {},
          expected: 'gemini',
        },
      ];

      for (const testCase of testCases) {
        if (testCase.env) {
          process.env.DEFAULT_AI_PROVIDER = testCase.env;
        } else {
          delete process.env.DEFAULT_AI_PROVIDER;
        }

        const { generateMaintenanceSchedule } = await import('../../server/services/maintenanceAi');
        (generateMaintenanceSchedule as jest.Mock).mockClear();

        await request(app)
          .post('/api/item-schedule')
          .send({
            ...testCase.requestBody,
            item: {
              id: 'test-1',
              name: 'Test Item',
              location: 'Kitchen',
              ...testCase.item,
            },
          });

        expect(generateMaintenanceSchedule).toHaveBeenCalledWith(
          expect.objectContaining({
            provider: testCase.expected,
          })
        );
      }
    });
  });
});
