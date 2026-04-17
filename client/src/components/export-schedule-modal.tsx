import {
  type CalendarExportRecord,
  type MaintenanceTask,
  normalizeCalendarExports,
  serializeCalendarExports,
} from "@shared/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
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

interface GoogleCalendarSyncStatus {
  configured: boolean;
  connected: boolean;
  accountEmail: string | null;
  calendarId: string | null;
  lastSyncedAt: string | null;
}

type CalendarProvider = "google" | "apple";
type CalendarSyncMode = "subscription" | "direct" | "file";

function formatICSDate(date: Date, dateOnly: boolean = false): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  if (dateOnly) {
    return `${year}${month}${day}`;
  }

  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  const seconds = String(date.getSeconds()).padStart(2, "0");
  return `${year}${month}${day}T${hours}${minutes}${seconds}Z`;
}

export default function ExportScheduleModal({ isOpen, onClose, tasks }: ExportScheduleModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedTaskIds, setSelectedTaskIds] = useState<Record<string, boolean>>({});
  const [googleFeedUrl, setGoogleFeedUrl] = useState("");
  const [googleAddByUrlPage, setGoogleAddByUrlPage] = useState("https://calendar.google.com/calendar/u/0/r/settings/addbyurl");
  const [appleFeedUrl, setAppleFeedUrl] = useState("");

  const googleSyncStatusQuery = useQuery<GoogleCalendarSyncStatus>({
    queryKey: ["/api/calendar/google/sync/status"],
    enabled: isOpen,
    retry: false,
  });

  const updateTaskMutation = useMutation({
    mutationFn: async ({ taskId, calendarExports }: { taskId: string; calendarExports: string | null }) => {
      const response = await apiRequest("PATCH", `/api/tasks/${taskId}`, { calendarExports });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
    },
  });

  const connectGoogleMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/calendar/google/sync/start", {
        returnPath: `${window.location.pathname}${window.location.search}`,
      });
      return response.json() as Promise<{ authorizationUrl: string }>;
    },
    onSuccess: ({ authorizationUrl }) => {
      window.location.assign(authorizationUrl);
    },
    onError: (error: any) => {
      toast({
        title: "Google Connect Failed",
        description: error?.message || "Unable to start Google Calendar authorization.",
        variant: "destructive",
      });
    },
  });

  const disconnectGoogleMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/calendar/google/disconnect", {});
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/calendar/google/sync/status"] });
      toast({
        title: "Google Calendar Disconnected",
        description: "Two-way sync has been disabled for this account.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Disconnect Failed",
        description: error?.message || "Unable to disconnect Google Calendar.",
        variant: "destructive",
      });
    },
  });

  const tasksWithDates = useMemo(
    () =>
      tasks.filter((task) => {
        try {
          const nextMaintenance = task.nextMaintenanceDate ? JSON.parse(task.nextMaintenanceDate) : null;
          return !!(nextMaintenance && (nextMaintenance.minor || nextMaintenance.major));
        } catch {
          return false;
        }
      }),
    [tasks],
  );

  useEffect(() => {
    if (Object.keys(selectedTaskIds).length === 0 && tasksWithDates.length > 0) {
      const defaults: Record<string, boolean> = {};
      tasksWithDates.forEach((task) => {
        defaults[task.id] = true;
      });
      setSelectedTaskIds(defaults);
    }
  }, [selectedTaskIds, tasksWithDates]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const defaults: Record<string, boolean> = {};
    tasksWithDates.forEach((task) => {
      defaults[task.id] = selectedTaskIds[task.id] ?? true;
    });
    setSelectedTaskIds(defaults);
  }, [isOpen, selectedTaskIds, tasksWithDates]);

  const selectedTasks = tasksWithDates.filter((task) => selectedTaskIds[task.id]);

  const buildSelections = () => {
    return selectedTasks
      .map((task) => {
        let includeMinor = false;
        let includeMajor = false;

        try {
          const nextMaintenance = task.nextMaintenanceDate ? JSON.parse(task.nextMaintenanceDate) : {};
          const taskWithFilters = task as MaintenanceTask & { showMinor?: boolean; showMajor?: boolean };
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
      })
      .filter((selection) => selection.includeMinor || selection.includeMajor);
  };

  const googleTwoWaySyncMutation = useMutation({
    mutationFn: async () => {
      const selections = buildSelections();
      if (selections.length === 0) {
        throw new Error("Select at least one task with an upcoming maintenance date.");
      }

      const response = await apiRequest("POST", "/api/calendar/google/sync", { selections });
      return response.json() as Promise<{
        syncedTasks: number;
        pushedEvents: number;
        pulledChanges: number;
        createdEvents: number;
        updatedEvents: number;
        completedFromGoogle?: number;
      }>;
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/calendar/google/sync/status"] }),
      ]);

      toast({
        title: "Google Calendar Synced",
        description: `Synced ${result.syncedTasks} task${result.syncedTasks === 1 ? "" : "s"}. Pushed ${result.pushedEvents} event${result.pushedEvents === 1 ? "" : "s"}, pulled ${result.pulledChanges} change${result.pulledChanges === 1 ? "" : "s"}, completed ${result.completedFromGoogle ?? 0} from Google.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Google Sync Failed",
        description: error?.message || "Unable to sync with Google Calendar.",
        variant: "destructive",
      });
    },
  });

  const getCalendarExportsForTask = (task: MaintenanceTask): CalendarExportRecord[] => {
    return normalizeCalendarExports(task.calendarExports);
  };

  const hasCalendarExport = (task: MaintenanceTask, provider?: CalendarProvider): boolean => {
    const exports = getCalendarExportsForTask(task);
    if (provider) {
      return exports.some((record) => record.provider === provider);
    }
    return exports.length > 0;
  };

  const tasksWithExports = tasks.filter((task) => hasCalendarExport(task));

  const trackCalendarExport = async (
    taskId: string,
    provider: CalendarProvider,
    syncMode: CalendarSyncMode,
    eventIds: { minor?: string; major?: string },
    eventLinks?: { minor?: string; major?: string },
  ) => {
    try {
      const task = tasks.find((entry) => entry.id === taskId);
      if (!task) {
        return;
      }

      const existing = normalizeCalendarExports(task.calendarExports).filter(
        (record) => !(record.provider === provider && (record.syncMode ?? "subscription") === syncMode),
      );

      existing.push({
        provider,
        syncMode,
        eventIds,
        eventLinks,
        lastSyncedAt: new Date().toISOString(),
      });

      await updateTaskMutation.mutateAsync({
        taskId,
        calendarExports: serializeCalendarExports(existing),
      });
    } catch (error) {
      console.error("Error tracking calendar export:", error);
    }
  };

  const clearCalendarExports = async (provider?: CalendarProvider) => {
    const confirmMessage = provider
      ? `Clear all ${provider.charAt(0).toUpperCase() + provider.slice(1)} calendar export records? This will not delete events from your calendar.`
      : "Clear all calendar export records for both Google and Apple? This will not delete events from your calendars.";

    if (!window.confirm(confirmMessage)) {
      return;
    }

    try {
      let clearedCount = 0;
      const tasksToUpdate = provider ? tasksWithExports.filter((task) => hasCalendarExport(task, provider)) : tasksWithExports;

      for (const task of tasksToUpdate) {
        const existing = normalizeCalendarExports(task.calendarExports);
        const next = provider ? existing.filter((record) => record.provider !== provider) : [];

        if (next.length !== existing.length) {
          await updateTaskMutation.mutateAsync({
            taskId: task.id,
            calendarExports: serializeCalendarExports(next),
          });
          clearedCount++;
        }
      }

      toast({
        title: "Export Records Cleared",
        description: `Cleared calendar export records for ${clearedCount} task${clearedCount === 1 ? "" : "s"}.`,
      });
    } catch (error) {
      console.error("Error clearing calendar exports:", error);
      toast({
        title: "Error",
        description: "Failed to clear calendar export records.",
        variant: "destructive",
      });
    }
  };

  const toggleTaskSelection = (taskId: string) => {
    setSelectedTaskIds((prev) => ({
      ...prev,
      [taskId]: !prev[taskId],
    }));
  };

  const toggleSelectAll = () => {
    const allSelected = tasksWithDates.every((task) => selectedTaskIds[task.id]);
    const next: Record<string, boolean> = {};
    tasksWithDates.forEach((task) => {
      next[task.id] = !allSelected;
    });
    setSelectedTaskIds(next);
  };

  const generateICSFile = async (provider: CalendarProvider | "generic" = "generic") => {
    if (tasksWithDates.length === 0) {
      alert("No tasks with scheduled dates found to export.");
      return;
    }

    const icsContent = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//SimpleHome//Maintenance Schedule//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:SimpleHome Maintenance Schedule",
      "X-WR-TIMEZONE:UTC",
    ];

    tasksWithDates.forEach((task) => {
      try {
        const nextMaintenance = JSON.parse(task.nextMaintenanceDate || "{}");
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const eventIds: { minor?: string; major?: string } = {};
        const taskWithFilters = task as MaintenanceTask & { showMinor?: boolean; showMajor?: boolean };
        const shouldExportMinor = taskWithFilters.showMinor !== false;
        const shouldExportMajor = taskWithFilters.showMajor !== false;

        if (nextMaintenance.minor && shouldExportMinor) {
          let minorDate = new Date(nextMaintenance.minor);
          if (minorDate < today) {
            minorDate = new Date(today);
          }

          const minorTasks = task.minorTasks ? JSON.parse(task.minorTasks) : [];
          const description = Array.isArray(minorTasks) && minorTasks.length > 0 ? minorTasks.join("\\n") : task.description || "Regular minor maintenance";
          const eventId = `${task.id}-minor@simplehome.app`;
          eventIds.minor = eventId;

          icsContent.push(
            "BEGIN:VEVENT",
            `UID:${eventId}`,
            `DTSTAMP:${formatICSDate(new Date())}`,
            `DTSTART;VALUE=DATE:${formatICSDate(minorDate, true)}`,
            `SUMMARY:Minor Maintenance: ${task.title}`,
            `DESCRIPTION:${description.replace(/\n/g, "\\n")}`,
            `CATEGORIES:${task.category}`,
            "STATUS:CONFIRMED",
            "END:VEVENT",
          );
        }

        if (nextMaintenance.major && shouldExportMajor) {
          let majorDate = new Date(nextMaintenance.major);
          if (majorDate < today) {
            majorDate = new Date(today);
          }

          const majorTasks = task.majorTasks ? JSON.parse(task.majorTasks) : [];
          const description = Array.isArray(majorTasks) && majorTasks.length > 0 ? majorTasks.join("\\n") : task.description || "Regular major maintenance";
          const eventId = `${task.id}-major@simplehome.app`;
          eventIds.major = eventId;

          icsContent.push(
            "BEGIN:VEVENT",
            `UID:${eventId}`,
            `DTSTAMP:${formatICSDate(new Date())}`,
            `DTSTART;VALUE=DATE:${formatICSDate(majorDate, true)}`,
            `SUMMARY:Major Maintenance: ${task.title}`,
            `DESCRIPTION:${description.replace(/\n/g, "\\n")}`,
            `CATEGORIES:${task.category}`,
            "STATUS:CONFIRMED",
            "END:VEVENT",
          );
        }

        if (provider !== "generic" && (eventIds.minor || eventIds.major)) {
          void trackCalendarExport(task.id, provider, provider === "apple" ? "file" : "subscription", eventIds);
        }
      } catch (error) {
        console.error("Error processing task for ICS:", task.title, error);
      }
    });

    icsContent.push("END:VCALENDAR");

    const blob = new Blob([icsContent.join("\r\n")], { type: "text/calendar;charset=utf-8" });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", "simplehome-maintenance-schedule.ics");
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
    const selections = buildSelections();
    if (selections.length === 0) {
      toast({
        title: "No schedulable events",
        description: "Selected tasks do not have upcoming minor or major dates to subscribe.",
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

      for (const selection of selections) {
        await trackCalendarExport(
          selection.taskId,
          "google",
          "subscription",
          {
            minor: selection.includeMinor ? "feed" : undefined,
            major: selection.includeMajor ? "feed" : undefined,
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
        // Continue without clipboard access.
      }

      setGoogleFeedUrl(feedUrl);
      setGoogleAddByUrlPage(googleSubscribeUrlFallback);

      toast({
        title: "Google Feed Ready",
        description: `Feed URL is ready for ${selections.length} selected task${selections.length === 1 ? "" : "s"}. Copy it first, then open Google Add by URL.`,
      });

      toast({
        title: "Feed Diagnostics",
        description: `Estimated events: ${estimatedEventCount}. Missing or invalid tasks: ${missingTaskCount}.`,
      });

      if (estimatedEventCount === 0) {
        toast({
          title: "Feed Contains 0 Events",
          description: "The current selection did not produce any schedulable minor or major dates. Adjust filters or selections, then try again.",
          variant: "destructive",
        });
      }

      if (isLikelyPrivateUrl) {
        toast({
          title: "Public URL Required",
          description: "The feed URL looks local or private. Google Calendar cannot fetch it. Set PUBLIC_BASE_URL to a publicly reachable HTTPS domain or use a tunnel.",
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
    alert("An ICS file will be downloaded. Double-click the file to add events to Apple Calendar. The events will also be tracked here.");
    void generateICSFile("apple");
  };

  const exportToAppleCalendarSubscription = async () => {
    const selections = buildSelections();
    if (selections.length === 0) {
      toast({
        title: "No schedulable events",
        description: "Selected tasks do not have upcoming minor or major dates to subscribe.",
        variant: "destructive",
      });
      return;
    }

    try {
      const response = await apiRequest("POST", "/api/calendar/apple/feed-token", { selections });
      const data = await response.json();
      const feedUrl: string = data.feedUrlIcs || data.feedUrl;
      const isLikelyPrivateUrl: boolean = !!data.isLikelyPrivateUrl;
      const estimatedEventCount: number = Number(data.estimatedEventCount || 0);
      const missingTaskCount: number = Number(data.missingTaskCount || 0);

      for (const selection of selections) {
        await trackCalendarExport(
          selection.taskId,
          "apple",
          "subscription",
          {
            minor: selection.includeMinor ? "feed" : undefined,
            major: selection.includeMajor ? "feed" : undefined,
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
        // Continue without clipboard access.
      }

      setAppleFeedUrl(feedUrl);

      toast({
        title: "Apple Feed Ready",
        description: `Feed URL is ready for ${selections.length} selected task${selections.length === 1 ? "" : "s"}. Copy it first, then open Apple Calendar to subscribe.`,
      });

      toast({
        title: "Feed Diagnostics",
        description: `Estimated events: ${estimatedEventCount}. Missing or invalid tasks: ${missingTaskCount}.`,
      });

      if (estimatedEventCount === 0) {
        toast({
          title: "Feed Contains 0 Events",
          description: "The current selection did not produce any schedulable minor or major dates. Adjust filters or selections, then try again.",
          variant: "destructive",
        });
      }

      if (isLikelyPrivateUrl) {
        toast({
          title: "Public URL Required",
          description: "The feed URL looks local or private. Apple Calendar cannot fetch it. Set PUBLIC_BASE_URL to a publicly reachable HTTPS domain or use a tunnel.",
          variant: "destructive",
        });
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error?.message || "Failed to create Apple subscription feed.",
        variant: "destructive",
      });
    }
  };

  const googleStatus = googleSyncStatusQuery.data;
  const googleStatusErrorMessage = useMemo(() => {
    const error = googleSyncStatusQuery.error;
    if (!error) {
      return "Unable to load Google Calendar sync status.";
    }

    const message = error instanceof Error ? error.message : String(error);
    if (message.startsWith("401:")) {
      return "Your session is not authenticated. Sign in again, then reopen this modal.";
    }

    return message;
  }, [googleSyncStatusQuery.error]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export Schedule</DialogTitle>
          <DialogDescription>
            Export via subscriptions and files, or connect Google Calendar for two-way sync.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-4">
          {tasksWithDates.length > 0 && (
            <div className="border rounded-md p-3 space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Select Schedule Items ({tasksWithDates.length})</h3>
                <Button type="button" variant="ghost" size="sm" onClick={toggleSelectAll} className="h-7 px-2 text-xs">
                  {tasksWithDates.every((task) => selectedTaskIds[task.id]) ? "Clear All" : "Select All"}
                </Button>
              </div>
              <div className="max-h-36 overflow-y-auto space-y-1">
                {tasksWithDates.map((task) => (
                  <label key={task.id} className="flex items-center gap-2 text-xs cursor-pointer">
                    <input type="checkbox" checked={!!selectedTaskIds[task.id]} onChange={() => toggleTaskSelection(task.id)} />
                    <span className="truncate">{task.title}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="border rounded-md p-3 space-y-3 bg-amber-50/60">
            <div>
              <h3 className="text-sm font-semibold">Google Two-Way Sync</h3>
              <p className="text-xs text-gray-700 mt-1">
                Sync selected tasks into a dedicated SimpleHome Google calendar. Running sync again also pulls Google date edits back into SimpleHome.
              </p>
            </div>

            {googleSyncStatusQuery.isLoading ? (
              <p className="text-xs text-gray-600">Loading Google Calendar sync status...</p>
            ) : googleSyncStatusQuery.isError ? (
              <div className="text-xs text-red-800 bg-white/70 border border-red-200 rounded p-2 space-y-1">
                <p className="font-medium">Could not read Google sync status.</p>
                <p>{googleStatusErrorMessage}</p>
              </div>
            ) : !googleStatus?.configured ? (
              <div className="text-xs text-amber-800 bg-white/70 border border-amber-200 rounded p-2 space-y-1">
                <p className="font-medium">Google Calendar sync is not configured on the server.</p>
                <p>Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, and make sure PUBLIC_BASE_URL points to a reachable HTTPS URL.</p>
              </div>
            ) : !googleStatus.connected ? (
              <Button type="button" onClick={() => connectGoogleMutation.mutate()} className="w-full justify-start" variant="outline">
                <Calendar className="w-4 h-4 mr-3" />
                {connectGoogleMutation.isPending ? "Opening Google OAuth..." : "Connect Google Calendar"}
              </Button>
            ) : (
              <div className="space-y-2">
                <div className="text-xs text-gray-700 bg-white/70 border rounded p-2 space-y-1">
                  <p>
                    Connected as <span className="font-medium">{googleStatus.accountEmail || "Google account"}</span>
                  </p>
                  <p>
                    Last synced: {googleStatus.lastSyncedAt ? new Date(googleStatus.lastSyncedAt).toLocaleString() : "Never"}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    onClick={() => googleTwoWaySyncMutation.mutate()}
                    className="flex-1 justify-start"
                    variant="outline"
                    disabled={googleTwoWaySyncMutation.isPending || selectedTasks.length === 0}
                  >
                    <RefreshCw className="w-4 h-4 mr-3" />
                    {googleTwoWaySyncMutation.isPending ? "Syncing..." : "Sync Selected Two-Way"}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => disconnectGoogleMutation.mutate()}
                    variant="ghost"
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                    disabled={disconnectGoogleMutation.isPending}
                  >
                    <X className="w-4 h-4 mr-2" />
                    Disconnect
                  </Button>
                </div>
              </div>
            )}
          </div>

          <Button onClick={exportToGoogleCalendar} className="w-full justify-start" variant="outline" title="Subscribe selected tasks in Google Calendar via SimpleHome feed">
            <Calendar className="w-4 h-4 mr-3" />
            Subscribe in Google Calendar (Selected)
          </Button>

          {googleFeedUrl && (
            <div className="border rounded-md p-3 space-y-2 bg-blue-50/50">
              <p className="text-xs text-gray-700">Step 1: Copy this feed URL. Step 2: Open Google Add by URL and paste it.</p>
              <input value={googleFeedUrl} readOnly className="w-full text-xs rounded border bg-white px-2 py-1" aria-label="Google calendar feed URL" />
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
                <Button type="button" size="sm" variant="outline" className="flex-1" onClick={() => window.open(googleAddByUrlPage, "_blank", "noopener,noreferrer")}>
                  <ExternalLink className="w-3 h-3 mr-1" />
                  Open Google Page
                </Button>
              </div>
            </div>
          )}

          <Button onClick={exportToAppleCalendarSubscription} className="w-full justify-start" variant="outline" title="Subscribe selected tasks in Apple Calendar via SimpleHome feed">
            <Calendar className="w-4 h-4 mr-3" />
            Subscribe in Apple Calendar (Selected)
          </Button>

          {appleFeedUrl && (
            <div className="border rounded-md p-3 space-y-2 bg-green-50/50">
              <p className="text-xs text-gray-700 font-medium">Apple Calendar Subscription Ready</p>
              <input value={appleFeedUrl} readOnly className="w-full text-xs rounded border bg-white px-2 py-1" aria-label="Apple calendar feed URL" />
              <div className="text-xs text-gray-600 bg-white p-2 rounded border border-dashed">
                <p className="font-medium mb-1">How to subscribe:</p>
                <ol className="list-decimal list-inside space-y-1">
                  <li>Feed URL is already copied to clipboard</li>
                  <li>Open Apple Calendar on Mac or iOS</li>
                  <li>Go to File {">"} Add Calendar {">"} Subscribe... (Mac) or tap + {">"} Add Subscription (iOS)</li>
                  <li>Paste the feed URL</li>
                  <li>Choose a calendar and click Subscribe</li>
                </ol>
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  className="flex-1"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(appleFeedUrl);
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
              </div>
            </div>
          )}

          <Button onClick={exportToAppleCalendar} className="w-full justify-start" variant="outline" title="Export to Apple Calendar (downloads ICS file)">
            <Calendar className="w-4 h-4 mr-3" />
            Export to Apple Calendar (File)
          </Button>

          <Button onClick={() => void generateICSFile("generic")} className="w-full justify-start" variant="outline" title="Download ICS file for any calendar application">
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
                  {tasksWithExports.some((task) => hasCalendarExport(task, "google")) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void clearCalendarExports("google")}
                      className="h-7 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                      title="Clear all Google Calendar export records"
                    >
                      <X className="w-3 h-3 mr-1" />
                      Clear Google
                    </Button>
                  )}
                  {tasksWithExports.some((task) => hasCalendarExport(task, "apple")) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => void clearCalendarExports("apple")}
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
                    onClick={() => void clearCalendarExports()}
                    className="h-7 px-2 text-xs text-red-600 hover:text-red-700 hover:bg-red-50"
                    title="Clear all calendar export records"
                  >
                    <X className="w-3 h-3 mr-1" />
                    Clear All
                  </Button>
                </div>
              </div>
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {tasksWithExports.map((task) => {
                  const records = getCalendarExportsForTask(task);
                  return (
                    <div key={task.id} className="text-xs bg-gray-50 p-2 rounded border">
                      <div className="font-medium text-gray-900">{task.title}</div>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {records.map((record, index) => (
                          <div key={`${task.id}-${record.provider}-${record.syncMode || "subscription"}-${index}`} className="flex items-center gap-1">
                            <span className="text-gray-600 capitalize">
                              {record.provider}
                              {record.syncMode === "direct" ? " sync" : record.syncMode === "file" ? " file" : " sub"}:
                            </span>
                            <span className="text-gray-500">{new Date(record.lastSyncedAt).toLocaleDateString()}</span>
                            {record.eventIds.minor && <span className="text-blue-600 text-[10px] ml-1">Minor ✓</span>}
                            {record.eventIds.major && <span className="text-purple-600 text-[10px]">Major ✓</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            <div className="text-xs text-gray-500 mt-3 p-2 bg-blue-50 rounded space-y-2">
              <p className="flex items-center gap-1">
                <ExternalLink className="w-3 h-3" />
                Open your calendar application and search for SimpleHome or the task name to inspect synced events.
              </p>
              <p className="text-amber-600">
                Clearing records here does not delete events from Google Calendar or Apple Calendar. Remove those events in the calendar app if you no longer want them.
              </p>
            </div>
          </>
        )}

        <div className="text-xs text-gray-500 mt-2 space-y-1">
          <p>Google two-way sync requires server-side OAuth credentials and a public HTTPS callback URL.</p>
          <p>Google and Apple subscription feeds remain one-way from SimpleHome into the calendar app.</p>
          <p>ICS file exports are compatible with most calendar applications.</p>
          <p>For subscription feeds, make sure PUBLIC_BASE_URL is set to a publicly reachable HTTPS domain.</p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
