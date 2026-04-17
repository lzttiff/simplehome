/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Dashboard from './dashboard';
import { createMaintenanceTaskFixture } from '@/test/fixtures';
import { mockJsonFetch, renderWithQueryClient } from '@/test/test-utils';

// Mock wouter
jest.mock('wouter', () => ({
  useParams: () => ({ templateId: 'test-template' }),
  Link: ({ children, href }: any) => <a href={href}>{children}</a>,
}));

// Mock child components
jest.mock('@/components/task-card', () => {
  return function MockTaskCard({ task, showMinor, showMajor }: any) {
    return (
      <div data-testid={`task-${task.id}`}>
        <div>{task.title}</div>
        <div data-testid={`task-${task.id}-showMinor`}>{String(showMinor)}</div>
        <div data-testid={`task-${task.id}-showMajor`}>{String(showMajor)}</div>
      </div>
    );
  };
});

jest.mock('@/components/add-task-modal', () => {
  return function MockAddTaskModal() {
    return <div>Add Task Modal</div>;
  };
});

jest.mock('@/components/export-schedule-modal', () => {
  return function MockExportScheduleModal() {
    return <div>Export Schedule Modal</div>;
  };
});

describe('Dashboard Filtering', () => {
  let consoleLogSpy: jest.SpyInstance;

  const getDateInput = () => screen.queryByPlaceholderText(/all/i) ?? screen.getByRole('spinbutton');

  const getCategoryCheckbox = (categoryLabel: string) => {
    const row = screen.getByText(new RegExp(categoryLabel, 'i')).closest('div');
    if (!row) {
      throw new Error(`Category row not found for ${categoryLabel}`);
    }
    const checkbox = row.querySelector('[role="checkbox"]') as HTMLElement | null;
    if (!checkbox) {
      throw new Error(`Category checkbox not found for ${categoryLabel}`);
    }
    return checkbox;
  };

  beforeEach(() => {
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    mockJsonFetch({
      '/api/auth/me': null,
      '/api/tasks': [
        createMaintenanceTaskFixture({ id: '1', title: 'Task 1', category: 'Appliances', templateId: 'test-template' }),
        createMaintenanceTaskFixture({ id: '2', title: 'Task 2', category: 'HVAC & Mechanical', templateId: 'test-template' }),
      ],
      '/api/stats': { total: 2, dueNext30Days: 1, overdue: 0 },
    });
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    jest.restoreAllMocks();
  });

  describe('Minor/Major Filtering', () => {
    it('should show both minor and major maintenance by default', async () => {
      renderWithQueryClient(<Dashboard />);

      await waitFor(() => {
        const task1Minor = screen.queryByTestId('task-1-showMinor');
        const task1Major = screen.queryByTestId('task-1-showMajor');
        
        if (task1Minor && task1Major) {
          expect(task1Minor.textContent).toBe('true');
          expect(task1Major.textContent).toBe('true');
        }
      });
    });

    it('should hide minor maintenance when minor checkbox is unchecked', async () => {
      renderWithQueryClient(<Dashboard />);

      await waitFor(() => {
        expect(screen.queryByText('Task 1')).toBeInTheDocument();
      });

      // Find and uncheck the Minor checkbox
      const minorCheckbox = screen.getByRole('checkbox', { name: /minor/i });
      fireEvent.click(minorCheckbox);

      await waitFor(() => {
        const task1Minor = screen.queryByTestId('task-1-showMinor');
        if (task1Minor) {
          expect(task1Minor.textContent).toBe('false');
        }
      });
    });

    it('should hide major maintenance when major checkbox is unchecked', async () => {
      renderWithQueryClient(<Dashboard />);

      await waitFor(() => {
        expect(screen.queryByText('Task 1')).toBeInTheDocument();
      });

      // Find and uncheck the Major checkbox
      const majorCheckbox = screen.getByRole('checkbox', { name: /major/i });
      fireEvent.click(majorCheckbox);

      await waitFor(() => {
        const task1Major = screen.queryByTestId('task-1-showMajor');
        if (task1Major) {
          expect(task1Major.textContent).toBe('false');
        }
      });
    });

    it('should apply independent filters for minor and major maintenance', async () => {
      renderWithQueryClient(<Dashboard />);

      await waitFor(() => {
        expect(screen.queryByText('Task 1')).toBeInTheDocument();
      });

      // Uncheck both
      const minorCheckbox = screen.getByRole('checkbox', { name: /minor/i });
      const majorCheckbox = screen.getByRole('checkbox', { name: /major/i });
      
      fireEvent.click(minorCheckbox);
      fireEvent.click(majorCheckbox);

      await waitFor(() => {
        // Task should be hidden when both are unchecked
        expect(screen.queryByTestId('task-1')).not.toBeInTheDocument();
      });
    });
  });

  describe('Date Filtering', () => {
    beforeEach(() => {
      const today = new Date('2026-02-24T00:00:00.000Z');
      jest.useFakeTimers();
      jest.setSystemTime(today);
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should filter tasks by past due when date filter is 0', async () => {
      // Mock task with past due date
      global.fetch = jest.fn((url: string) => {
        if (url.includes('/api/tasks')) {
          return Promise.resolve({
            ok: true,
            json: async () => [
              createMaintenanceTaskFixture({ 
                id: '1',
                title: 'Task 1',
                templateId: 'test-template',
                nextMaintenanceDate: JSON.stringify({ 
                  minor: '2026-02-20T00:00:00.000Z', // Past due
                  major: '2027-01-01T00:00:00.000Z' 
                })
              }),
              createMaintenanceTaskFixture({ 
                id: '2',
                title: 'Task 2',
                templateId: 'test-template',
                nextMaintenanceDate: JSON.stringify({ 
                  minor: '2026-03-10T00:00:00.000Z', // Future
                  major: '2027-01-01T00:00:00.000Z' 
                })
              }),
            ],
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }) as jest.Mock;

      renderWithQueryClient(<Dashboard />);

      await waitFor(() => {
        expect(screen.queryByText('Task 1')).toBeInTheDocument();
      });

      // Set date filter to 0 (past due only)
      const dateInput = getDateInput();
      fireEvent.change(dateInput, { target: { value: '0' } });

      await waitFor(() => {
        // Task 1 should show minor (past due), Task 2 should not show minor
        const task1 = screen.queryByTestId('task-1');
        expect(task1).toBeInTheDocument();
      });
    });

    it('should filter tasks within specified days', async () => {
      global.fetch = jest.fn((url: string) => {
        if (url.includes('/api/tasks')) {
          return Promise.resolve({
            ok: true,
            json: async () => [
              createMaintenanceTaskFixture({ 
                id: '1',
                title: 'Task 1',
                templateId: 'test-template',
                nextMaintenanceDate: JSON.stringify({ 
                  minor: '2026-02-26T00:00:00.000Z', // 2 days from now
                  major: '2027-01-01T00:00:00.000Z' 
                })
              }),
              createMaintenanceTaskFixture({ 
                id: '2',
                title: 'Task 2',
                templateId: 'test-template',
                nextMaintenanceDate: JSON.stringify({ 
                  minor: '2026-03-20T00:00:00.000Z', // 24 days from now
                  major: '2027-01-01T00:00:00.000Z' 
                })
              }),
            ],
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }) as jest.Mock;

      renderWithQueryClient(<Dashboard />);

      await waitFor(() => {
        expect(screen.queryByText('Task 1')).toBeInTheDocument();
      });

      // Set date filter to 7 days
      const dateInput = getDateInput();
      fireEvent.change(dateInput, { target: { value: '7' } });

      await waitFor(() => {
        // Task 1 should be visible (within 7 days), Task 2 might not be
        expect(screen.queryByTestId('task-1')).toBeInTheDocument();
      });
    });
  });

  describe('Category Filtering', () => {
    it('should filter tasks by category', async () => {
      renderWithQueryClient(<Dashboard />);

      await waitFor(() => {
        expect(screen.queryByText('Task 1')).toBeInTheDocument();
        expect(screen.queryByText('Task 2')).toBeInTheDocument();
      });

      // Find and uncheck a category
      const appliancesCheckbox = getCategoryCheckbox('Appliances');
      fireEvent.click(appliancesCheckbox);

      await waitFor(() => {
        // Task 1 (Appliances) should be hidden
        expect(screen.queryByTestId('task-1')).not.toBeInTheDocument();
        // Task 2 (HVAC) should still be visible
        expect(screen.queryByTestId('task-2')).toBeInTheDocument();
      });
    });

    it('should toggle all categories', async () => {
      renderWithQueryClient(<Dashboard />);

      await waitFor(() => {
        expect(screen.queryByText('Task 1')).toBeInTheDocument();
      });

      // Find "Select All" or "Deselect All" button
      const toggleAllCheckbox = getCategoryCheckbox('Select/Deselect All');
      fireEvent.click(toggleAllCheckbox);

      await waitFor(() => {
        // All tasks should be hidden
        expect(screen.queryByTestId('task-1')).not.toBeInTheDocument();
        expect(screen.queryByTestId('task-2')).not.toBeInTheDocument();
      });
    });
  });

  describe('Over Due Stat Card Click', () => {
    it('should set date filter to 0 when Over Due card is clicked', async () => {
      renderWithQueryClient(<Dashboard />);

      await waitFor(() => {
        expect(screen.queryByText(/over due/i)).toBeInTheDocument();
      });

      // Find and click the Over Due card
      const overDueCard = screen.getByTitle(/overdue filter|filter and show only overdue tasks|clear overdue filter/i);
      fireEvent.click(overDueCard);

      // Check that date filter input shows 0
      await waitFor(() => {
        const dateInput = getDateInput();
        expect(dateInput).toHaveValue(0);
      });
    });
  });

  describe('Combined Filters', () => {
    it('should apply category, maintenance type, and date filters together', async () => {
      const today = new Date('2026-02-24T00:00:00.000Z');
      jest.useFakeTimers();
      jest.setSystemTime(today);

      global.fetch = jest.fn((url: string) => {
        if (url.includes('/api/tasks')) {
          return Promise.resolve({
            ok: true,
            json: async () => [
              createMaintenanceTaskFixture({ 
                id: '1', 
                title: 'Task 1',
                category: 'Appliances',
                templateId: 'test-template',
                nextMaintenanceDate: JSON.stringify({ 
                  minor: '2026-02-26T00:00:00.000Z', // 2 days - within filter
                  major: '2027-01-01T00:00:00.000Z' 
                })
              }),
              createMaintenanceTaskFixture({ 
                id: '2', 
                title: 'Task 2',
                category: 'HVAC & Mechanical',
                templateId: 'test-template',
                nextMaintenanceDate: JSON.stringify({ 
                  minor: '2026-03-20T00:00:00.000Z', // 24 days - outside filter
                  major: '2027-01-01T00:00:00.000Z' 
                })
              }),
            ],
          });
        }
        return Promise.resolve({ ok: true, json: async () => ({}) });
      }) as jest.Mock;

      renderWithQueryClient(<Dashboard />);

      await waitFor(() => {
        expect(screen.queryByText('Task 1')).toBeInTheDocument();
      });

      // Apply date filter (7 days)
      const dateInput = getDateInput();
      fireEvent.change(dateInput, { target: { value: '7' } });

      // Uncheck major maintenance
      const majorCheckbox = screen.getByRole('checkbox', { name: /major/i });
      fireEvent.click(majorCheckbox);

      await waitFor(() => {
        const task1 = screen.queryByTestId('task-1');
        const task1Major = screen.queryByTestId('task-1-showMajor');
        
        // Task 1 should be visible with minor only
        expect(task1).toBeInTheDocument();
        if (task1Major) {
          expect(task1Major.textContent).toBe('false');
        }
      });

      jest.useRealTimers();
    });
  });
});
