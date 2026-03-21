import { MaintenanceTask } from "@shared/schema";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Calendar, Download, ExternalLink, RefreshCw, X } from "lucide-react";

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
  const [selectedTaskIds, setSelectedTaskIds] = useState<Record<string, boolean>>({});
  const [googleFeedUrl, setGoogleFeedUrl] = useState("");
  const [googleAddByUrlPage, setGoogleAddByUrlPage] = useState("https://calendar.google.com/calendar/u/0/r/settings/addbyurl");

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

  const clearCalendarExports = async (provider?: 'google' | 'apple') => {
    const confirmMessage = provider
      ? `Clear all ${provider.charAt(0).toUpperCase() + provider.slice(1)} calendar export records? This will not delete events from your calendar.`
      : 'Clear all calendar export records for both Google and Apple? This will not delete events from your calendars.';
    
    if (!window.confirm(confirmMessage)) {
      return;
    }

    try {
      let clearedCount = 0;
      const tasksToUpdate = provider 
        ? tasksWithExports.filter(task => hasCalendarExport(task, provider))
        : tasksWithExports;

      for (const task of tasksToUpdate) {
        const existingExports: CalendarExport[] = task.calendarExports ? JSON.parse(task.calendarExports) : [];
        
        let newExports: CalendarExport[];
        if (provider) {
          // Clear only specific provider
          newExports = existingExports.filter(exp => exp.provider !== provider);
        } else {
          // Clear all exports
          newExports = [];
        }

        // Only update if there's a change
        if (newExports.length !== existingExports.length) {
          await updateTaskMutation.mutateAsync({
            taskId: task.id,
            calendarExports: JSON.stringify(newExports),
          });
          clearedCount++;
        }
      }

      toast({
        title: "Export Records Cleared",
        description: `Cleared calendar export records for ${clearedCount} task${clearedCount === 1 ? '' : 's'}.`,
      });
    } catch (error) {
      console.error('Error clearing calendar exports:', error);
      toast({
        title: "Error",
        description: "Failed to clear calendar export records.",
        variant: "destructive",
      });
    }
  };

  const tasksWithDates = tasks.filter(task => {
    try {
      const nextMaintenance = task.nextMaintenanceDate ? JSON.parse(task.nextMaintenanceDate) : null;
      return !!(nextMaintenance && (nextMaintenance.minor || nextMaintenance.major));
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (Object.keys(selectedTaskIds).length === 0 && tasksWithDates.length > 0) {
      const defaults: Record<string, boolean> = {};
      tasksWithDates.forEach(task => {
        defaults[task.id] = true;
      });
      setSelectedTaskIds(defaults);
    }
  }, [tasksWithDates.length, selectedTaskIds]);

  // Keep selection in sync when modal opens/tasks change.
  useEffect(() => {
    if (!isOpen) return;
    const defaults: Record<string, boolean> = {};
    tasksWithDates.forEach(task => {
      defaults[task.id] = selectedTaskIds[task.id] ?? true;
    });
    setSelectedTaskIds(defaults);
  }, [isOpen, tasks.length]);

  const selectedTasks = tasksWithDates.filter(task => selectedTaskIds[task.id]);

  const toggleTaskSelection = (taskId: string) => {
    setSelectedTaskIds(prev => ({
      ...prev,
      [taskId]: !prev[taskId],
    }));
  };

  const toggleSelectAll = () => {
    const allSelected = tasksWithDates.every(task => selectedTaskIds[task.id]);
    const next: Record<string, boolean> = {};
    tasksWithDates.forEach(task => {
      next[task.id] = !allSelected;
    });
    setSelectedTaskIds(next);
  };
  
  const generateICSFile = async (provider: 'google' | 'apple' | 'generic' = 'generic') => {
    // Filter tasks with next maintenance dates
    const tasksWithDates = tasks.filter(task => {
      try {
        const nextMaintenance = task.nextMaintenanceDate ? JSON.parse(task.nextMaintenanceDate) : null;
        return nextMaintenance && (nextMaintenance.minor || nextMaintenance.major);
      } catch {
        return false;
      }
    });

    if (tasksWithDates.length === 0) {
      alert("No tasks with scheduled dates found to export.");
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
        const today = new Date();
        today.setHours(0, 0, 0, 0); // Reset to start of day for comparison
        
        // Track event IDs for local reference
        const eventIds: { minor?: string; major?: string } = {};
        
        // Check if task has filter properties (from dashboard)
        const taskWithFilters = task as any;
        const shouldExportMinor = taskWithFilters.showMinor !== false; // default to true if property doesn't exist
        const shouldExportMajor = taskWithFilters.showMajor !== false; // default to true if property doesn't exist
        
        // Add event for minor maintenance (only if it should be shown)
        if (nextMaintenance.minor && shouldExportMinor) {
          let minorDate = new Date(nextMaintenance.minor);
          // If the date is in the past, use today instead
          if (minorDate < today) {
            minorDate = new Date(today);
          }
          
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

        // Add event for major maintenance (only if it should be shown)
        if (nextMaintenance.major && shouldExportMajor) {
          let majorDate = new Date(nextMaintenance.major);
          // If the date is in the past, use today instead
          if (majorDate < today) {
            majorDate = new Date(today);
          }
          
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
        
        // Track the export locally (only for events that were exported)
        if (provider !== 'generic' && (eventIds.minor || eventIds.major)) {
          trackCalendarExport(task.id, provider, eventIds);
        }
      } catch (error) {
        console.error('Error processing task for ICS:', task.title, error);
      }
    });

    icsContent.push('END:VCALENDAR');

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
    
    toast({
      title: "Calendar Exported",
      description: `Successfully exported ${tasksWithDates.length} maintenance tasks.`,
    });
  };

  const exportToGoogleCalendar = async () => {
    if (selectedTasks.length === 0) {
      toast({
        title: "No tasks selected",
        description: "Select at least one task to create a Google subscription feed.",
        variant: "destructive",
      });
      return;
    }

    const selections = selectedTasks.map(task => {
      let includeMinor = false;
      let includeMajor = false;
      try {
        const nextMaintenance = task.nextMaintenanceDate ? JSON.parse(task.nextMaintenanceDate) : {};
        const taskWithFilters = task as any;
        includeMinor = !!nextMaintenance?.minor && taskWithFilters.showMinor !== false;
        includeMajor = !!nextMaintenance?.major && taskWithFilters.showMajor !== false;
      } catch {
        includeMinor = false;
        includeMajor = false;
      }

      return {
        taskId: task.id,
        includeMinor,
        includeMajor,
      };
    }).filter(s => s.includeMinor || s.includeMajor);

    if (selections.length === 0) {
      toast({
        title: "No schedulable events",
        description: "Selected tasks do not have upcoming minor/major dates to subscribe.",
        variant: "destructive",
      });
      return;
    }

    try {
      const response = await apiRequest("POST", "/api/calendar/google/feed-token", { selections });
      const data = await response.json();
      const feedUrl: string = data.feedUrlIcs || data.feedUrl;
      const googleSubscribeUrlFallback: string = data.googleSubscribeUrlFallback || "https://calendar.google.com/calendar/u/0/r/settings/addbyurl";
      const isLikelyPrivateUrl: boolean = !!data.isLikelyPrivateUrl;
      const estimatedEventCount: number = Number(data.estimatedEventCount || 0);
      const missingTaskCount: number = Number(data.missingTaskCount || 0);

      // Track this as a Google export for selected tasks.
      for (const sel of selections) {
        await trackCalendarExport(
          sel.taskId,
          "google",
          {
            minor: sel.includeMinor ? "feed" : undefined,
            major: sel.includeMajor ? "feed" : undefined,
          },
          {
            minor: feedUrl,
            major: feedUrl,
          },
        );
      }

      try {
        await navigator.clipboard.writeText(feedUrl);
      } catch {
        // Clipboard can fail in non-secure contexts; continue with link open.
      }

      setGoogleFeedUrl(feedUrl);
      setGoogleAddByUrlPage(googleSubscribeUrlFallback);

      toast({
        title: "Google Feed Ready",
        description: `Feed URL is ready for ${selections.length} selected task${selections.length === 1 ? "" : "s"}. Copy it first, then open Google Add by URL.`,
      });

      toast({
        title: "Feed Diagnostics",
        description: `Estimated events: ${estimatedEventCount}. Missing/invalid tasks: ${missingTaskCount}.`,
      });

      if (estimatedEventCount === 0) {
        toast({
          title: "Feed Contains 0 Events",
          description:
            "The current selection did not produce any schedulable minor/major dates. Adjust filters or selected tasks, then try again.",
          variant: "destructive",
        });
      }

      toast({
        title: "Paste URL In Google",
        description:
          "Paste the copied feed URL into Google Calendar's Add by URL field. This is more reliable than prefilled Google links.",
      });

      if (isLikelyPrivateUrl) {
        toast({
          title: "Public URL Required",
          description:
            "The feed URL looks local/private (for example localhost/LAN). Google Calendar cannot fetch it. Set PUBLIC_BASE_URL to a publicly reachable HTTPS domain or use a tunnel.",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error?.message || "Failed to create Google subscription feed.",
        variant: "destructive",
      });
    }
  };

  const exportToAppleCalendar = () => {
    // Download ICS file for Apple Calendar
    alert("An ICS file will be downloaded. Double-click the file to add events to Apple Calendar.\n\nThe events will be tracked here.");
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
            Choose how you'd like to export your maintenance schedule
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-3 py-4">
          {tasksWithDates.length > 0 && (
            <div className="border rounded-md p-3 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Select Schedule Items ({tasksWithDates.length})</h3>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={toggleSelectAll}
                  className="h-7 px-2 text-xs"
                >
                  {tasksWithDates.every(task => selectedTaskIds[task.id]) ? "Clear All" : "Select All"}
                </Button>
              </div>
              <div className="max-h-36 overflow-y-auto space-y-1">
                {tasksWithDates.map(task => (
                  <label key={task.id} className="flex items-center gap-2 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={!!selectedTaskIds[task.id]}
                      onChange={() => toggleTaskSelection(task.id)}
                    />
                    <span className="truncate">{task.title}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <Button
            onClick={exportToGoogleCalendar}
            className="w-full justify-start"
            variant="outline"
            title="Subscribe selected tasks in Google Calendar via HomeGuard feed"
          >
            <Calendar className="w-4 h-4 mr-3" />
            Subscribe in Google Calendar (Selected)
          </Button>

          {googleFeedUrl && (
            <div className="border rounded-md p-3 space-y-2 bg-blue-50/50">
              <p className="text-xs text-gray-700">
                Step 1: Copy this feed URL. Step 2: Open Google Add by URL and paste it.
              </p>
              <input
                value={googleFeedUrl}
                readOnly
                className="w-full text-xs rounded border bg-white px-2 py-1"
                aria-label="Google calendar feed URL"
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="flex-1"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(googleFeedUrl);
                      toast({ title: "Copied", description: "Feed URL copied to clipboard." });
                    } catch {
                      toast({
                        title: "Copy Failed",
                        description: "Clipboard access failed. Select and copy the URL manually.",
                        variant: "destructive",
                      });
                    }
                  }}
                >
                  Copy Feed URL
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="flex-1"
                  onClick={() => window.open(googleAddByUrlPage, "_blank", "noopener,noreferrer")}
                >
                  <ExternalLink className="w-3 h-3 mr-1" />
                  Open Google Page
                </Button>
              </div>
            </div>
          )}
          
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
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold">Exported Tasks ({tasksWithExports.length})</h3>
                <div className="flex gap-2">
                  {tasksWithExports.some(task => hasCalendarExport(task, 'google')) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => clearCalendarExports('google')}
                      className="h-7 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                      title="Clear all Google Calendar export records"
                    >
                      <X className="w-3 h-3 mr-1" />
                      Clear Google
                    </Button>
                  )}
                  {tasksWithExports.some(task => hasCalendarExport(task, 'apple')) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => clearCalendarExports('apple')}
                      className="h-7 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                      title="Clear all Apple Calendar export records"
                    >
                      <X className="w-3 h-3 mr-1" />
                      Clear Apple
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => clearCalendarExports()}
                    className="h-7 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                    title="Clear all calendar export records"
                  >
                    <X className="w-3 h-3 mr-1" />
                    Clear All
                  </Button>
                </div>
              </div>
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
              <p className="mt-2 text-amber-600">
                ⚠️ Clearing records here does NOT delete events from your calendar. You must manually delete them in your calendar app.
              </p>
            </div>
          </>
        )}
        
        <div className="text-xs text-gray-500 mt-2">
          <p>Google subscription uses your selected items and keeps calendar updates synced from HomeGuard.</p>
          <p className="mt-1">ICS files are compatible with most calendar applications.</p>
          <p className="mt-1 font-medium">Exported events are tracked locally for reference.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
