/** @jest-environment jsdom */

import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import TaskCard from './task-card';
import { createMaintenanceTaskFixture } from '@/test/fixtures';
import { mockJsonFetch, renderWithQueryClient } from '@/test/test-utils';

// Mock child components
jest.mock('@/components/ui/card', () => ({
  Card: ({ children, className }: any) => <div className={className}>{children}</div>,
  CardContent: ({ children }: any) => <div>{children}</div>,
  CardHeader: ({ children }: any) => <div>{children}</div>,
  CardTitle: ({ children }: any) => <h3>{children}</h3>,
}));

jest.mock('@/components/ui/button', () => ({
  Button: ({ children, ...props }: any) => (
    <button {...props}>{children}</button>
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

describe('TaskCard Component', () => {
  beforeEach(() => {
    mockJsonFetch({
      '/api/auth/me': null,
      '/api/tasks': { success: true },
      '/api/stats': { success: true },
      '/api/item-schedule': {
        result: {
          nextMaintenanceDates: { minor: '2026-03-01', major: '2027-01-01' },
          maintenanceSchedule: {
            minorIntervalMonths: '12',
            majorIntervalMonths: '60',
            minorTasks: ['New task 1', 'New task 2'],
            majorTasks: ['New major task 1', 'New major task 2'],
          },
        },
      },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Conditional Rendering with showMinor and showMajor', () => {
    it('should render both minor and major sections when both flags are true', () => {
      const task = createMaintenanceTaskFixture({
        title: 'Test HVAC Unit',
        description: 'Test HVAC maintenance',
        category: 'HVAC & Mechanical',
        model: 'Model123',
        location: 'Basement',
        lastMaintenanceDate: JSON.stringify({ minor: '2025-01-01', major: '2024-01-01' }),
        minorTasks: JSON.stringify(['Clean filters', 'Check thermostat', 'Inspect ductwork']),
        majorTasks: JSON.stringify(['Deep clean system', 'Replace parts', 'Professional inspection']),
        notes: 'Important equipment',
        templateId: 'test-template',
      });
      
      renderWithQueryClient(<TaskCard task={task} showMinor={true} showMajor={true} />);

      // Check for minor maintenance indicators
      expect(screen.getByRole('button', { name: /mark minor complete/i })).toBeInTheDocument();
      expect(screen.getByText(/clean filters/i)).toBeInTheDocument();
      
      // Check for major maintenance indicators
      expect(screen.getByRole('button', { name: /mark major complete/i })).toBeInTheDocument();
      expect(screen.getByText(/deep clean system/i)).toBeInTheDocument();
    });

    it('should render only minor section when showMinor is true and showMajor is false', () => {
      const task = createMaintenanceTaskFixture({
        title: 'Test HVAC Unit',
        category: 'HVAC & Mechanical',
        minorTasks: JSON.stringify(['Clean filters', 'Check thermostat', 'Inspect ductwork']),
        majorTasks: JSON.stringify(['Deep clean system', 'Replace parts', 'Professional inspection']),
      });
      
      renderWithQueryClient(<TaskCard task={task} showMinor={true} showMajor={false} />);

      // Minor should be visible
      expect(screen.getByRole('button', { name: /mark minor complete/i })).toBeInTheDocument();
      
      // Major should not be visible
      expect(screen.queryByRole('button', { name: /mark major complete/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/deep clean system/i)).not.toBeInTheDocument();
    });

    it('should render only major section when showMinor is false and showMajor is true', () => {
      const task = createMaintenanceTaskFixture({
        title: 'Test HVAC Unit',
        category: 'HVAC & Mechanical',
        minorTasks: JSON.stringify(['Clean filters', 'Check thermostat', 'Inspect ductwork']),
        majorTasks: JSON.stringify(['Deep clean system', 'Replace parts', 'Professional inspection']),
      });
      
      renderWithQueryClient(<TaskCard task={task} showMinor={false} showMajor={true} />);

      // Minor should not be visible
      expect(screen.queryByRole('button', { name: /mark minor complete/i })).not.toBeInTheDocument();
      expect(screen.queryByText(/clean filters/i)).not.toBeInTheDocument();
      
      // Major should be visible
      expect(screen.getByRole('button', { name: /mark major complete/i })).toBeInTheDocument();
      expect(screen.getByText(/deep clean system/i)).toBeInTheDocument();
    });

    it('should render task header even when both flags are false', () => {
      const task = createMaintenanceTaskFixture({
        title: 'Test HVAC Unit',
        minorTasks: JSON.stringify(['Clean filters']),
        majorTasks: JSON.stringify(['Deep clean system']),
      });
      
      renderWithQueryClient(<TaskCard task={task} showMinor={false} showMajor={false} />);

      // Task title should still be visible
      expect(screen.getByText(task.title)).toBeInTheDocument();
      
      // But neither maintenance section should be visible
      expect(screen.queryByRole('button', { name: /mark minor complete/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /mark major complete/i })).not.toBeInTheDocument();
    });

    it('should default to showing both sections when props are not provided', () => {
      const task = createMaintenanceTaskFixture({
        title: 'Test HVAC Unit',
        minorTasks: JSON.stringify(['Clean filters']),
        majorTasks: JSON.stringify(['Deep clean system']),
      });
      
      renderWithQueryClient(<TaskCard task={task} />);

      // Both should be visible by default
      expect(screen.getByRole('button', { name: /mark minor complete/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /mark major complete/i })).toBeInTheDocument();
    });
  });

  describe('Task Information Display', () => {
    it('should display task basic information', () => {
      const task = createMaintenanceTaskFixture({
        title: 'Custom HVAC',
        brand: 'CustomBrand',
        model: 'CustomModel',
        location: 'Attic',
        notes: 'Important equipment',
        minorTasks: JSON.stringify(['Clean filters']),
        majorTasks: JSON.stringify(['Deep clean system']),
      });
      
      renderWithQueryClient(<TaskCard task={task} />);

      expect(screen.getByText('Custom HVAC')).toBeInTheDocument();
      expect(screen.getByText(/important equipment/i)).toBeInTheDocument();
    });

    it('should display next maintenance dates', () => {
      const task = createMaintenanceTaskFixture({
        title: 'Test HVAC Unit',
        minorTasks: JSON.stringify(['Clean filters']),
        majorTasks: JSON.stringify(['Deep clean system']),
      });
      
      renderWithQueryClient(<TaskCard task={task} />);

      // Should show formatted dates
      expect(screen.getByText(/3\/1\/2026/i)).toBeInTheDocument();
      expect(screen.getByText(/1\/1\/2027/i)).toBeInTheDocument();
    });

    it('should display AI-generated task lists', () => {
      const task = createMaintenanceTaskFixture({
        title: 'Test HVAC Unit',
        minorTasks: JSON.stringify(['Clean filters', 'Check thermostat', 'Inspect ductwork']),
        majorTasks: JSON.stringify(['Deep clean system', 'Replace parts', 'Professional inspection']),
      });
      
      renderWithQueryClient(<TaskCard task={task} />);

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
      const task = createMaintenanceTaskFixture({
        id: '1',
        title: 'Test HVAC Unit',
        minorIntervalMonths: 12,
        minorTasks: JSON.stringify(['Clean filters']),
        majorTasks: JSON.stringify(['Deep clean system']),
      });
      
      renderWithQueryClient(<TaskCard task={task} showMinor={true} showMajor={false} />);

      // Find and click the "Mark Complete" button for minor maintenance
      const markCompleteButton = screen.getByRole('button', { name: /mark minor complete/i });
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
      const task = createMaintenanceTaskFixture({
        title: 'Test HVAC Unit',
        majorIntervalMonths: 60,
        minorTasks: JSON.stringify(['Clean filters']),
        majorTasks: JSON.stringify(['Deep clean system']),
      });
      
      renderWithQueryClient(<TaskCard task={task} showMinor={false} showMajor={true} />);

      // Find and click the "Mark Complete" button for major maintenance
      const majorButton = screen.getByRole('button', { name: /mark major complete/i });
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
      const task = createMaintenanceTaskFixture({
        title: 'Test HVAC Unit',
        minorTasks: null,
        majorTasks: null,
      });
      
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

      renderWithQueryClient(<TaskCard task={task} />);

      // Find AI generation button (sparkles icon)
      const aiButton = screen.getByTitle(/ai .*schedule|generate ai schedule/i);
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
      const task = createMaintenanceTaskFixture({
        title: 'Test HVAC Unit',
        minorTasks: JSON.stringify(['Clean filters']),
        majorTasks: JSON.stringify(['Deep clean system']),
      });
      
      renderWithQueryClient(<TaskCard task={task} />);

      const aiButton = screen.getByTitle(/ai .*schedule|generate ai schedule/i);
      fireEvent.click(aiButton);

      await waitFor(() => {
        const fetchCall = (global.fetch as jest.Mock).mock.calls.find(
          (call) => String(call[0]).includes('/api/item-schedule') && call[1]?.method === 'POST',
        );
        expect(fetchCall).toBeDefined();
        const body = JSON.parse(fetchCall![1].body as string);
        expect(body.provider).toBeUndefined();
      });
    });
  });

  describe('Date Formatting', () => {
    it('should format dates correctly', () => {
      const task = createMaintenanceTaskFixture({
        title: 'Test HVAC Unit',
        nextMaintenanceDate: JSON.stringify({ 
          minor: '2026-12-25T00:00:00.000Z', 
          major: '2028-07-04T00:00:00.000Z' 
        }),
        minorTasks: JSON.stringify(['Clean filters']),
        majorTasks: JSON.stringify(['Deep clean system']),
      });
      
      renderWithQueryClient(<TaskCard task={task} />);

      // Check for formatted minor date
      expect(screen.getByText(/12\/25\/2026/i)).toBeInTheDocument();
      
      // Check for formatted major date
      expect(screen.getByText(/7\/4\/2028/i)).toBeInTheDocument();
    });

    it('should handle missing maintenance dates gracefully', () => {
      const task = createMaintenanceTaskFixture({
        title: 'Test HVAC Unit',
        nextMaintenanceDate: JSON.stringify({ minor: null, major: null }),
        minorTasks: JSON.stringify(['Clean filters']),
        majorTasks: JSON.stringify(['Deep clean system']),
      });
      
      renderWithQueryClient(<TaskCard task={task} />);

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
      const task = createMaintenanceTaskFixture({
        title: 'Test HVAC Unit',
        nextMaintenanceDate: JSON.stringify({ 
          minor: '2026-02-20T00:00:00.000Z', // Past due
          major: '2027-01-01T00:00:00.000Z' 
        }),
        minorTasks: JSON.stringify(['Clean filters']),
        majorTasks: JSON.stringify(['Deep clean system']),
      });
      
      renderWithQueryClient(<TaskCard task={task} />);

      // Look for past due indicator (could be text or styling)
      expect(screen.getByText(/overdue|past due/i)).toBeInTheDocument();
    });

    it('should not show past due indicator for future maintenance', () => {
      const task = createMaintenanceTaskFixture({
        title: 'Test HVAC Unit',
        nextMaintenanceDate: JSON.stringify({ 
          minor: '2026-03-01T00:00:00.000Z', // Future
          major: '2027-01-01T00:00:00.000Z' 
        }),
        minorTasks: JSON.stringify(['Clean filters']),
        majorTasks: JSON.stringify(['Deep clean system']),
      });
      
      renderWithQueryClient(<TaskCard task={task} />);

      // Should not show past due indicator
      expect(screen.queryByText(/overdue|past due/i)).not.toBeInTheDocument();
    });
  });
});
