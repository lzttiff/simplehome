import { MaintenanceTask } from "@shared/schema";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Calendar, Download, ExternalLink, RefreshCw } from "lucide-react";

interface ExportScheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  tasks: MaintenanceTask[];
}

interface CalendarExport {
  provider: 'google' | 'apple';
  eventIds: {
    minor?: string;
    major?: string;
  };
  eventLinks?: {
    minor?: string;
    major?: string;
  };
  lastSyncedAt: string;
}

export default function ExportScheduleModal({ isOpen, onClose, tasks }: ExportScheduleModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [includeMinor, setIncludeMinor] = useState(true);
  const [includeMajor, setIncludeMajor] = useState(true);

  const updateTaskMutation = useMutation({
    mutationFn: async ({ taskId, calendarExports }: { taskId: string; calendarExports: string }) => {
      const response = await apiRequest("PATCH", `/api/tasks/${taskId}`, { calendarExports });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
    },
  });

  const trackCalendarExport = async (taskId: string, provider: 'google' | 'apple', eventIds: { minor?: string; major?: string }, eventLinks?: { minor?: string; major?: string }) => {
    try {
      const task = tasks.find(t => t.id === taskId);
      if (!task) return;

      const existingExports: CalendarExport[] = task.calendarExports ? JSON.parse(task.calendarExports) : [];
      
      // Remove existing export for this provider
      const filteredExports = existingExports.filter(exp => exp.provider !== provider);
      
      // Add new export
      const newExport: CalendarExport = {
        provider,
        eventIds,
        eventLinks,
        lastSyncedAt: new Date().toISOString(),
      };
      
      filteredExports.push(newExport);
      
      await updateTaskMutation.mutateAsync({
        taskId,
        calendarExports: JSON.stringify(filteredExports),
      });
    } catch (error) {
      console.error('Error tracking calendar export:', error);
    }
  };
  
  const generateICSFile = async (provider: 'google' | 'apple' | 'generic' = 'generic') => {
    // Validate at least one type is selected
    if (!includeMinor && !includeMajor) {
      alert("Please select at least one maintenance type (Minor or Major) to export.");
      return;
    }

    // Filter tasks with next maintenance dates matching the selected types
    const tasksWithDates = tasks.filter(task => {
      try {
        const nextMaintenance = task.nextMaintenanceDate ? JSON.parse(task.nextMaintenanceDate) : null;
        if (!nextMaintenance) return false;
        
        const hasMinor = includeMinor && nextMaintenance.minor;
        const hasMajor = includeMajor && nextMaintenance.major;
        return hasMinor || hasMajor;
      } catch {
        return false;
      }
    });

    if (tasksWithDates.length === 0) {
      alert("No tasks with scheduled dates found to export for the selected maintenance types.");
      return;
    }

    // Create ICS content
    let icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//HomeGuard//Maintenance Schedule//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      'X-WR-CALNAME:HomeGuard Maintenance Schedule',
      'X-WR-TIMEZONE:UTC',
    ];

    tasksWithDates.forEach(task => {
      try {
        const nextMaintenance = JSON.parse(task.nextMaintenanceDate || '{}');
        
        // Track event IDs for local reference
        const eventIds: { minor?: string; major?: string } = {};
        
        // Add event for minor maintenance (only if filter is enabled)
        if (includeMinor && nextMaintenance.minor) {
          const minorDate = new Date(nextMaintenance.minor);
          const minorTasks = task.minorTasks ? JSON.parse(task.minorTasks) : [];
          const description = Array.isArray(minorTasks) && minorTasks.length > 0
            ? minorTasks.join('\\n')
            : task.description || 'Regular minor maintenance';
          
          const eventId = `${task.id}-minor@homeguard.app`;
          eventIds.minor = eventId;
          
          icsContent.push(
            'BEGIN:VEVENT',
            `UID:${eventId}`,
            `DTSTAMP:${formatICSDate(new Date())}`,
            `DTSTART;VALUE=DATE:${formatICSDate(minorDate, true)}`,
            `SUMMARY:Minor Maintenance: ${task.title}`,
            `DESCRIPTION:${description.replace(/\n/g, '\\n')}`,
            `CATEGORIES:${task.category}`,
            `STATUS:CONFIRMED`,
            'END:VEVENT'
          );
        }

        // Add event for major maintenance (only if filter is enabled)
        if (includeMajor && nextMaintenance.major) {
          const majorDate = new Date(nextMaintenance.major);
          const majorTasks = task.majorTasks ? JSON.parse(task.majorTasks) : [];
          const description = Array.isArray(majorTasks) && majorTasks.length > 0
            ? majorTasks.join('\\n')
            : task.description || 'Regular major maintenance';
          
          const eventId = `${task.id}-major@homeguard.app`;
          eventIds.major = eventId;
          
          icsContent.push(
            'BEGIN:VEVENT',
            `UID:${eventId}`,
            `DTSTAMP:${formatICSDate(new Date())}`,
            `DTSTART;VALUE=DATE:${formatICSDate(majorDate, true)}`,
            `SUMMARY:Major Maintenance: ${task.title}`,
            `DESCRIPTION:${description.replace(/\n/g, '\\n')}`,
            `CATEGORIES:${task.category}`,
            `STATUS:CONFIRMED`,
            'END:VEVENT'
          );
        }
        
        // Track the export locally (only for events that were actually exported)
        if (provider !== 'generic' && (eventIds.minor || eventIds.major)) {
          trackCalendarExport(task.id, provider, eventIds);
        }
      } catch (error) {
        console.error('Error processing task for ICS:', task.title, error);
      }
    });

    icsContent.push('END:VCALENDAR');

    // Count how many events were exported
    let eventCount = 0;
    tasksWithDates.forEach(task => {
      try {
        const nextMaintenance = JSON.parse(task.nextMaintenanceDate || '{}');
        if (includeMinor && nextMaintenance.minor) eventCount++;
        if (includeMajor && nextMaintenance.major) eventCount++;
      } catch {
        // ignore
      }
    });

    // Create and download the ICS file
    const blob = new Blob([icsContent.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'homeguard-maintenance-schedule.ics');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
    
    const typeText = includeMinor && includeMajor ? "minor and major" : 
                     includeMinor ? "minor" : "major";
    toast({
      title: "Calendar Exported",
      description: `Successfully exported ${eventCount} ${typeText} maintenance events from ${tasksWithDates.length} tasks.`,
    });
  };

  const exportToGoogleCalendar = () => {
    // Validate at least one type is selected
    if (!includeMinor && !includeMajor) {
      alert("Please select at least one maintenance type (Minor or Major) to export.");
      return;
    }

    // For Google Calendar, we'll create multiple events using the Google Calendar URL scheme
    // Since we can't add multiple events at once via URL, we'll open the first event
    // and provide instructions for the ICS method
    
    const tasksWithDates = tasks.filter(task => {
      try {
        const nextMaintenance = task.nextMaintenanceDate ? JSON.parse(task.nextMaintenanceDate) : null;
        if (!nextMaintenance) return false;
        
        const hasMinor = includeMinor && nextMaintenance.minor;
        const hasMajor = includeMajor && nextMaintenance.major;
        return hasMinor || hasMajor;
      } catch {
        return false;
      }
    });

    if (tasksWithDates.length === 0) {
      alert("No tasks with scheduled dates found to export for the selected maintenance types.");
      return;
    }

    // Download ICS file which can be imported to Google Calendar
    const typeText = includeMinor && includeMajor ? "minor and major" : 
                     includeMinor ? "minor" : "major";
    alert(`An ICS file will be downloaded with ${typeText} maintenance events. To import to Google Calendar:\n\n1. Open Google Calendar (calendar.google.com)\n2. Click the '+' next to 'Other calendars'\n3. Select 'Import'\n4. Choose the downloaded .ics file\n5. Click 'Import'\n\nThe events will be tracked here and you can view them in your Google Calendar.`);
    generateICSFile('google');
  };

  const exportToAppleCalendar = () => {
    // Validate at least one type is selected
    if (!includeMinor && !includeMajor) {
      alert("Please select at least one maintenance type (Minor or Major) to export.");
      return;
    }

    // Download ICS file for Apple Calendar
    const typeText = includeMinor && includeMajor ? "minor and major" : 
                     includeMinor ? "minor" : "major";
    alert(`An ICS file with ${typeText} maintenance events will be downloaded. Double-click the file to add events to Apple Calendar.\n\nThe events will be tracked here.`);
    generateICSFile('apple');
  };

  const getCalendarExportsForTask = (task: MaintenanceTask): CalendarExport[] => {
    try {
      return task.calendarExports ? JSON.parse(task.calendarExports) : [];
    } catch {
      return [];
    }
  };

  const hasCalendarExport = (task: MaintenanceTask, provider?: 'google' | 'apple'): boolean => {
    const exports = getCalendarExportsForTask(task);
    if (provider) {
      return exports.some(exp => exp.provider === provider);
    }
    return exports.length > 0;
  };

  const tasksWithExports = tasks.filter(task => hasCalendarExport(task));

  // Helper function to format dates for ICS
  const formatICSDate = (date: Date, dateOnly: boolean = false): string => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    
    if (dateOnly) {
      return `${year}${month}${day}`;
    }
    
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export Schedule</DialogTitle>
          <DialogDescription>
            Choose maintenance types and export destination
          </DialogDescription>
        </DialogHeader>
        
        {/* Maintenance Type Filters */}
        <div className="space-y-3 py-4 border-b">
          <div className="text-sm font-medium text-gray-700 mb-2">Export Settings:</div>
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-2">
              <Checkbox 
                id="include-minor" 
                checked={includeMinor}
                onCheckedChange={(checked) => setIncludeMinor(checked === true)}
              />
              <label
                htmlFor="include-minor"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
              >
                Include Minor Maintenance
              </label>
            </div>
            
            <div className="flex items-center space-x-2">
              <Checkbox 
                id="include-major" 
                checked={includeMajor}
                onCheckedChange={(checked) => setIncludeMajor(checked === true)}
              />
              <label
                htmlFor="include-major"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
              >
                Include Major Maintenance
              </label>
            </div>
          </div>
          {!includeMinor && !includeMajor && (
            <p className="text-xs text-red-600 mt-1">At least one maintenance type must be selected</p>
          )}
        </div>
        
        <div className="space-y-3 py-4">
          <Button
            onClick={exportToGoogleCalendar}
            className="w-full justify-start"
            variant="outline"
            title="Export to Google Calendar (downloads ICS file for import)"
          >
            <Calendar className="w-4 h-4 mr-3" />
            Export to Google Calendar
          </Button>
          
          <Button
            onClick={exportToAppleCalendar}
            className="w-full justify-start"
            variant="outline"
            title="Export to Apple Calendar (downloads ICS file)"
          >
            <Calendar className="w-4 h-4 mr-3" />
            Export to Apple Calendar
          </Button>
          
          <Button
            onClick={() => generateICSFile('generic')}
            className="w-full justify-start"
            variant="outline"
            title="Download ICS file for any calendar application"
          >
            <Download className="w-4 h-4 mr-3" />
            Download ICS File
          </Button>
        </div>
        
        {tasksWithExports.length > 0 && (
          <>
            <div className="border-t pt-4 mt-4">
              <h3 className="text-sm font-semibold mb-3">Exported Tasks ({tasksWithExports.length})</h3>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {tasksWithExports.map(task => {
                  const exports = getCalendarExportsForTask(task);
                  return (
                    <div key={task.id} className="text-xs bg-gray-50 p-2 rounded border">
                      <div className="font-medium text-gray-900">{task.title}</div>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {exports.map((exp, idx) => (
                          <div key={idx} className="flex items-center gap-1">
                            <span className="text-gray-600 capitalize">{exp.provider}:</span>
                            <span className="text-gray-500">
                              {new Date(exp.lastSyncedAt).toLocaleDateString()}
                            </span>
                            {exp.eventIds.minor && (
                              <span className="text-blue-600 text-[10px] ml-1">Minor ✓</span>
                            )}
                            {exp.eventIds.major && (
                              <span className="text-purple-600 text-[10px]">Major ✓</span>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="text-xs text-gray-500 mt-3 p-2 bg-blue-50 rounded">
              <p className="flex items-center gap-1">
                <ExternalLink className="w-3 h-3" />
                To view or edit these events, open your calendar application and search for "HomeGuard" or the task name.
              </p>
            </div>
          </>
        )}
        
        <div className="text-xs text-gray-500 mt-2">
          <p>Only selected maintenance types (minor/major) will be exported.</p>
          <p className="mt-1">ICS files are compatible with most calendar applications.</p>
          <p className="mt-1 font-medium">Exported events are tracked locally for reference.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
