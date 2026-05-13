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
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  activeScopeCount?: number;
  syncScopeVersion?: number;
  syncScopeUpdatedAt?: string | null;
}

interface GoogleCalendarSyncScope {
  selections: Array<{
    taskId: string;
    includeMinor: boolean;
    includeMajor: boolean;
  }>;
  count: number;
}

interface DisconnectGoogleCalendarResponse {
  disconnected: boolean;
  calendarDeleteRequested: boolean;
  calendarDeleted: boolean;
  calendarDeleteMessage: string | null;
}

interface AppleCalendarSyncStatus {
  configured: boolean;
  connected: boolean;
  accountEmail: string | null;
  calendarId: string | null;
  lastSyncedAt: string | null;
  activeScopeCount?: number;
  syncScopeVersion?: number;
  syncScopeUpdatedAt?: string | null;
}

interface AppleCalendarSyncScope {
  selections: Array<{
    taskId: string;
    includeMinor: boolean;
    includeMajor: boolean;
  }>;
  count: number;
}

interface DisconnectAppleCalendarResponse {
  disconnected: boolean;
  calendarDeleteRequested: boolean;
  calendarDeleted: boolean;
  calendarDeleteMessage: string | null;
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

type ExportProvider = "google" | "apple";

// ========== Scope Picker Component ==========
interface ExportScopePickerProps {
  tasksWithDates: MaintenanceTask[];
  selectedTaskIds: Record<string, boolean>;
  onToggleTask: (taskId: string) => void;
  onToggleSelectAll: () => void;
}

function ExportScopePicker({
  tasksWithDates,
  selectedTaskIds,
  onToggleTask,
  onToggleSelectAll,
}: ExportScopePickerProps) {
  if (tasksWithDates.length === 0) {
    return null;
  }

  return (
    <div className="border rounded-md p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold">Select Schedule Items ({tasksWithDates.length})</h3>
        <Button type="button" variant="ghost" size="sm" onClick={onToggleSelectAll} className="h-7 px-2 text-xs">
          {tasksWithDates.every((task) => selectedTaskIds[task.id]) ? "Clear All" : "Select All"}
        </Button>
      </div>
      <div className="max-h-36 overflow-y-auto space-y-1">
        {tasksWithDates.map((task) => (
          <label key={task.id} className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={!!selectedTaskIds[task.id]} onChange={() => onToggleTask(task.id)} />
            <span className="truncate">{task.title}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

// ========== Selection Summary Component ==========
interface SelectionSummaryProps {
  tasksWithDates: MaintenanceTask[];
  selectedTaskIds: Record<string, boolean>;
}

function SelectionSummary({ tasksWithDates, selectedTaskIds }: SelectionSummaryProps) {
  const selectedCount = Object.values(selectedTaskIds).filter(Boolean).length;
  const selectedTasks = tasksWithDates.filter((task) => selectedTaskIds[task.id]);

  if (tasksWithDates.length === 0) {
    return null;
  }

  return (
    <div className="border rounded-md p-3 space-y-2 bg-blue-50/60 border-blue-200">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-blue-900">
          Selection: {selectedCount} of {tasksWithDates.length} items
        </h3>
        {selectedCount === 0 && <span className="text-xs text-blue-700 font-medium">No items selected</span>}
      </div>
      {selectedCount > 0 && (
        <div className="max-h-28 overflow-y-auto space-y-1">
          {selectedTasks.map((task) => (
            <div key={task.id} className="text-xs text-blue-800 bg-white/70 rounded px-2 py-1">
              {task.title}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ========== Export Card Component ==========
interface ExportCardProps {
  title: string;
  description: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  variant?: "default" | "success" | "warning" | "error";
}

function ExportCard({
  title,
  description,
  icon,
  children,
  variant = "default",
}: ExportCardProps) {
  const bgClass = {
    default: "bg-gray-50/60 border-gray-200",
    success: "bg-green-50/60 border-green-200",
    warning: "bg-amber-50/60 border-amber-200",
    error: "bg-red-50/60 border-red-200",
  }[variant];

  return (
    <div className={`border rounded-md p-3 space-y-2 ${bgClass}`}>
      <div className="flex items-start gap-2">
        <div className="text-lg mt-0.5">{icon}</div>
        <div className="flex-1">
          <h4 className="text-sm font-semibold">{title}</h4>
          <p className="text-xs text-gray-700">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

// ========== Google Export Panel Component ==========
interface GoogleExportPanelProps {
  tasksWithDates: MaintenanceTask[];
  selectedTaskIds: Record<string, boolean>;
  googleSyncStatus: GoogleCalendarSyncStatus | undefined;
  googleSyncScopeQuery: any;
  googleSyncStatusQuery: any;
  buildSelections: () => Array<{ taskId: string; includeMinor: boolean; includeMajor: boolean }>;
  connectGoogleMutation: any;
  syncActiveScopeMutation: any;
  updateScopeMutation: any;
  disconnectGoogleMutation: any;
  keepOutOfScopeEvents: boolean;
  onToggleKeepOutOfScope: (value: boolean) => void;
  onOpenDisconnectDialog: () => void;
  googleFeedUrl: string;
  googleAddByUrlPage: string;
  onExportToGoogleCalendar: () => Promise<void>;
  onGenerateICSFile: (provider: CalendarProvider | "generic") => Promise<void>;
  toast: any;
}

function GoogleExportPanel({
  tasksWithDates,
  googleSyncStatus,
  googleSyncStatusQuery,
  googleSyncScopeQuery,
  buildSelections,
  connectGoogleMutation,
  syncActiveScopeMutation,
  updateScopeMutation,
  disconnectGoogleMutation,
  keepOutOfScopeEvents,
  onToggleKeepOutOfScope,
  onOpenDisconnectDialog,
  googleFeedUrl,
  googleAddByUrlPage,
  onExportToGoogleCalendar,
  onGenerateICSFile,
  toast,
}: GoogleExportPanelProps) {
  const activeScopeCount = googleSyncScopeQuery.data?.count ?? googleSyncStatus?.activeScopeCount ?? 0;
  const selectedScopeCount = buildSelections().length;
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
    <div className="space-y-3">
      {/* Google Two-Way Sync Card */}
      <ExportCard
        title="Keep In Sync (Two-Way)"
        description="Sync selected tasks into a dedicated SimpleHome Google calendar. Changes sync both directions."
        icon="🔄"
        variant="warning"
      >
        {googleSyncStatusQuery.isLoading ? (
          <p className="text-xs text-gray-600">Loading Google Calendar sync status...</p>
        ) : googleSyncStatusQuery.isError ? (
          <div className="text-xs text-red-800 bg-white/70 border border-red-200 rounded p-2 space-y-1">
            <p className="font-medium">Could not read Google sync status.</p>
            <p>{googleStatusErrorMessage}</p>
          </div>
        ) : !googleSyncStatus?.configured ? (
          <div className="text-xs text-amber-800 bg-white/70 border border-amber-200 rounded p-2 space-y-1">
            <p className="font-medium">Google Calendar sync is not configured on the server.</p>
            <p>Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, and make sure PUBLIC_BASE_URL points to a reachable HTTPS URL.</p>
          </div>
        ) : !googleSyncStatus.connected ? (
          <Button
            type="button"
            onClick={() => connectGoogleMutation.mutate()}
            className="w-full justify-start"
            variant="outline"
            size="sm"
          >
            <Calendar className="w-4 h-4 mr-3" />
            {connectGoogleMutation.isPending ? "Opening Google OAuth..." : "Connect Google Calendar"}
          </Button>
        ) : (
          <div className="space-y-2">
            <div className="text-xs text-gray-700 bg-white/70 border rounded p-2 space-y-1">
              <p>
                Connected as <span className="font-medium">{googleSyncStatus.accountEmail || "Google account"}</span>
              </p>
              <p>
                Last synced: {googleSyncStatus.lastSyncedAt ? new Date(googleSyncStatus.lastSyncedAt).toLocaleString() : "Never"}
              </p>
              <p>
                Active scope: <span className="font-medium">{activeScopeCount}</span> task{activeScopeCount === 1 ? "" : "s"} • Selection: <span className="font-medium">{selectedScopeCount}</span>
              </p>
            </div>
            <label className="flex items-center gap-2 text-xs text-gray-700">
              <input
                type="checkbox"
                checked={keepOutOfScopeEvents}
                onChange={(event) => onToggleKeepOutOfScope(event.target.checked)}
              />
              Keep out-of-scope events (planned; currently informational)
            </label>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                onClick={() => syncActiveScopeMutation.mutate()}
                size="sm"
                variant="outline"
                disabled={syncActiveScopeMutation.isPending || activeScopeCount === 0}
              >
                <RefreshCw className="w-3 h-3 mr-2 shrink-0" />
                {syncActiveScopeMutation.isPending ? "Syncing..." : "Sync Now"}
              </Button>
              <Button
                type="button"
                onClick={() => updateScopeMutation.mutate()}
                size="sm"
                variant="outline"
                disabled={updateScopeMutation.isPending || selectedScopeCount === 0}
              >
                <RefreshCw className="w-3 h-3 mr-2 shrink-0" />
                {updateScopeMutation.isPending ? "Updating..." : "Update Scope"}
              </Button>
            </div>
            <Button
              type="button"
              onClick={onOpenDisconnectDialog}
              variant="ghost"
              size="sm"
              className="text-red-600 hover:text-red-700 hover:bg-red-50 w-full"
              disabled={disconnectGoogleMutation.isPending}
            >
              <X className="w-4 h-4 mr-2" />
              Disconnect
            </Button>
          </div>
        )}
      </ExportCard>

      {/* Google Subscription Card */}
      <ExportCard
        title="Subscribe (One-Way)"
        description="Get a live feed URL that you can subscribe to in Google Calendar. Updates flow from SimpleHome only."
        icon="📬"
        variant="default"
      >
        <Button
          onClick={onExportToGoogleCalendar}
          className="w-full justify-start"
          variant="outline"
          size="sm"
          title="Subscribe selected tasks in Google Calendar via SimpleHome feed"
        >
          <Calendar className="w-4 h-4 mr-3" />
          Create Feed
        </Button>

        {googleFeedUrl && (
          <div className="space-y-2 pt-2">
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
                      description: "Clipboard access failed. Select and copy manually.",
                      variant: "destructive",
                    });
                  }
                }}
              >
                Copy URL
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="flex-1"
                onClick={() => window.open(googleAddByUrlPage, "_blank", "noopener,noreferrer")}
              >
                <ExternalLink className="w-3 h-3 mr-1" />
                Open Google
              </Button>
            </div>
          </div>
        )}
      </ExportCard>

      {/* Google File Export Card */}
      <ExportCard
        title="Download File"
        description="Download as ICS file for manual import or one-time use."
        icon="⬇️"
        variant="default"
      >
        <Button
          onClick={() => onGenerateICSFile("generic")}
          className="w-full justify-start"
          variant="outline"
          size="sm"
          title="Download ICS file for any calendar application"
        >
          <Download className="w-4 h-4 mr-3" />
          Download ICS File
        </Button>
      </ExportCard>
    </div>
  );
}

// ========== Apple Export Panel Component ==========
interface AppleExportPanelProps {
  tasksWithDates: MaintenanceTask[];
  appleSyncStatus: AppleCalendarSyncStatus | undefined;
  appleSyncStatusQuery: any;
  appleSyncScopeQuery: any;
  buildSelections: () => Array<{ taskId: string; includeMinor: boolean; includeMajor: boolean }>;
  connectAppleMutation: any;
  syncActiveScopeAppleMutation: any;
  updateScopeAppleMutation: any;
  disconnectAppleMutation: any;
  appleFeedUrl: string;
  onExportToAppleCalendarSubscription: () => Promise<void>;
  onExportToAppleCalendar: () => Promise<void>;
  onOpenDisconnectDialog: () => void;
  toast: any;
}

function AppleExportPanel({
  tasksWithDates,
  appleSyncStatus,
  appleSyncStatusQuery,
  appleSyncScopeQuery,
  buildSelections,
  connectAppleMutation,
  syncActiveScopeAppleMutation,
  updateScopeAppleMutation,
  disconnectAppleMutation,
  appleFeedUrl,
  onExportToAppleCalendarSubscription,
  onExportToAppleCalendar,
  onOpenDisconnectDialog,
  toast,
}: AppleExportPanelProps) {
  const activeScopeCount = appleSyncScopeQuery.data?.count ?? appleSyncStatus?.activeScopeCount ?? 0;
  const selectedScopeCount = buildSelections().length;

  return (
    <div className="space-y-3">
      {/* Apple Two-Way Sync Card */}
      <ExportCard
        title="Keep In Sync (Two-Way)"
        description="Sync selected tasks into a dedicated Apple calendar. Changes sync both directions."
        icon="🔄"
        variant="warning"
      >
        {appleSyncStatusQuery.isLoading ? (
          <p className="text-xs text-gray-600">Loading Apple Calendar sync status...</p>
        ) : appleSyncStatusQuery.isError ? (
          <div className="text-xs text-red-800 bg-white/70 border border-red-200 rounded p-2 space-y-1">
            <p className="font-medium">Could not read Apple sync status.</p>
            <p>{appleSyncStatusQuery.error?.message || "Unable to load Apple Calendar sync status."}</p>
          </div>
        ) : !appleSyncStatus?.configured ? (
          <div className="text-xs text-amber-800 bg-white/70 border border-amber-200 rounded p-2 space-y-1">
            <p className="font-medium">Apple Calendar sync is not configured on the server.</p>
            <p>This feature is coming in a future release.</p>
          </div>
        ) : !appleSyncStatus.connected ? (
          <Button
            type="button"
            onClick={() => connectAppleMutation.mutate()}
            className="w-full justify-start"
            variant="outline"
            size="sm"
          >
            <Calendar className="w-4 h-4 mr-3" />
            {connectAppleMutation.isPending ? "Connecting Apple..." : "Connect Apple Calendar"}
          </Button>
        ) : (
          <div className="space-y-2">
            <div className="text-xs text-gray-700 bg-white/70 border rounded p-2 space-y-1">
              <p>
                Connected as <span className="font-medium">{appleSyncStatus.accountEmail || "Apple account"}</span>
              </p>
              <p>
                Last synced: {appleSyncStatus.lastSyncedAt ? new Date(appleSyncStatus.lastSyncedAt).toLocaleString() : "Never"}
              </p>
              <p>
                Active scope: <span className="font-medium">{activeScopeCount}</span> task{activeScopeCount === 1 ? "" : "s"} • Selection: <span className="font-medium">{selectedScopeCount}</span>
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                onClick={() => syncActiveScopeAppleMutation.mutate()}
                size="sm"
                variant="outline"
                disabled={syncActiveScopeAppleMutation.isPending || activeScopeCount === 0}
              >
                <RefreshCw className="w-3 h-3 mr-2 shrink-0" />
                {syncActiveScopeAppleMutation.isPending ? "Syncing..." : "Sync Now"}
              </Button>
              <Button
                type="button"
                onClick={() => updateScopeAppleMutation.mutate()}
                size="sm"
                variant="outline"
                disabled={updateScopeAppleMutation.isPending || selectedScopeCount === 0}
              >
                <RefreshCw className="w-3 h-3 mr-2 shrink-0" />
                {updateScopeAppleMutation.isPending ? "Updating..." : "Update Scope"}
              </Button>
            </div>
            <Button
              type="button"
              onClick={onOpenDisconnectDialog}
              variant="ghost"
              size="sm"
              className="text-red-600 hover:text-red-700 hover:bg-red-50 w-full"
              disabled={disconnectAppleMutation.isPending}
            >
              <X className="w-4 h-4 mr-2" />
              Disconnect
            </Button>
          </div>
        )}
      </ExportCard>

      {/* Apple Subscription Card */}
      <ExportCard
        title="Subscribe (One-Way)"
        description="Get a live feed URL that you can subscribe to in Apple Calendar. Updates flow from SimpleHome only."
        icon="📬"
        variant="default"
      >
        <Button
          onClick={onExportToAppleCalendarSubscription}
          className="w-full justify-start"
          variant="outline"
          size="sm"
          title="Subscribe selected tasks in Apple Calendar via SimpleHome feed"
        >
          <Calendar className="w-4 h-4 mr-3" />
          Create Feed
        </Button>

        {appleFeedUrl && (
          <div className="space-y-2 pt-2">
            <input value={appleFeedUrl} readOnly className="w-full text-xs rounded border bg-white px-2 py-1" aria-label="Apple calendar feed URL" />
            <div className="text-xs text-gray-600 bg-white p-2 rounded border border-dashed space-y-1">
              <p className="font-medium">How to subscribe:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Feed URL is ready below</li>
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
                Copy URL
              </Button>
            </div>
          </div>
        )}
      </ExportCard>

      {/* Apple File Export Card */}
      <ExportCard
        title="Download File"
        description="Download as ICS file for manual import or one-time use."
        icon="⬇️"
        variant="default"
      >
        <Button
          onClick={() => onExportToAppleCalendar()}
          className="w-full justify-start"
          variant="outline"
          size="sm"
          title="Download ICS file for any calendar application"
        >
          <Download className="w-4 h-4 mr-3" />
          Download ICS File
        </Button>
      </ExportCard>
    </div>
  );
}

// ========== Export Tracking Section Component ==========
interface ExportTrackingSectionProps {
  tasksWithExports: MaintenanceTask[];
  getCalendarExportsForTask: (task: MaintenanceTask) => CalendarExportRecord[];
  hasCalendarExport: (task: MaintenanceTask, provider?: CalendarProvider) => boolean;
  onClearExports: (provider?: CalendarProvider) => Promise<void>;
}

function ExportTrackingSection({
  tasksWithExports,
  getCalendarExportsForTask,
  hasCalendarExport,
  onClearExports,
}: ExportTrackingSectionProps) {
  if (tasksWithExports.length === 0) {
    return null;
  }

  return (
    <>
      <div className="border-t pt-4 mt-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Exported Tasks ({tasksWithExports.length})</h3>
          <div className="flex gap-2">
            {tasksWithExports.some((task) => hasCalendarExport(task, "google")) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onClearExports("google")}
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
                onClick={() => onClearExports("apple")}
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
              onClick={() => onClearExports()}
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
  );
}

// ========== Export Footer Help Component ==========
function ExportFooterHelp() {
  return (
    <div className="text-xs text-gray-500 mt-2 space-y-1">
      <p>Google two-way sync requires server-side OAuth credentials and a public HTTPS callback URL.</p>
      <p>Google and Apple subscription feeds remain one-way from SimpleHome into the calendar app.</p>
      <p>ICS file exports are compatible with most calendar applications.</p>
      <p>For subscription feeds, make sure PUBLIC_BASE_URL is set to a publicly reachable HTTPS domain.</p>
    </div>
  );
}

export default function ExportScheduleModal({ isOpen, onClose, tasks }: ExportScheduleModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedProvider, setSelectedProvider] = useState<ExportProvider | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Record<string, boolean>>({});
  const [googleFeedUrl, setGoogleFeedUrl] = useState("");
  const [googleAddByUrlPage, setGoogleAddByUrlPage] = useState("https://calendar.google.com/calendar/u/0/r/settings/addbyurl");
  const [appleFeedUrl, setAppleFeedUrl] = useState("");
  const [keepOutOfScopeEvents, setKeepOutOfScopeEvents] = useState(false);
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false);
  const [disconnectDeleteCalendar, setDisconnectDeleteCalendar] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("select-items");

  const googleSyncStatusQuery = useQuery<GoogleCalendarSyncStatus>({
    queryKey: ["/api/calendar/google/sync/status"],
    enabled: isOpen,
    retry: false,
  });

  const googleSyncScopeQuery = useQuery<GoogleCalendarSyncScope>({
    queryKey: ["/api/calendar/google/sync/scope"],
    enabled: isOpen && !!googleSyncStatusQuery.data?.configured && !!googleSyncStatusQuery.data?.connected,
    retry: false,
  });

  const appleSyncStatusQuery = useQuery<AppleCalendarSyncStatus>({
    queryKey: ["/api/calendar/apple/sync/status"],
    enabled: isOpen,
    retry: false,
  });

  const appleSyncScopeQuery = useQuery<AppleCalendarSyncScope>({
    queryKey: ["/api/calendar/apple/sync/scope"],
    enabled: isOpen && !!appleSyncStatusQuery.data?.configured && !!appleSyncStatusQuery.data?.connected,
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
      window.open(authorizationUrl, "_self");
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
    mutationFn: async ({ deleteCalendar }: { deleteCalendar: boolean }) => {
      const response = await apiRequest("POST", "/api/calendar/google/disconnect", { deleteCalendar });
      return response.json() as Promise<DisconnectGoogleCalendarResponse>;
    },
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/calendar/google/sync/status"] });
      setDisconnectDialogOpen(false);

      if (result.calendarDeleteRequested && result.calendarDeleted) {
        toast({
          title: "Google Calendar Disconnected",
          description: "Two-way sync is disabled and the managed SimpleHome calendar was deleted.",
        });
        return;
      }

      if (result.calendarDeleteRequested && !result.calendarDeleted) {
        toast({
          title: "Disconnected, Calendar Kept",
          description:
            result.calendarDeleteMessage ||
            "Two-way sync is disabled, but the calendar could not be deleted automatically.",
          variant: "destructive",
        });
        return;
      }

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

  const connectAppleMutation = useMutation({
    mutationFn: async () => {
      toast({
        title: "Coming Soon",
        description: "Apple two-way sync is coming in a future release.",
        variant: "default",
      });
      throw new Error("Apple sync not yet available");
    },
    onError: () => {
      // Error already shown in mutationFn
    },
  });

  const syncActiveScopeAppleMutation = useMutation({
    mutationFn: async () => {
      toast({
        title: "Coming Soon",
        description: "Apple sync functionality will be available in a future release.",
        variant: "default",
      });
      throw new Error("Apple sync not yet available");
    },
  });

  const updateScopeAppleMutation = useMutation({
    mutationFn: async () => {
      toast({
        title: "Coming Soon",
        description: "Apple scope management will be available in a future release.",
        variant: "default",
      });
      throw new Error("Apple sync not yet available");
    },
  });

  const disconnectAppleMutation = useMutation({
    mutationFn: async ({ deleteCalendar }: { deleteCalendar: boolean }) => {
      toast({
        title: "Coming Soon",
        description: "Apple sync disconnect will be available in a future release.",
        variant: "default",
      });
      throw new Error("Apple sync not yet available");
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
    if (tasksWithDates.length === 0) {
      return;
    }

    setSelectedTaskIds((prev) => {
      if (Object.keys(prev).length > 0) {
        return prev;
      }

      const defaults: Record<string, boolean> = {};
      tasksWithDates.forEach((task) => {
        defaults[task.id] = true;
      });
      return defaults;
    });
  }, [tasksWithDates]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setSelectedTaskIds((prev) => {
      const next: Record<string, boolean> = {};
      tasksWithDates.forEach((task) => {
        next[task.id] = prev[task.id] ?? true;
      });

      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      const unchanged =
        prevKeys.length === nextKeys.length &&
        nextKeys.every((key) => prev[key] === next[key]);

      return unchanged ? prev : next;
    });
  }, [isOpen, tasksWithDates]);

  useEffect(() => {
    if (isOpen) {
      setActiveTab("select-items");
      setSelectedProvider(null);
    }
  }, [isOpen]);

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

  const syncActiveScopeMutation = useMutation({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/calendar/google/sync", { selections: [] });
      return response.json() as Promise<{
        syncedTasks: number;
        pushedEvents: number;
        pulledChanges: number;
        createdEvents: number;
        updatedEvents: number;
        completedFromGoogle?: number;
        rescheduledFromGoogle?: number;
      }>;
    },
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/calendar/google/sync/status"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/calendar/google/sync/scope"] }),
      ]);

      toast({
        title: "Google Calendar Synced",
        description: `Synced ${result.syncedTasks} task${result.syncedTasks === 1 ? "" : "s"}. Pushed ${result.pushedEvents} event${result.pushedEvents === 1 ? "" : "s"}, pulled ${result.pulledChanges} change${result.pulledChanges === 1 ? "" : "s"}, completed ${result.completedFromGoogle ?? 0} and rescheduled ${result.rescheduledFromGoogle ?? 0} from Google.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Google Sync Failed",
        description: error?.message || "Unable to sync with Google Calendar active scope.",
        variant: "destructive",
      });
    },
  });

  const updateScopeMutation = useMutation({
    mutationFn: async () => {
      const selections = buildSelections();
      if (selections.length === 0) {
        throw new Error("Select at least one task with an upcoming maintenance date.");
      }

      const currentScopeCount = googleSyncScopeQuery.data?.count ?? googleSyncStatusQuery.data?.activeScopeCount ?? 0;
      if (currentScopeCount > selections.length) {
        const accepted = window.confirm(
          keepOutOfScopeEvents
            ? "This reduces active scope. Keep-out-of-scope behavior is planned in a future phase; currently, out-of-scope events are removed immediately. Continue updating scope?"
            : "This reduces active scope. Out-of-scope events will be removed from Google immediately. Continue updating scope?",
        );
        if (!accepted) {
          throw new Error("Scope update cancelled.");
        }
      }

      const scopeResponse = await apiRequest("PUT", "/api/calendar/google/sync/scope", { selections });
      const scopeResult = (await scopeResponse.json()) as { count: number; removedEvents?: number };

      const syncResponse = await apiRequest("POST", "/api/calendar/google/sync", { selections: [] });
      const syncResult = (await syncResponse.json()) as {
        syncedTasks: number;
        pushedEvents: number;
        pulledChanges: number;
      };

      return { scopeResult, syncResult };
    },
    onSuccess: async ({ scopeResult, syncResult }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/calendar/google/sync/scope"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/calendar/google/sync/status"] }),
      ]);

      const removedEvents = scopeResult.removedEvents ?? 0;
      toast({
        title: "Scope Updated and Synced",
        description:
          removedEvents > 0
            ? `Active scope now includes ${scopeResult.count} task${scopeResult.count === 1 ? "" : "s"}. Removed ${removedEvents} out-of-scope event${removedEvents === 1 ? "" : "s"}, then synced ${syncResult.syncedTasks} task${syncResult.syncedTasks === 1 ? "" : "s"} and pushed ${syncResult.pushedEvents} event${syncResult.pushedEvents === 1 ? "" : "s"}.`
            : `Active scope now includes ${scopeResult.count} task${scopeResult.count === 1 ? "" : "s"}. Synced ${syncResult.syncedTasks} task${syncResult.syncedTasks === 1 ? "" : "s"} and pushed ${syncResult.pushedEvents} event${syncResult.pushedEvents === 1 ? "" : "s"}.`,
      });
    },
    onError: (error: any) => {
      if (error?.message === "Scope update cancelled.") {
        return;
      }
      toast({
        title: "Scope Update Failed",
        description: error?.message || "Unable to update Google sync scope.",
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
  const appleSyncStatus = appleSyncStatusQuery.data;
  const activeScopeCount = googleSyncScopeQuery.data?.count ?? googleStatus?.activeScopeCount ?? 0;
  const selectedScopeCount = buildSelections().length;
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
      <DialogContent className="sm:max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Export Schedule</DialogTitle>
          <DialogDescription>
            Organize your maintenance schedule by selecting items, choosing a provider, and reviewing history.
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="select-items">Select Items</TabsTrigger>
            <TabsTrigger value="export-options">Export Options</TabsTrigger>
            <TabsTrigger value="history">History</TabsTrigger>
            <TabsTrigger value="help">Help</TabsTrigger>
          </TabsList>

          {/* Tab 1: Select Items */}
          <TabsContent value="select-items" className="space-y-3 py-4">
            <ExportScopePicker
              tasksWithDates={tasksWithDates}
              selectedTaskIds={selectedTaskIds}
              onToggleTask={toggleTaskSelection}
              onToggleSelectAll={toggleSelectAll}
            />
            <SelectionSummary tasksWithDates={tasksWithDates} selectedTaskIds={selectedTaskIds} />
          </TabsContent>

          {/* Tab 2: Export Options */}
          <TabsContent value="export-options" className="space-y-3 py-4">
            {/* Provider Selector */}
            <div className="flex gap-2">
              <Button
                type="button"
                onClick={() => setSelectedProvider("google")}
                variant={selectedProvider === "google" ? "default" : "outline"}
                className="flex-1 justify-center"
              >
                Google
              </Button>
              <Button
                type="button"
                onClick={() => setSelectedProvider("apple")}
                variant={selectedProvider === "apple" ? "default" : "outline"}
                className="flex-1 justify-center"
              >
                Apple
              </Button>
            </div>

            {/* Google Provider Panel */}
            {selectedProvider === "google" && (
              <>
                <GoogleExportPanel
                  tasksWithDates={tasksWithDates}
                  googleSyncStatus={googleStatus}
                  googleSyncStatusQuery={googleSyncStatusQuery}
                  googleSyncScopeQuery={googleSyncScopeQuery}
                  buildSelections={buildSelections}
                  connectGoogleMutation={connectGoogleMutation}
                  syncActiveScopeMutation={syncActiveScopeMutation}
                  updateScopeMutation={updateScopeMutation}
                  disconnectGoogleMutation={disconnectGoogleMutation}
                  keepOutOfScopeEvents={keepOutOfScopeEvents}
                  onToggleKeepOutOfScope={setKeepOutOfScopeEvents}
                  onOpenDisconnectDialog={() => {
                    setDisconnectDeleteCalendar(false);
                    setDisconnectDialogOpen(true);
                  }}
                  googleFeedUrl={googleFeedUrl}
                  googleAddByUrlPage={googleAddByUrlPage}
                  onExportToGoogleCalendar={exportToGoogleCalendar}
                  onGenerateICSFile={generateICSFile}
                  toast={toast}
                />
                <AlertDialog open={disconnectDialogOpen} onOpenChange={setDisconnectDialogOpen}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Disconnect Google Calendar?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Choose whether to only disconnect sync or also delete the managed SimpleHome calendar.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <div className="space-y-2 text-sm">
                      <label className="flex items-start gap-2 rounded border p-2 cursor-pointer">
                        <input
                          type="radio"
                          name="disconnect-mode"
                          checked={!disconnectDeleteCalendar}
                          onChange={() => setDisconnectDeleteCalendar(false)}
                        />
                        <span>
                          <span className="font-medium">Disconnect only</span>
                          <br />
                          Keep the existing Google calendar and events.
                        </span>
                      </label>
                      <label className="flex items-start gap-2 rounded border p-2 cursor-pointer">
                        <input
                          type="radio"
                          name="disconnect-mode"
                          checked={disconnectDeleteCalendar}
                          onChange={() => setDisconnectDeleteCalendar(true)}
                        />
                        <span>
                          <span className="font-medium">Disconnect and delete app calendar</span>
                          <br />
                          Deletes the managed SimpleHome calendar if it is safe to delete.
                        </span>
                      </label>
                    </div>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={disconnectGoogleMutation.isPending}>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={(event) => {
                          event.preventDefault();
                          disconnectGoogleMutation.mutate({ deleteCalendar: disconnectDeleteCalendar });
                        }}
                        disabled={disconnectGoogleMutation.isPending}
                        className="bg-red-600 hover:bg-red-700"
                      >
                        {disconnectGoogleMutation.isPending ? "Disconnecting..." : "Confirm Disconnect"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}

            {/* Apple Provider Panel */}
            {selectedProvider === "apple" && (
              <AppleExportPanel
                tasksWithDates={tasksWithDates}
                appleSyncStatus={appleSyncStatus}
                appleSyncStatusQuery={appleSyncStatusQuery}
                appleSyncScopeQuery={appleSyncScopeQuery}
                buildSelections={buildSelections}
                connectAppleMutation={connectAppleMutation}
                syncActiveScopeAppleMutation={syncActiveScopeAppleMutation}
                updateScopeAppleMutation={updateScopeAppleMutation}
                disconnectAppleMutation={disconnectAppleMutation}
                appleFeedUrl={appleFeedUrl}
                onExportToAppleCalendarSubscription={exportToAppleCalendarSubscription}
                onExportToAppleCalendar={exportToAppleCalendar}
                onOpenDisconnectDialog={() => {
                  setDisconnectDeleteCalendar(false);
                  setDisconnectDialogOpen(true);
                }}
                toast={toast}
              />
            )}

            {!selectedProvider && (
              <div className="text-center py-8 text-gray-500">
                <p>Choose a provider above to see export options.</p>
              </div>
            )}
          </TabsContent>

          {/* Tab 3: History */}
          <TabsContent value="history" className="space-y-3 py-4">
            <ExportTrackingSection
              tasksWithExports={tasksWithExports}
              getCalendarExportsForTask={getCalendarExportsForTask}
              hasCalendarExport={hasCalendarExport}
              onClearExports={clearCalendarExports}
            />
          </TabsContent>

          {/* Tab 4: Help */}
          <TabsContent value="help" className="space-y-3 py-4">
            <ExportFooterHelp />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
