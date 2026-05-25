import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
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

type GoogleCalendarStatus = {
  configured: boolean;
  connected: boolean;
  accountEmail: string | null;
  calendarId: string | null;
  lastSyncedAt: string | null;
  activeScopeCount?: number;
  syncScopeVersion?: number;
  syncScopeUpdatedAt?: string | null;
};

type AiPreferencesResponse = {
  aiProvider: "gemini" | "openai" | null;
  aiAgentEnabled: boolean;
  aiPolicyVersion: string | null;
};

type AiCredentialStatusResponse = {
  hasGeminiApiKey: boolean;
  hasOpenAiApiKey: boolean;
  updatedAt: string | null;
};

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
  const [selectedAiProvider, setSelectedAiProvider] = useState<"gemini" | "openai" | null>(null);
  const [aiAgentEnabled, setAiAgentEnabled] = useState(false);
  const [aiPolicyVersion, setAiPolicyVersion] = useState("");
  const [geminiApiKeyInput, setGeminiApiKeyInput] = useState("");
  const [openAiApiKeyInput, setOpenAiApiKeyInput] = useState("");
  const [lastValidationMessage, setLastValidationMessage] = useState<string | null>(null);

  const { data: googleCalendarStatus, isLoading: googleStatusLoading } = useQuery<GoogleCalendarStatus>({
    queryKey: ["/api/calendar/google/sync/status"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: isOpen,
    staleTime: 30_000,
    retry: false,
  });

  const { data: aiPreferences, isLoading: aiPreferencesLoading } = useQuery<AiPreferencesResponse>({
    queryKey: ["/api/user/ai-preferences"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: isOpen,
    staleTime: 30_000,
    retry: false,
  });

  const { data: aiCredentialStatus, isLoading: aiCredentialStatusLoading } = useQuery<AiCredentialStatusResponse>({
    queryKey: ["/api/user/ai-credentials"],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: isOpen,
    staleTime: 15_000,
    retry: false,
  });

  // Sync selected timezone if modal re-opens with a different value
  useEffect(() => {
    setSelectedTimezone(currentTimezone || detectBrowserTimezone());
  }, [currentTimezone, isOpen]);

  useEffect(() => {
    if (!aiPreferences || !isOpen) {
      return;
    }
    setSelectedAiProvider(aiPreferences.aiProvider ?? null);
    setAiAgentEnabled(aiPreferences.aiAgentEnabled === true);
    setAiPolicyVersion(aiPreferences.aiPolicyVersion ?? "");
  }, [aiPreferences, isOpen]);

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

  const saveAiPreferencesMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/user/ai-preferences", {
        aiProvider: selectedAiProvider,
        aiAgentEnabled,
        aiPolicyVersion: aiPolicyVersion.trim() ? aiPolicyVersion.trim() : null,
      });
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/user/ai-preferences"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/me"] });
      toast({
        title: "AI preferences saved",
        description: "Your AI provider and enablement settings were updated.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Save failed",
        description: error?.message || "Unable to save AI preferences.",
        variant: "destructive",
      });
    },
  });

  const updateAiCredentialMutation = useMutation({
    mutationFn: async (payload: { geminiApiKey?: string; openaiApiKey?: string }) => {
      const res = await apiRequest("PATCH", "/api/user/ai-credentials", payload);
      return res.json() as Promise<AiCredentialStatusResponse>;
    },
    onSuccess: async () => {
      setGeminiApiKeyInput("");
      setOpenAiApiKeyInput("");
      await queryClient.invalidateQueries({ queryKey: ["/api/user/ai-credentials"] });
      toast({
        title: "Credential updated",
        description: "Your provider key was updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Update failed",
        description: error?.message || "Unable to update AI credential.",
        variant: "destructive",
      });
    },
  });

  const removeAiCredentialMutation = useMutation({
    mutationFn: async (provider: "gemini" | "openai") => {
      const res = await apiRequest("DELETE", `/api/user/ai-credentials/${provider}`);
      return res.json() as Promise<AiCredentialStatusResponse>;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["/api/user/ai-credentials"] });
      toast({
        title: "Credential removed",
        description: "Stored key was removed for this provider.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Remove failed",
        description: error?.message || "Unable to remove provider key.",
        variant: "destructive",
      });
    },
  });

  const validateAiCredentialMutation = useMutation({
    mutationFn: async (payload: { provider: "gemini" | "openai"; apiKey?: string }) => {
      const res = await apiRequest(
        "POST",
        `/api/user/ai-credentials/${payload.provider}/validate`,
        payload.apiKey ? { apiKey: payload.apiKey } : {},
      );
      return res.json() as Promise<{ provider: string; valid: boolean; source: string; message?: string }>;
    },
    onSuccess: (result) => {
      const source = result.source === "request" ? "request key" : "stored key";
      setLastValidationMessage(`Validation passed for ${result.provider} using ${source}.`);
      toast({
        title: "Credential valid",
        description: `Provider ${result.provider} validated successfully using ${source}.`,
      });
    },
    onError: (error: any) => {
      setLastValidationMessage("Validation failed. Check the key and try again.");
      toast({
        title: "Validation failed",
        description: error?.message || "Unable to validate provider key.",
        variant: "destructive",
      });
    },
  });

  const selectedLabel =
    TIMEZONE_OPTIONS.find((tz) => tz.value === selectedTimezone)?.label ?? selectedTimezone;

  const copyCalendarId = async () => {
    const calendarId = googleCalendarStatus?.calendarId;
    if (!calendarId) {
      toast({
        title: "No calendar ID",
        description: "No connected Google calendar ID is available.",
        variant: "destructive",
      });
      return;
    }

    try {
      await navigator.clipboard.writeText(calendarId);
      toast({
        title: "Copied",
        description: "Google Calendar ID copied to clipboard.",
      });
    } catch {
      toast({
        title: "Copy failed",
        description: "Clipboard access failed. Please copy it manually.",
        variant: "destructive",
      });
    }
  };

  const googleCalendarSettingsUrl = "https://calendar.google.com/calendar/u/0/r";
  const aiProviderValue = selectedAiProvider ?? "default";
  const isAnyAiMutationPending =
    saveAiPreferencesMutation.isPending ||
    updateAiCredentialMutation.isPending ||
    removeAiCredentialMutation.isPending ||
    validateAiCredentialMutation.isPending;

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

          <div className="space-y-2 rounded-md border border-gray-200 p-3 bg-gray-50">
            <Label className="text-sm font-medium">Google Calendar ID</Label>
            {googleStatusLoading ? (
              <p className="text-sm text-gray-500">Loading Google Calendar status...</p>
            ) : googleCalendarStatus?.connected && googleCalendarStatus.calendarId ? (
              <>
                <p className="text-xs text-gray-500">
                  Connected as {googleCalendarStatus.accountEmail || "unknown account"}
                </p>
                <p className="text-sm font-mono break-all bg-white border rounded px-2 py-1">
                  {googleCalendarStatus.calendarId}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={copyCalendarId}>
                    Copy Calendar ID
                  </Button>
                  <Button type="button" variant="outline" size="sm" asChild>
                    <a href={googleCalendarSettingsUrl} target="_blank" rel="noreferrer">
                      Open Google Calendar Settings
                    </a>
                  </Button>
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-500">Google Calendar is not connected.</p>
            )}
          </div>

          <div className="space-y-3 rounded-md border border-gray-200 p-3 bg-gray-50">
            <div>
              <Label className="text-sm font-medium">AI Agent Settings</Label>
              <p className="text-xs text-gray-500 mt-1">
                Configure per-user provider behavior and feature enablement.
              </p>
            </div>

            {aiPreferencesLoading ? (
              <p className="text-sm text-gray-500">Loading AI preferences...</p>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="ai-provider-select" className="text-sm font-medium">Preferred AI provider</Label>
                  <Select
                    value={aiProviderValue}
                    onValueChange={(value) => setSelectedAiProvider(value === "default" ? null : (value as "gemini" | "openai"))}
                  >
                    <SelectTrigger id="ai-provider-select" className="w-full">
                      <SelectValue placeholder="Use app default" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">Use app default</SelectItem>
                      <SelectItem value="gemini">Gemini</SelectItem>
                      <SelectItem value="openai">OpenAI</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ai-policy-version" className="text-sm font-medium">AI policy version (optional)</Label>
                  <Input
                    id="ai-policy-version"
                    value={aiPolicyVersion}
                    onChange={(e) => setAiPolicyVersion(e.target.value)}
                    placeholder="v1"
                  />
                </div>

                <div className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-2">
                  <div>
                    <Label htmlFor="ai-agent-enabled" className="text-sm font-medium">Enable AI agent</Label>
                    <p className="text-xs text-gray-500">When disabled, AI generation endpoints are blocked for this user.</p>
                  </div>
                  <Switch
                    id="ai-agent-enabled"
                    checked={aiAgentEnabled}
                    onCheckedChange={setAiAgentEnabled}
                    disabled={saveAiPreferencesMutation.isPending}
                  />
                </div>

                <div className="flex justify-end">
                  <Button
                    type="button"
                    onClick={() => saveAiPreferencesMutation.mutate()}
                    disabled={saveAiPreferencesMutation.isPending}
                  >
                    {saveAiPreferencesMutation.isPending ? "Saving AI prefs..." : "Save AI Preferences"}
                  </Button>
                </div>
              </>
            )}
          </div>

          <div className="space-y-3 rounded-md border border-gray-200 p-3 bg-gray-50">
            <div>
              <Label className="text-sm font-medium">Provider API Keys</Label>
              <p className="text-xs text-gray-500 mt-1">
                Keys are stored encrypted server-side and only presence status is returned.
              </p>
            </div>

            {aiCredentialStatusLoading ? (
              <p className="text-sm text-gray-500">Loading credential status...</p>
            ) : (
              <>
                <div className="rounded-md border border-gray-200 bg-white p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">Gemini API key</Label>
                    <span className="text-xs text-gray-500">
                      Stored: {aiCredentialStatus?.hasGeminiApiKey ? "Yes" : "No"}
                    </span>
                  </div>
                  <Input
                    type="password"
                    placeholder="Paste new Gemini API key"
                    value={geminiApiKeyInput}
                    onChange={(e) => setGeminiApiKeyInput(e.target.value)}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => updateAiCredentialMutation.mutate({ geminiApiKey: geminiApiKeyInput.trim() })}
                      disabled={!geminiApiKeyInput.trim() || isAnyAiMutationPending}
                    >
                      Save Gemini Key
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => validateAiCredentialMutation.mutate({ provider: "gemini", apiKey: geminiApiKeyInput.trim() || undefined })}
                      disabled={isAnyAiMutationPending}
                    >
                      Validate Gemini
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => removeAiCredentialMutation.mutate("gemini")}
                      disabled={!aiCredentialStatus?.hasGeminiApiKey || isAnyAiMutationPending}
                    >
                      Remove Gemini Key
                    </Button>
                  </div>
                </div>

                <div className="rounded-md border border-gray-200 bg-white p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">OpenAI API key</Label>
                    <span className="text-xs text-gray-500">
                      Stored: {aiCredentialStatus?.hasOpenAiApiKey ? "Yes" : "No"}
                    </span>
                  </div>
                  <Input
                    type="password"
                    placeholder="Paste new OpenAI API key"
                    value={openAiApiKeyInput}
                    onChange={(e) => setOpenAiApiKeyInput(e.target.value)}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => updateAiCredentialMutation.mutate({ openaiApiKey: openAiApiKeyInput.trim() })}
                      disabled={!openAiApiKeyInput.trim() || isAnyAiMutationPending}
                    >
                      Save OpenAI Key
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => validateAiCredentialMutation.mutate({ provider: "openai", apiKey: openAiApiKeyInput.trim() || undefined })}
                      disabled={isAnyAiMutationPending}
                    >
                      Validate OpenAI
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => removeAiCredentialMutation.mutate("openai")}
                      disabled={!aiCredentialStatus?.hasOpenAiApiKey || isAnyAiMutationPending}
                    >
                      Remove OpenAI Key
                    </Button>
                  </div>
                </div>

                {lastValidationMessage && (
                  <p className="text-xs text-gray-600">{lastValidationMessage}</p>
                )}
                {aiCredentialStatus?.updatedAt && (
                  <p className="text-xs text-gray-500">
                    Last credential update: {new Date(aiCredentialStatus.updatedAt).toLocaleString()}
                  </p>
                )}
              </>
            )}
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
