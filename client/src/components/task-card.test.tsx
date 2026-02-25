import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import TaskCard from './task-card';
import { MaintenanceTask } from '@shared/schema';

// Mock child components
jest.mock('@/components/ui/card', () => ({
  Card: ({ children, className }: any) => <div className={className}>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <h3>{children}</h3>,
}));

jest.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
}));

jest.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

jest.mock('@/components/ui/popover', () => ({
  Popover: ({ children }: any) => <div>{children}</div>,
  PopoverTrigger: ({ children }: any) => <div>{children}</div>,
  PopoverContent: ({ children }: any) => <div>{children}</div>,
}));

jest.mock('@/components/ui/calendar', () => ({
  Calendar: ({ onSelect }: any) => (
    <div onClick={() => onSelect(new Date('2026-02-24'))}>Mock Calendar</div>
  ),
}));

const createMockTask = (overrides: Partial<MaintenanceTask> = {}): MaintenanceTask => ({
  id: 1,
  title: 'Test HVAC Unit',
  category: 'HVAC & Mechanical',
  brand: 'TestBrand',
  model: 'Model123',
  location: 'Basement',
  installationDate: '2020-01-01',
  lastMaintenanceDate: JSON.stringify({ minor: '2025-01-01', major: '2024-01-01' }),
  nextMaintenanceDate: JSON.stringify({ 
    minor: '2026-03-01T00:00:00.000Z', 
    major: '2027-01-01T00:00:00.000Z' 
  }),
  minorIntervalMonths: 12,
  majorIntervalMonths: 60,
  minorTasks: JSON.stringify(['Clean filters', 'Check thermostat', 'Inspect ductwork']),
  majorTasks: JSON.stringify(['Deep clean system', 'Replace parts', 'Professional inspection']),
  notes: 'Important equipment',
  calendarExports: null,
  templateId: 'test-template',
  ...overrides,
});

const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
});

