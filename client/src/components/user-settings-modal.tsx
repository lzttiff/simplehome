import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { normalizeDateOnly, toDateOnlyFromLocalDate } from "@shared/schema";

// Common IANA timezone list grouped by region
export const TIMEZONE_OPTIONS: { value: string; label: string; offset: string }[] = [
  // USA & Canada
  { value: "America/New_York",       label: "Eastern Time (ET)",           offset: "UTC-5/−4" },
  { value: "America/Chicago",        label: "Central Time (CT)",           offset: "UTC-6/−5" },
  { value: "America/Denver",         label: "Mountain Time (MT)",          offset: "UTC-7/−6" },
  { value: "America/Los_Angeles",    label: "Pacific Time (PT)",           offset: "UTC-8/−7" },
  { value: "America/Anchorage",      label: "Alaska Time (AKT)",           offset: "UTC-9/−8" },
  { value: "Pacific/Honolulu",       label: "Hawaii Time (HT)",            offset: "UTC-10" },
  { value: "America/Toronto",        label: "Toronto / Eastern Canada",    offset: "UTC-5/−4" },
  { value: "America/Vancouver",      label: "Vancouver / Pacific Canada",  offset: "UTC-8/−7" },
  // Latin America
  { value: "America/Mexico_City",    label: "Mexico City",                 offset: "UTC-6/−5" },
  { value: "America/Sao_Paulo",      label: "São Paulo / Brasília",        offset: "UTC-3" },
  { value: "America/Buenos_Aires",   label: "Buenos Aires",                offset: "UTC-3" },
  { value: "America/Bogota",         label: "Bogotá / Lima / Quito",       offset: "UTC-5" },
  // Europe
  { value: "Europe/London",          label: "London (GMT/BST)",            offset: "UTC+0/+1" },
  { value: "Europe/Paris",           label: "Paris / Berlin / Rome (CET)", offset: "UTC+1/+2" },
  { value: "Europe/Helsinki",        label: "Helsinki / Kyiv (EET)",       offset: "UTC+2/+3" },
  { value: "Europe/Istanbul",        label: "Istanbul / Moscow",           offset: "UTC+3" },
  // Middle East & Africa
  { value: "Asia/Dubai",             label: "Dubai / Abu Dhabi (GST)",     offset: "UTC+4" },
  { value: "Africa/Johannesburg",    label: "Johannesburg (SAST)",         offset: "UTC+2" },
  { value: "Africa/Cairo",           label: "Cairo (EET)",                 offset: "UTC+2/+3" },
  { value: "Africa/Lagos",           label: "Lagos / West Africa (WAT)",   offset: "UTC+1" },
  // South & Central Asia
  { value: "Asia/Karachi",           label: "Karachi (PKT)",               offset: "UTC+5" },
  { value: "Asia/Kolkata",           label: "Mumbai / Kolkata (IST)",      offset: "UTC+5:30" },
  { value: "Asia/Dhaka",             label: "Dhaka (BST)",                 offset: "UTC+6" },
  // East & Southeast Asia
  { value: "Asia/Bangkok",           label: "Bangkok / Jakarta (ICT)",     offset: "UTC+7" },
  { value: "Asia/Shanghai",          label: "Beijing / Shanghai (CST)",    offset: "UTC+8" },
  { value: "Asia/Taipei",            label: "Taipei / Hong Kong",          offset: "UTC+8" },
  { value: "Asia/Singapore",         label: "Singapore (SGT)",             offset: "UTC+8" },
  { value: "Asia/Tokyo",             label: "Tokyo / Seoul (JST/KST)",     offset: "UTC+9" },
  // Pacific / Australia
  { value: "Australia/Sydney",       label: "Sydney / Melbourne (AEST)",   offset: "UTC+10/+11" },
  { value: "Australia/Adelaide",     label: "Adelaide (ACST)",             offset: "UTC+9:30/+10:30" },
  { value: "Australia/Perth",        label: "Perth (AWST)",                offset: "UTC+8" },
  { value: "Pacific/Auckland",       label: "Auckland (NZST)",             offset: "UTC+12/+13" },
];

/** Detect the browser's IANA timezone string, fallback to UTC. */
export function detectBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

/**
 * Format maintenance dates without timezone shifting the day.
 * For canonical date-only values, we render the exact YYYY-MM-DD selection.
 * For legacy timed values, we respect the provided timezone as a fallback.
 */
export function formatDateInTimezone(value: string | null | undefined, timezone: string): string {
  if (!value) return "Not set";

  const normalized = normalizeDateOnly(value);
  if (normalized) {
    const [year, month, day] = normalized.split("-").map(Number);
    return new Date(year, month - 1, day).toLocaleDateString();
  }

  return new Date(value).toLocaleDateString(undefined, { timeZone: timezone });
}

/** Convert a date picker selection into canonical date-only storage. */
export function toStorageDate(localDate: Date): string {
  return toDateOnlyFromLocalDate(localDate);
}

interface UserSettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentTimezone: string | null;
  currentName: string;
}

export default function UserSettingsModal({
  isOpen,
  onClose,
  currentTimezone,
  currentName,
}: UserSettingsModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedTimezone, setSelectedTimezone] = useState<string>(
    currentTimezone || detectBrowserTimezone(),
  );

  // Sync selected timezone if modal re-opens with a different value
  useEffect(() => {
    setSelectedTimezone(currentTimezone || detectBrowserTimezone());
  }, [currentTimezone, isOpen]);

  const saveSettingsMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/user/profile", {
        timezone: selectedTimezone,
      });
      return res.json();
    },
    onSuccess: (updatedUser) => {
      queryClient.setQueryData(["/api/auth/me"], updatedUser);
      toast({
        title: "Settings saved",
        description: `Timezone set to ${selectedTimezone}.`,
      });
      onClose();
    },
    onError: (error: any) => {
      toast({
        title: "Save failed",
        description: error?.message || "Unable to save settings.",
        variant: "destructive",
      });
    },
  });

  const selectedLabel =
    TIMEZONE_OPTIONS.find((tz) => tz.value === selectedTimezone)?.label ?? selectedTimezone;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>User Settings</DialogTitle>
          <DialogDescription>
            Set your timezone so that maintenance dates are displayed and synced correctly.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <Label className="text-sm font-medium">Name</Label>
            <p className="text-sm text-gray-600">{currentName}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="timezone-select" className="text-sm font-medium">
              Timezone
            </Label>
            <Select
              value={selectedTimezone}
              onValueChange={setSelectedTimezone}
            >
              <SelectTrigger id="timezone-select" className="w-full">
                <SelectValue placeholder="Select timezone">
                  {selectedLabel}
                </SelectValue>
              </SelectTrigger>
              <SelectContent className="max-h-72">
                {TIMEZONE_OPTIONS.map((tz) => (
                  <SelectItem key={tz.value} value={tz.value}>
                    <span>{tz.label}</span>
                    <span className="ml-2 text-xs text-gray-400">{tz.offset}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-500">
              Browser detected: <span className="font-mono">{detectBrowserTimezone()}</span>
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onClose} disabled={saveSettingsMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={() => saveSettingsMutation.mutate()}
            disabled={saveSettingsMutation.isPending}
          >
            {saveSettingsMutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
