import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ExportScheduleModal from './export-schedule-modal';
import { MaintenanceTask } from '@shared/schema';

// Mock UI components
jest.mock('@/components/ui/dialog', () => ({
  Dialog: ({ children, open }: any) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h2>{children}</h2>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
}));

jest.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
}));

jest.mock('@/components/ui/badge', () => ({
  Badge: ({ children }: any) => <span>{children}</span>,
}));

jest.mock('@/hooks/use-toast', () => ({
  useToast: () => ({
    toast: jest.fn(),
  }),
}));

const createMockTask = (overrides: Partial<MaintenanceTask> = {}): MaintenanceTask => ({
  id: 1,
  title: 'Test Task',
  category: 'Appliances',
  brand: '',
  model: '',
  location: 'Kitchen',
  installationDate: '2020-01-01',
  lastMaintenanceDate: JSON.stringify({ minor: null, major: null }),
  nextMaintenanceDate: JSON.stringify({ 
    minor: '2026-03-01T00:00:00.000Z', 
    major: '2027-01-01T00:00:00.000Z' 
  }),
  minorIntervalMonths: 12,
  majorIntervalMonths: 60,
  minorTasks: JSON.stringify(['Clean', 'Inspect']),
  majorTasks: JSON.stringify(['Replace', 'Service']),
  notes: '',
  calendarExports: null,
  templateId: 'test-template',
  ...overrides,
});

const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: { retry: false },
  },
});