describe('TaskCard Component', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = createQueryClient();
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({ success: true }),
      })
    ) as jest.Mock;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Conditional Rendering with showMinor and showMajor', () => {
    it('should render both minor and major sections when both flags are true', () => {
      const task = createMockTask();
      
      render(
        <QueryClientProvider client={queryClient}>
          <TaskCard task={task} showMinor={true} showMajor={true} />
        </QueryClientProvider>
      );

      // Check for minor maintenance indicators
      expect(screen.getByText(/minor maintenance/i)).toBeInTheDocument();
      expect(screen.getByText(/clean filters/i)).toBeInTheDocument();
      
      // Check for major maintenance indicators
      expect(screen.getByText(/major maintenance/i)).toBeInTheDocument();
      expect(screen.getByText(/deep clean system/i)).toBeInTheDocument();
    });

    it('should render only minor section when showMinor is true and showMajor is false', () => {
      const task = createMockTask();
      
      render(
        <QueryClientProvider client={queryClient}>
          <TaskCard task={task} showMinor={true} showMajor={false} />
        </QueryClientProvider>
      );

      // Minor should be visible
      expect(screen.getByText(/minor maintenance/i)).toBeInTheDocument();
      
      // Major should not be visible
      expect(screen.queryByText(/major maintenance/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/deep clean system/i)).not.toBeInTheDocument();
    });

    it('should render only major section when showMinor is false and showMajor is true', () => {
      const task = createMockTask();
      
      render(
        <QueryClientProvider client={queryClient}>
          <TaskCard task={task} showMinor={false} showMajor={true} />
        </QueryClientProvider>
      );

      // Minor should not be visible
      expect(screen.queryByText(/minor maintenance/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/clean filters/i)).not.toBeInTheDocument();
      
      // Major should be visible
      expect(screen.getByText(/major maintenance/i)).toBeInTheDocument();
      expect(screen.getByText(/deep clean system/i)).toBeInTheDocument();
    });

    it('should render task header even when both flags are false', () => {
      const task = createMockTask();
      
      render(
        <QueryClientProvider client={queryClient}>
          <TaskCard task={task} showMinor={false} showMajor={false} />
        </QueryClientProvider>
      );

      // Task title should still be visible
      expect(screen.getByText(task.title)).toBeInTheDocument();
      
      // But neither maintenance section should be visible
      expect(screen.queryByText(/minor maintenance/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/major maintenance/i)).not.toBeInTheDocument();
    });

    it('should default to showing both sections when props are not provided', () => {
      const task = createMockTask();
      
      render(
        <QueryClientProvider client={queryClient}>
          <TaskCard task={task} />
        </QueryClientProvider>
      );

      // Both should be visible by default
      expect(screen.getByText(/minor maintenance/i)).toBeInTheDocument();
      expect(screen.getByText(/major maintenance/i)).toBeInTheDocument();
    });
  });

  describe('Task Information Display', () => {
    it('should display task basic information', () => {
      const task = createMockTask({
        title: 'Custom HVAC',
        brand: 'CustomBrand',
        model: 'CustomModel',
        location: 'Attic',
      });
      
      render(
        <QueryClientProvider client={queryClient}>
          <TaskCard task={task} />
        </QueryClientProvider>
      );

      expect(screen.getByText('Custom HVAC')).toBeInTheDocument();
      expect(screen.getByText(/CustomBrand/)).toBeInTheDocument();
      expect(screen.getByText(/CustomModel/)).toBeInTheDocument();
      expect(screen.getByText(/Attic/)).toBeInTheDocument();
    });

    it('should display next maintenance dates', () => {
      const task = createMockTask();
      
      render(
        <QueryClientProvider client={queryClient}>
          <TaskCard task={task} />
        </QueryClientProvider>
      );

      // Should show formatted dates
      expect(screen.getByText(/mar.*1.*2026/i)).toBeInTheDocument();
      expect(screen.getByText(/jan.*1.*2027/i)).toBeInTheDocument();
    });

    it('should display AI-generated task lists', () => {
      const task = createMockTask();
      
      render(
        <QueryClientProvider client={queryClient}>
          <TaskCard task={task} />
        </QueryClientProvider>
      );

      // Check for minor tasks
      expect(screen.getByText(/clean filters/i)).toBeInTheDocument();
      expect(screen.getByText(/check thermostat/i)).toBeInTheDocument();
      
      // Check for major tasks
      expect(screen.getByText(/deep clean system/i)).toBeInTheDocument();
      expect(screen.getByText(/replace parts/i)).toBeInTheDocument();
    });
  });

  describe('Mark Complete Functionality', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-24T00:00:00.000Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should mark minor maintenance as complete', async () => {
      const task = createMockTask({ minorIntervalMonths: 12 });
      
      render(
        <QueryClientProvider client={queryClient}>
          <TaskCard task={task} showMinor={true} showMajor={false} />
        </QueryClientProvider>
      );

      // Find and click the "Mark Complete" button for minor maintenance
      const markCompleteButton = screen.getAllByRole('button', { name: /mark complete/i })[0];
      fireEvent.click(markCompleteButton);

      // Calendar should appear - click it to select a date
      const calendar = screen.getByText(/mock calendar/i);
      fireEvent.click(calendar);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/tasks/1'),
          expect.objectContaining({
            method: 'PATCH',
            body: expect.stringContaining('lastMaintenanceDate'),
          })
        );
      });
    });

    it('should mark major maintenance as complete', async () => {
      const task = createMockTask({ majorIntervalMonths: 60 });
      
      render(
        <QueryClientProvider client={queryClient}>
          <TaskCard task={task} showMinor={false} showMajor={true} />
        </QueryClientProvider>
      );

      // Find and click the "Mark Complete" button for major maintenance
      const markCompleteButtons = screen.getAllByRole('button', { name: /mark complete/i });
      const majorButton = markCompleteButtons[markCompleteButtons.length - 1];
      fireEvent.click(majorButton);

      // Calendar should appear
      const calendar = screen.getByText(/mock calendar/i);
      fireEvent.click(calendar);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });
    });
  });

  describe('AI Schedule Generation', () => {
    it('should trigger AI schedule generation when button is clicked', async () => {
      const task = createMockTask({ minorTasks: null, majorTasks: null });
      
      global.fetch = jest.fn(() =>
        Promise.resolve({
          ok: true,
          json: async () => ({
            result: {
              nextMaintenanceDates: { minor: '2026-03-01', major: '2027-01-01' },
              maintenanceSchedule: {
                minorIntervalMonths: '12',
                majorIntervalMonths: '60',
                minorTasks: ['New task 1', 'New task 2'],
                majorTasks: ['New major task 1', 'New major task 2'],
              },
            },
          }),
        })
      ) as jest.Mock;

      render(
        <QueryClientProvider client={queryClient}>
          <TaskCard task={task} />
        </QueryClientProvider>
      );

      // Find AI generation button (sparkles icon)
      const aiButton = screen.getByRole('button', { name: /generate ai schedule/i });
      fireEvent.click(aiButton);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/item-schedule'),
          expect.objectContaining({
            method: 'POST',
            body: expect.stringContaining(task.title),
          })
        );
      });
    });

    it('should not send provider in request body', async () => {
      const task = createMockTask();
      
      render(
        <QueryClientProvider client={queryClient}>
          <TaskCard task={task} />
        </QueryClientProvider>
      );

      const aiButton = screen.getByRole('button', { name: /generate ai schedule/i });
      fireEvent.click(aiButton);

      await waitFor(() => {
        const fetchCall = (global.fetch as jest.Mock).mock.calls[0];
        if (fetchCall) {
          const body = JSON.parse(fetchCall[1].body);
          expect(body.provider).toBeUndefined();
        }
      });
    });
  });

  describe('Date Formatting', () => {
    it('should format dates correctly', () => {
      const task = createMockTask({
        nextMaintenanceDate: JSON.stringify({ 
          minor: '2026-12-25T00:00:00.000Z', 
          major: '2028-07-04T00:00:00.000Z' 
        }),
      });
      
      render(
        <QueryClientProvider client={queryClient}>
          <TaskCard task={task} />
        </QueryClientProvider>
      );

      // Check for formatted minor date
      expect(screen.getByText(/dec.*25.*2026/i)).toBeInTheDocument();
      
      // Check for formatted major date
      expect(screen.getByText(/jul.*4.*2028/i)).toBeInTheDocument();
    });

    it('should handle missing maintenance dates gracefully', () => {
      const task = createMockTask({
        nextMaintenanceDate: JSON.stringify({ minor: null, major: null }),
      });
      
      render(
        <QueryClientProvider client={queryClient}>
          <TaskCard task={task} />
        </QueryClientProvider>
      );

      // Should still render the card without errors
      expect(screen.getByText(task.title)).toBeInTheDocument();
    });
  });

  describe('Past Due Indicator', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-24T00:00:00.000Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should show past due indicator for overdue minor maintenance', () => {
      const task = createMockTask({
        nextMaintenanceDate: JSON.stringify({ 
          minor: '2026-02-20T00:00:00.000Z', // Past due
          major: '2027-01-01T00:00:00.000Z' 
        }),
      });
      
      render(
        <QueryClientProvider client={queryClient}>
          <TaskCard task={task} />
        </QueryClientProvider>
      );

      // Look for past due indicator (could be text or styling)
      expect(screen.getByText(/overdue|past due/i)).toBeInTheDocument();
    });

    it('should not show past due indicator for future maintenance', () => {
      const task = createMockTask({
        nextMaintenanceDate: JSON.stringify({ 
          minor: '2026-03-01T00:00:00.000Z', // Future
          major: '2027-01-01T00:00:00.000Z' 
        }),
      });
      
      render(
        <QueryClientProvider client={queryClient}>
          <TaskCard task={task} />
        </QueryClientProvider>
      );

      // Should not show past due indicator
      expect(screen.queryByText(/overdue|past due/i)).not.toBeInTheDocument();
    });
  });
});