describe('ExportScheduleModal', () => {
  let queryClient: QueryClient;
  let createObjectURLSpy: jest.SpyInstance;
  let revokeObjectURLSpy: jest.SpyInstance;

  beforeEach(() => {
    queryClient = createQueryClient();
    
    // Mock URL.createObjectURL and revokeObjectURL
    createObjectURLSpy = jest.spyOn(window.URL, 'createObjectURL').mockReturnValue('mock-url');
    revokeObjectURLSpy = jest.spyOn(window.URL, 'revokeObjectURL').mockImplementation();
    
    // Mock createElement to track download link creation
    const originalCreateElement = document.createElement.bind(document);
    jest.spyOn(document, 'createElement').mockImplementation((tagName: string) => {
      const element = originalCreateElement(tagName);
      if (tagName === 'a') {
        // Mock click to prevent actual download
        element.click = jest.fn();
      }
      return element;
    });
    
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({ success: true }),
      })
    ) as jest.Mock;

    // Mock alert
    global.alert = jest.fn();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Filter Respect in ICS Export', () => {
    it('should export both minor and major maintenance when both flags are true', async () => {
      const task = createMockTask();
      const taskWithFilters = { ...task, showMinor: true, showMajor: true };
      
      render(
        <QueryClientProvider client={queryClient}>
          <ExportScheduleModal 
            open={true} 
            onOpenChange={() => {}} 
            tasks={[taskWithFilters]} 
          />
        </QueryClientProvider>
      );

      // Click export for Google Calendar
      const googleButton = screen.getByRole('button', { name: /google calendar/i });
      fireEvent.click(googleButton);

      await waitFor(() => {
        expect(createObjectURLSpy).toHaveBeenCalled();
        const blob = createObjectURLSpy.mock.calls[0][0];
        const reader = new FileReader();
        
        reader.onload = () => {
          const icsContent = reader.result as string;
          // Should contain both minor and major events
          expect(icsContent).toContain('Minor Maintenance: Test Task');
          expect(icsContent).toContain('Major Maintenance: Test Task');
        };
        
        reader.readAsText(blob);
      });
    });

    it('should export only minor maintenance when showMinor is true and showMajor is false', async () => {
      const task = createMockTask();
      const taskWithFilters = { ...task, showMinor: true, showMajor: false };
      
      render(
        <QueryClientProvider client={queryClient}>
          <ExportScheduleModal 
            open={true} 
            onOpenChange={() => {}} 
            tasks={[taskWithFilters]} 
          />
        </QueryClientProvider>
      );

      const googleButton = screen.getByRole('button', { name: /google calendar/i });
      fireEvent.click(googleButton);

      await waitFor(() => {
        expect(createObjectURLSpy).toHaveBeenCalled();
        const blob = createObjectURLSpy.mock.calls[0][0];
        const reader = new FileReader();
        
        reader.onload = () => {
          const icsContent = reader.result as string;
          // Should contain only minor event
          expect(icsContent).toContain('Minor Maintenance: Test Task');
          expect(icsContent).not.toContain('Major Maintenance: Test Task');
        };
        
        reader.readAsText(blob);
      });
    });

    it('should export only major maintenance when showMinor is false and showMajor is true', async () => {
      const task = createMockTask();
      const taskWithFilters = { ...task, showMinor: false, showMajor: true };
      
      render(
        <QueryClientProvider client={queryClient}>
          <ExportScheduleModal 
            open={true} 
            onOpenChange={() => {}} 
            tasks={[taskWithFilters]} 
          />
        </QueryClientProvider>
      );

      const appleButton = screen.getByRole('button', { name: /apple calendar/i });
      fireEvent.click(appleButton);

      await waitFor(() => {
        expect(createObjectURLSpy).toHaveBeenCalled();
        const blob = createObjectURLSpy.mock.calls[0][0];
        const reader = new FileReader();
        
        reader.onload = () => {
          const icsContent = reader.result as string;
          // Should contain only major event
          expect(icsContent).not.toContain('Minor Maintenance: Test Task');
          expect(icsContent).toContain('Major Maintenance: Test Task');
        };
        
        reader.readAsText(blob);
      });
    });

    it('should export both maintenance types when filter properties are not present (default behavior)', async () => {
      const task = createMockTask();
      // Task without showMinor/showMajor properties should default to true
      
      render(
        <QueryClientProvider client={queryClient}>
          <ExportScheduleModal 
            open={true} 
            onOpenChange={() => {}} 
            tasks={[task]} 
          />
        </QueryClientProvider>
      );

      const genericButton = screen.getByRole('button', { name: /generic|other/i });
      fireEvent.click(genericButton);

      await waitFor(() => {
        expect(createObjectURLSpy).toHaveBeenCalled();
        const blob = createObjectURLSpy.mock.calls[0][0];
        const reader = new FileReader();
        
        reader.onload = () => {
          const icsContent = reader.result as string;
          // Should contain both events by default
          expect(icsContent).toContain('Minor Maintenance: Test Task');
          expect(icsContent).toContain('Major Maintenance: Test Task');
        };
        
        reader.readAsText(blob);
      });
    });
  });

  describe('Past Due Date Handling', () => {
    beforeEach(() => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-24T00:00:00.000Z'));
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should use today\'s date for past due minor maintenance', async () => {
      const task = createMockTask({
        nextMaintenanceDate: JSON.stringify({ 
          minor: '2026-02-20T00:00:00.000Z', // Past due (4 days ago)
          major: '2027-01-01T00:00:00.000Z' 
        }),
      });
      const taskWithFilters = { ...task, showMinor: true, showMajor: false };
      
      render(
        <QueryClientProvider client={queryClient}>
          <ExportScheduleModal 
            open={true} 
            onOpenChange={() => {}} 
            tasks={[taskWithFilters]} 
          />
        </QueryClientProvider>
      );

      const googleButton = screen.getByRole('button', { name: /google calendar/i });
      fireEvent.click(googleButton);

      await waitFor(() => {
        expect(createObjectURLSpy).toHaveBeenCalled();
        const blob = createObjectURLSpy.mock.calls[0][0];
        const reader = new FileReader();
        
        reader.onload = () => {
          const icsContent = reader.result as string;
          // Should use today's date (2026-02-24) instead of past date (2026-02-20)
          expect(icsContent).toContain('DTSTART;VALUE=DATE:20260224');
          expect(icsContent).not.toContain('DTSTART;VALUE=DATE:20260220');
        };
        
        reader.readAsText(blob);
      });
    });

    it('should use today\'s date for past due major maintenance', async () => {
      const task = createMockTask({
        nextMaintenanceDate: JSON.stringify({ 
          minor: '2026-03-01T00:00:00.000Z',
          major: '2026-01-01T00:00:00.000Z' // Past due
        }),
      });
      const taskWithFilters = { ...task, showMinor: false, showMajor: true };
      
      render(
        <QueryClientProvider client={queryClient}>
          <ExportScheduleModal 
            open={true} 
            onOpenChange={() => {}} 
            tasks={[taskWithFilters]} 
          />
        </QueryClientProvider>
      );

      const appleButton = screen.getByRole('button', { name: /apple calendar/i });
      fireEvent.click(appleButton);

      await waitFor(() => {
        expect(createObjectURLSpy).toHaveBeenCalled();
        const blob = createObjectURLSpy.mock.calls[0][0];
        const reader = new FileReader();
        
        reader.onload = () => {
          const icsContent = reader.result as string;
          // Should use today's date (2026-02-24) instead of past date (2026-01-01)
          expect(icsContent).toContain('DTSTART;VALUE=DATE:20260224');
          expect(icsContent).not.toContain('DTSTART;VALUE=DATE:20260101');
        };
        
        reader.readAsText(blob);
      });
    });

    it('should not modify future maintenance dates', async () => {
      const task = createMockTask({
        nextMaintenanceDate: JSON.stringify({ 
          minor: '2026-03-10T00:00:00.000Z', // Future
          major: '2027-05-15T00:00:00.000Z' // Future
        }),
      });
      const taskWithFilters = { ...task, showMinor: true, showMajor: true };
      
      render(
        <QueryClientProvider client={queryClient}>
          <ExportScheduleModal 
            open={true} 
            onOpenChange={() => {}} 
            tasks={[taskWithFilters]} 
          />
        </QueryClientProvider>
      );

      const genericButton = screen.getByRole('button', { name: /generic|other/i });
      fireEvent.click(genericButton);

      await waitFor(() => {
        expect(createObjectURLSpy).toHaveBeenCalled();
        const blob = createObjectURLSpy.mock.calls[0][0];
        const reader = new FileReader();
        
        reader.onload = () => {
          const icsContent = reader.result as string;
          // Should use original future dates
          expect(icsContent).toContain('DTSTART;VALUE=DATE:20260310');
          expect(icsContent).toContain('DTSTART;VALUE=DATE:20270515');
          // Should not use today's date
          expect(icsContent).not.toContain('DTSTART;VALUE=DATE:20260224');
        };
        
        reader.readAsText(blob);
      });
    });

    it('should handle mixed past due and future dates correctly', async () => {
      const tasks = [
        createMockTask({ 
          id: 1,
          title: 'Past Due Task',
          nextMaintenanceDate: JSON.stringify({ 
            minor: '2026-02-15T00:00:00.000Z', // Past due
            major: '2027-01-01T00:00:00.000Z' 
          }),
        }),
        createMockTask({ 
          id: 2,
          title: 'Future Task',
          nextMaintenanceDate: JSON.stringify({ 
            minor: '2026-03-15T00:00:00.000Z', // Future
            major: '2027-06-01T00:00:00.000Z' 
          }),
        }),
      ];
      
      const tasksWithFilters = tasks.map(task => ({ ...task, showMinor: true, showMajor: true }));
      
      render(
        <QueryClientProvider client={queryClient}>
          <ExportScheduleModal 
            open={true} 
            onOpenChange={() => {}} 
            tasks={tasksWithFilters} 
          />
        </QueryClientProvider>
      );

      const googleButton = screen.getByRole('button', { name: /google calendar/i });
      fireEvent.click(googleButton);

      await waitFor(() => {
        expect(createObjectURLSpy).toHaveBeenCalled();
        const blob = createObjectURLSpy.mock.calls[0][0];
        const reader = new FileReader();
        
        reader.onload = () => {
          const icsContent = reader.result as string;
          // Past due task should use today
          expect(icsContent).toContain('Minor Maintenance: Past Due Task');
          expect(icsContent).toMatch(/Past Due Task[\s\S]*?DTSTART;VALUE=DATE:20260224/);
          
          // Future task should use original date
          expect(icsContent).toContain('Minor Maintenance: Future Task');
          expect(icsContent).toContain('DTSTART;VALUE=DATE:20260315');
        };
        
        reader.readAsText(blob);
      });
    });
  });

  describe('Clear Calendar Exports', () => {
    it('should clear Google calendar exports', async () => {
      const task = createMockTask({
        calendarExports: JSON.stringify({
          google: { exportedAt: '2026-02-01', eventIds: { minor: 'test-minor', major: 'test-major' } }
        }),
      });
      
      render(
        <QueryClientProvider client={queryClient}>
          <ExportScheduleModal 
            open={true} 
            onOpenChange={() => {}} 
            tasks={[task]} 
          />
        </QueryClientProvider>
      );

      // Find and click "Clear Google" button
      const clearGoogleButton = screen.getByRole('button', { name: /clear google/i });
      fireEvent.click(clearGoogleButton);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/tasks/1'),
          expect.objectContaining({
            method: 'PATCH',
            body: expect.stringContaining('calendarExports'),
          })
        );
      });
    });

    it('should clear Apple calendar exports', async () => {
      const task = createMockTask({
        calendarExports: JSON.stringify({
          apple: { exportedAt: '2026-02-01', eventIds: { minor: 'test-minor', major: 'test-major' } }
        }),
      });
      
      render(
        <QueryClientProvider client={queryClient}>
          <ExportScheduleModal 
            open={true} 
            onOpenChange={() => {}} 
            tasks={[task]} 
          />
        </QueryClientProvider>
      );

      const clearAppleButton = screen.getByRole('button', { name: /clear apple/i });
      fireEvent.click(clearAppleButton);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/tasks/1'),
          expect.objectContaining({
            method: 'PATCH',
          })
        );
      });
    });

    it('should clear all calendar exports', async () => {
      const task = createMockTask({
        calendarExports: JSON.stringify({
          google: { exportedAt: '2026-02-01', eventIds: { minor: 'g-minor', major: 'g-major' } },
          apple: { exportedAt: '2026-02-01', eventIds: { minor: 'a-minor', major: 'a-major' } }
        }),
      });
      
      render(
        <QueryClientProvider client={queryClient}>
          <ExportScheduleModal 
            open={true} 
            onOpenChange={() => {}} 
            tasks={[task]} 
          />
        </QueryClientProvider>
      );

      const clearAllButton = screen.getByRole('button', { name: /clear all/i });
      fireEvent.click(clearAllButton);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/tasks/1'),
          expect.objectContaining({
            method: 'PATCH',
            body: expect.stringContaining('"calendarExports":null'),
          })
        );
      });
    });
  });

  describe('ICS File Generation', () => {
    it('should generate valid ICS file with correct headers', async () => {
      const task = createMockTask();
      const taskWithFilters = { ...task, showMinor: true, showMajor: true };
      
      render(
        <QueryClientProvider client={queryClient}>
          <ExportScheduleModal 
            open={true} 
            onOpenChange={() => {}} 
            tasks={[taskWithFilters]} 
          />
        </QueryClientProvider>
      );

      const googleButton = screen.getByRole('button', { name: /google calendar/i });
      fireEvent.click(googleButton);

      await waitFor(() => {
        expect(createObjectURLSpy).toHaveBeenCalled();
        const blob = createObjectURLSpy.mock.calls[0][0];
        const reader = new FileReader();
        
        reader.onload = () => {
          const icsContent = reader.result as string;
          // Check for required ICS headers
          expect(icsContent).toContain('BEGIN:VCALENDAR');
          expect(icsContent).toContain('VERSION:2.0');
          expect(icsContent).toContain('PRODID:-//HomeGuard//Maintenance Schedule//EN');
          expect(icsContent).toContain('END:VCALENDAR');
        };
        
        reader.readAsText(blob);
      });
    });

    it('should include task details in event description', async () => {
      const task = createMockTask({
        title: 'HVAC System',
        minorTasks: JSON.stringify(['Clean filters', 'Check thermostat']),
        majorTasks: JSON.stringify(['Replace compressor', 'Full inspection']),
      });
      const taskWithFilters = { ...task, showMinor: true, showMajor: true };
      
      render(
        <QueryClientProvider client={queryClient}>
          <ExportScheduleModal 
            open={true} 
            onOpenChange={() => {}} 
            tasks={[taskWithFilters]} 
          />
        </QueryClientProvider>
      );

      const googleButton = screen.getByRole('button', { name: /google calendar/i });
      fireEvent.click(googleButton);

      await waitFor(() => {
        expect(createObjectURLSpy).toHaveBeenCalled();
        const blob = createObjectURLSpy.mock.calls[0][0];
        const reader = new FileReader();
        
        reader.onload = () => {
          const icsContent = reader.result as string;
          // Check for task details
          expect(icsContent).toContain('HVAC System');
          expect(icsContent).toContain('Clean filters');
          expect(icsContent).toContain('Check thermostat');
          expect(icsContent).toContain('Replace compressor');
          expect(icsContent).toContain('Full inspection');
        };
        
        reader.readAsText(blob);
      });
    });
  });
});
