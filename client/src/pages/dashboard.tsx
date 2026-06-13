import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "wouter";
import {
  compareDateOnly,
  dayDiffDateOnly,
  MaintenanceTask,
  parseMaintenanceSchedule,
  PropertyTemplate,
  toDateOnlyFromLocalDate,
  User,
  type UiSettingsTab,
  type UserUiPreferences,
} from "@shared/schema";
import { TaskStats, CategoryFilter } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { ToastAction } from "@/components/ui/toast";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Plus, Search, ClipboardList, Sparkles, ChevronDown, Home } from "lucide-react";
import TaskCard from "@/components/task-card";
import AddTaskModal from "@/components/add-task-modal";
import AddPropertyModal from "@/components/add-property-modal";
import ExportScheduleModal from "@/components/export-schedule-modal";
import UserSettingsModal from "@/components/user-settings-modal";
import AccountMenu from "@/components/account-menu";
import BulkFillDatesModal, { BulkFillKind, BulkFillMode, BulkFillTaskSelectionPayload } from "@/components/bulk-fill-dates-modal";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { evaluateAiReadiness, OPEN_SETTINGS_EVENT, openSettingsForTab } from "@/lib/ai-readiness";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

const EMPTY_TASKS: MaintenanceTask[] = [];

const categoryColors = {
  Appliances: "bg-cyan-500",
  "HVAC & Mechanical": "bg-red-500",
  "Plumbing & Water": "bg-blue-500", 
  "Electrical & Lighting": "bg-yellow-500",
  "Structural & Exterior": "bg-green-500",
  "Interior & Finishes": "bg-purple-500",
  "Safety & Fire": "bg-orange-500",
  "Yard & Outdoor Equipment": "bg-emerald-500",
  "IT & Communications": "bg-indigo-500",
  "Furniture & Fixtures": "bg-pink-500",
};

export default function Dashboard() {
  const { templateId } = useParams();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState("");
  const [categoryFilters, setCategoryFilters] = useState<CategoryFilter[]>([]);
  const [showAddTaskModal, setShowAddTaskModal] = useState(false);
  const [showAddPropertyModal, setShowAddPropertyModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<UiSettingsTab | undefined>(undefined);
  const [loadingCategories, setLoadingCategories] = useState<Record<string, boolean>>({});
  const [abortControllers, setAbortControllers] = useState<Record<string, AbortController>>({});
  const [sortBy, setSortBy] = useState<"default" | "nextDate">("default");
  const [dateFilter, setDateFilter] = useState<number | null>(null); // null = all, 0 = past due only, positive = past due + days
  const [includeMinor, setIncludeMinor] = useState(true);
  const [includeMajor, setIncludeMajor] = useState(true);
  const [deferredOnly, setDeferredOnly] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [showBulkFillModal, setShowBulkFillModal] = useState(false);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [preferredCategories, setPreferredCategories] = useState<string[] | null>(null);
  const [uiPreferencesReady, setUiPreferencesReady] = useState(false);
  const lastSavedUiPrefRef = useRef<string | null>(null);
  const persistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchWithBackoff = async (url: string, init: RequestInit, maxAttempts = 3): Promise<Response> => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetch(url, init);
        if (response.ok) {
          return response;
        }

        // Retry only transient server/provider failures.
        if (![408, 425, 429, 500, 502, 503, 504].includes(response.status) || attempt === maxAttempts) {
          return response;
        }
      } catch (error) {
        lastError = error;
        if (attempt === maxAttempts) {
          throw error;
        }
      }

      const jitter = Math.floor(Math.random() * 200);
      const delayMs = 700 * (2 ** (attempt - 1)) + jitter;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }

    throw lastError ?? new Error("Request failed after retries");
  };

  const { data: user } = useQuery<User>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: Infinity,
    retry: false,
  });

  const { data: tasksData, isLoading: tasksLoading } = useQuery<MaintenanceTask[]>({
    queryKey: ["/api/tasks", { search: searchTerm, templateId }],
    enabled: !!templateId,
  });
  const tasks = tasksData ?? EMPTY_TASKS;

  const { data: stats } = useQuery<TaskStats>({
    queryKey: ["/api/stats", { templateId }],
    enabled: !!templateId,
  });

  const { data: properties } = useQuery<PropertyTemplate[]>({
    queryKey: ["/api/properties"],
    staleTime: Infinity,
  });
  const currentProperty = properties?.find(p => p.id === templateId);

  const { data: aiPreferences, isLoading: aiPreferencesLoading } = useQuery<{ aiProvider: "gemini" | "openai" | null; aiAgentEnabled: boolean }>({
    queryKey: ["/api/user/ai-preferences"],
    queryFn: getQueryFn({ on401: "throw" }),
    staleTime: 30_000,
    retry: false,
  });

  const { data: aiCredentialStatus, isLoading: aiCredentialsLoading } = useQuery<{ hasGeminiApiKey: boolean; hasOpenAiApiKey: boolean }>({
    queryKey: ["/api/user/ai-credentials"],
    queryFn: getQueryFn({ on401: "throw" }),
    staleTime: 15_000,
    retry: false,
  });

  const aiReadiness = evaluateAiReadiness(aiPreferences, aiCredentialStatus);
  const aiReadinessLoading = aiPreferencesLoading || aiCredentialsLoading;

  const refreshAiReadiness = async () => {
    const [preferencesResult, credentialsResult] = await Promise.all([
      queryClient.fetchQuery({
        queryKey: ["/api/user/ai-preferences"],
        queryFn: getQueryFn({ on401: "throw" }),
      }) as Promise<{ aiProvider: "gemini" | "openai" | null; aiAgentEnabled: boolean }>,
      queryClient.fetchQuery({
        queryKey: ["/api/user/ai-credentials"],
        queryFn: getQueryFn({ on401: "throw" }),
      }) as Promise<{ hasGeminiApiKey: boolean; hasOpenAiApiKey: boolean }>,
    ]);

    return evaluateAiReadiness(preferencesResult, credentialsResult);
  };

  const showAiSetupRequired = (message: string) => {
    toast({
      title: "AI setup required",
      description: message,
      variant: "destructive",
      action: (
        <ToastAction altText="Open settings" onClick={() => openSettingsForTab("ai-preferences")}>
          Open Settings
        </ToastAction>
      ),
    });
    openSettingsForTab("ai-preferences");
  };

  const { data: uiPreferencesData } = useQuery<Partial<UserUiPreferences> | null>({
    queryKey: ["/api/user/ui-preferences"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: Infinity,
    retry: false,
  });

  useEffect(() => {
    if (uiPreferencesData === undefined) {
      return;
    }

    const includeMinorPref = uiPreferencesData?.includeMinor;
    const includeMajorPref = uiPreferencesData?.includeMajor;
    const deferredOnlyPref = uiPreferencesData?.deferredOnly;
    const sortByPref = uiPreferencesData?.sortBy;
    const dateFilterPref = uiPreferencesData?.dateFilter;
    const categoryFiltersPref = uiPreferencesData?.categoryFilters;

    if (typeof includeMinorPref === "boolean") {
      setIncludeMinor(includeMinorPref);
    }
    if (typeof includeMajorPref === "boolean") {
      setIncludeMajor(includeMajorPref);
    }
    if (typeof deferredOnlyPref === "boolean") {
      setDeferredOnly(deferredOnlyPref);
    }
    if (sortByPref === "default" || sortByPref === "nextDate") {
      setSortBy(sortByPref);
    }
    if (dateFilterPref === null || (typeof dateFilterPref === "number" && Number.isInteger(dateFilterPref) && dateFilterPref >= 0)) {
      setDateFilter(dateFilterPref);
    }
    if (Array.isArray(categoryFiltersPref)) {
      setPreferredCategories(categoryFiltersPref.filter((entry): entry is string => typeof entry === "string"));
    } else {
      setPreferredCategories(null);
    }

    const initialSnapshot = {
      includeMinor: typeof includeMinorPref === "boolean" ? includeMinorPref : true,
      includeMajor: typeof includeMajorPref === "boolean" ? includeMajorPref : true,
      deferredOnly: typeof deferredOnlyPref === "boolean" ? deferredOnlyPref : false,
      sortBy: sortByPref === "nextDate" ? "nextDate" : "default",
      dateFilter:
        dateFilterPref === null || (typeof dateFilterPref === "number" && Number.isInteger(dateFilterPref) && dateFilterPref >= 0)
          ? dateFilterPref
          : null,
      categoryFilters: Array.isArray(categoryFiltersPref)
        ? categoryFiltersPref.filter((entry): entry is string => typeof entry === "string")
        : [],
    };
    lastSavedUiPrefRef.current = JSON.stringify(initialSnapshot);
    setUiPreferencesReady(true);
  }, [uiPreferencesData]);

  useEffect(() => {
    const openSettings = (event: Event) => {
      const customEvent = event as CustomEvent<{ tab?: UiSettingsTab }>;
      setSettingsInitialTab(customEvent.detail?.tab);
      setShowSettingsModal(true);
    };

    window.addEventListener(OPEN_SETTINGS_EVENT, openSettings as EventListener);
    return () => {
      window.removeEventListener(OPEN_SETTINGS_EVENT, openSettings as EventListener);
    };
  }, []);

  // Update category filters when tasks change
  // Note: tasks are already filtered by templateId from the backend API
  useEffect(() => {
    // Avoid a render loop while query data is undefined/loading.
    if (tasks.length === 0) {
      setCategoryFilters((prev) => (prev.length === 0 ? prev : []));
      return;
    }

    const categoryCounts = tasks.reduce((acc, task) => {
      acc[task.category] = (acc[task.category] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const newFilters = Object.entries(categoryCounts).map(([category, count]) => ({
      category,
      color: categoryColors[category as keyof typeof categoryColors] || "bg-gray-500",
      count,
      checked: true,
    }));

    // Only update if the categories have actually changed
    setCategoryFilters(prev => {
      const preferred = preferredCategories;
      if (prev.length === 0) {
        if (!preferred) {
          return newFilters;
        }
        return newFilters.map((filter) => ({
          ...filter,
          checked: preferred.includes(filter.category),
        }));
      }
      
      // Check if categories changed by comparing category names
      const prevCategories = prev.map(f => f.category).sort().join(',');
      const newCategories = newFilters.map(f => f.category).sort().join(',');
      
      if (prevCategories !== newCategories) {
        if (!preferred) {
          return newFilters;
        }
        return newFilters.map((filter) => {
          const existing = prev.find((entry) => entry.category === filter.category);
          return {
            ...filter,
            checked: existing ? existing.checked : preferred.includes(filter.category),
          };
        });
      }
      
      // Update counts only, preserve checked state
      const updated = prev.map(filter => {
        const newFilter = newFilters.find(f => f.category === filter.category);
        return newFilter ? { ...filter, count: newFilter.count } : filter;
      });

      // If counts and checked state are unchanged, keep previous reference.
      const changed = updated.some((f, idx) => f.count !== prev[idx]?.count || f.checked !== prev[idx]?.checked);
      return changed ? updated : prev;
    });
  }, [tasks, preferredCategories]);

  useEffect(() => {
    if (!uiPreferencesReady || tasksLoading) {
      return;
    }

    const payload = {
      includeMinor,
      includeMajor,
      deferredOnly,
      sortBy,
      dateFilter,
      categoryFilters: categoryFilters.filter((entry) => entry.checked).map((entry) => entry.category),
    };
    const snapshot = JSON.stringify(payload);
    if (snapshot === lastSavedUiPrefRef.current) {
      return;
    }

    if (persistTimerRef.current) {
      clearTimeout(persistTimerRef.current);
    }

    persistTimerRef.current = setTimeout(async () => {
      try {
        await apiRequest("PATCH", "/api/user/ui-preferences", payload);
        lastSavedUiPrefRef.current = snapshot;
      } catch (error) {
        console.error("Failed to persist dashboard UI preferences:", error);
      }
    }, 350);

    return () => {
      if (persistTimerRef.current) {
        clearTimeout(persistTimerRef.current);
      }
    };
  }, [
    uiPreferencesReady,
    tasksLoading,
    includeMinor,
    includeMajor,
    deferredOnly,
    sortBy,
    dateFilter,
    categoryFilters,
  ]);

  const currentUiPreferenceSnapshot = useMemo(() => {
    if (!uiPreferencesReady || tasksLoading) {
      return null;
    }

    const payload = {
      includeMinor,
      includeMajor,
      deferredOnly,
      sortBy,
      dateFilter,
      categoryFilters: categoryFilters.filter((entry) => entry.checked).map((entry) => entry.category),
    };

    return JSON.stringify(payload);
  }, [
    uiPreferencesReady,
    tasksLoading,
    includeMinor,
    includeMajor,
    deferredOnly,
    sortBy,
    dateFilter,
    categoryFilters,
  ]);

  useEffect(() => {
    if (!currentUiPreferenceSnapshot) {
      return;
    }

    if (currentUiPreferenceSnapshot === lastSavedUiPrefRef.current) {
      return;
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [currentUiPreferenceSnapshot]);

  const toggleCategoryFilter = (category: string) => {
    setCategoryFilters(prev => 
      prev.map(filter => 
        filter.category === category 
          ? { ...filter, checked: !filter.checked }
          : filter
      )
    );
  };

  const toggleAllCategories = () => {
    const allChecked = categoryFilters.every(f => f.checked);
    setCategoryFilters(prev => 
      prev.map(filter => ({ ...filter, checked: !allChecked }))
    );
  };

  const hasAITaskLists = (task: MaintenanceTask) => {
    try {
      const minorTasks = task.minorTasks ? JSON.parse(task.minorTasks) : [];
      const majorTasks = task.majorTasks ? JSON.parse(task.majorTasks) : [];
      return (Array.isArray(minorTasks) && minorTasks.length > 0) || 
             (Array.isArray(majorTasks) && majorTasks.length > 0);
    } catch {
      return false;
    }
  };

  const handleAIScheduleForCategory = async (categoryName: string, includeAll: boolean = true, showNoItemsAlert: boolean = true) => {
    if (aiReadinessLoading) {
      showAiSetupRequired("AI setup is still loading. Please try again in a moment.");
      return;
    }

    const latestAiReadiness = await refreshAiReadiness();
    if (!latestAiReadiness.ready) {
      showAiSetupRequired(latestAiReadiness.message);
      return;
    }

    // If already loading, ask to cancel
    if (loadingCategories[categoryName]) {
      const confirmCancel = window.confirm(`AI generation is in progress for ${categoryName}. Do you want to cancel it?`);
      if (confirmCancel && abortControllers[categoryName]) {
        // Abort the request
        abortControllers[categoryName].abort();
        // Clean up state
        setLoadingCategories(prev => ({ ...prev, [categoryName]: false }));
        setAbortControllers(prev => {
          const { [categoryName]: _, ...rest } = prev;
          return rest;
        });
        console.log('AI generation cancelled for', categoryName);
      }
      return;
    }

    // Create a new AbortController for this request
    const controller = new AbortController();
    setAbortControllers(prev => ({ ...prev, [categoryName]: controller }));
    setLoadingCategories(prev => ({ ...prev, [categoryName]: true }));
    
    try {
      const safeParseMaintenanceDate = (value: unknown) => {
        if (typeof value !== "string") return { minor: null, major: null };
        return parseMaintenanceSchedule(value);
      };

      // Get all tasks for this category
      let categoryTasks = tasks.filter(task => task.category === categoryName);
      
      // Filter to only tasks without AI suggestions if includeAll is false
      if (!includeAll) {
        categoryTasks = categoryTasks.filter(task => !hasAITaskLists(task));
        if (categoryTasks.length === 0) {
          if (showNoItemsAlert) {
            alert(`All items in ${categoryName} already have AI suggestions.`);
          }
          return;
        }
      }
      
      // Build the householdCatalog structure for this category
      const householdCatalog = [{
        categoryName,
        items: categoryTasks.map(task => ({
          id: task.id,
          name: task.title,
          brand: task.brand || "",
          model: task.model || "",
          installationDate: task.installationDate || "",
          lastMaintenanceDate: safeParseMaintenanceDate(task.lastMaintenanceDate),
          nextMaintenanceDate: safeParseMaintenanceDate(task.nextMaintenanceDate),
          location: task.location || "",
          notes: task.notes || ""
        }))
      }];

      const response = await fetchWithBackoff('/api/category-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ householdCatalog }),
        signal: controller.signal
      });

      if (!response.ok) {
        let message = 'Failed to generate AI schedule';
        try {
          const payload = await response.json();
          if (payload?.error) {
            message = `${message}: ${payload.error}`;
          } else if (payload?.message) {
            message = `${message}: ${payload.message}`;
          }
        } catch {
          // Ignore non-JSON error bodies and keep default message.
        }
        throw new Error(message);
      }

      const result = await response.json();
      console.log('AI Schedule Results for', categoryName, ':', result);
      
      // Invalidate queries to refresh the UI
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      
      // Show success message
      const summary = result?.summary;
      const updatedCount = summary?.updated ?? result.updatedCount ?? categoryTasks.length;
      const failedCount = summary?.failed ?? 0;
      const fallbackUsed = summary?.fallbackUsed ?? 0;
      const repaired = summary?.repaired ?? 0;

      let message = `AI schedule finished for ${categoryName}: ${updatedCount} updated`;
      if (failedCount > 0) message += `, ${failedCount} failed`;
      if (fallbackUsed > 0) message += `, ${fallbackUsed} used fallback provider`;
      if (repaired > 0) message += `, ${repaired} auto-repaired`;
      message += ".";

      alert(message);
    } catch (error) {
      // Don't show error if request was aborted
      if (error instanceof Error && error.name === 'AbortError') {
        console.log('AI generation aborted for', categoryName);
        alert(`AI generation cancelled for ${categoryName}`);
      } else {
        console.error('Error generating AI schedule:', error);
        const detail = error instanceof Error ? `\n${error.message}` : "";
        alert(`Failed to generate AI schedule for ${categoryName}${detail}`);
      }
    } finally {
      setLoadingCategories(prev => ({ ...prev, [categoryName]: false }));
      setAbortControllers(prev => {
        const { [categoryName]: _, ...rest } = prev;
        return rest;
      });
    }
  };

  const handleAIScheduleForAllCategories = async (includeAll: boolean) => {
    if (aiReadinessLoading) {
      showAiSetupRequired("AI setup is still loading. Please try again in a moment.");
      return;
    }

    const latestAiReadiness = await refreshAiReadiness();
    if (!latestAiReadiness.ready) {
      showAiSetupRequired(latestAiReadiness.message);
      return;
    }

    // Get all checked categories
    const checkedCategories = categoryFilters.filter(f => f.checked);
    
    // If not includeAll, pre-filter to only categories with items without AI suggestions
    let categoriesToProcess = checkedCategories;
    if (!includeAll) {
      categoriesToProcess = checkedCategories.filter(filter => {
        const categoryTasks = tasks.filter(task => task.category === filter.category);
        const tasksWithoutAI = categoryTasks.filter(task => !hasAITaskLists(task));
        return tasksWithoutAI.length > 0;
      });
      
      if (categoriesToProcess.length === 0) {
        alert("All items in the selected categories already have AI suggestions.");
        return;
      }
    }
    
    const confirmMessage = includeAll 
      ? "Generate AI suggestions for all items in all categories? This may take a while."
      : `Generate AI suggestions for items without existing suggestions in ${categoriesToProcess.length} ${categoriesToProcess.length === 1 ? 'category' : 'categories'}? This may take a while.`;
    
    if (!window.confirm(confirmMessage)) {
      return;
    }
    
    // Process all categories in parallel
    const promises = categoriesToProcess.map(filter => 
      handleAIScheduleForCategory(filter.category, includeAll, false)
    );
    
    try {
      await Promise.all(promises);
      alert(`AI generation complete for ${categoriesToProcess.length} ${categoriesToProcess.length === 1 ? 'category' : 'categories'}!`);
    } catch (error) {
      console.error('Error in parallel AI generation:', error);
      // Individual errors are already handled in handleAIScheduleForCategory
    }
  };

  // Helper function to check if a maintenance date passes the date filter
  const passesDateFilter = (maintenanceDate: string | null): boolean => {
    if (!maintenanceDate) return false;
    if (dateFilter === null) return true; // Show all
    
    const todayDateOnly = toDateOnlyFromLocalDate(new Date());
    const daysDiff = dayDiffDateOnly(maintenanceDate, todayDateOnly);
    if (daysDiff === null) {
      return false;
    }

    if (dateFilter === 0) {
      return daysDiff < 0; // Past due only
    }
    if (dateFilter > 0) {
      return daysDiff <= dateFilter; // Past due + within specified days
    }

    return false;
  };

  const parseOverdueBacklog = (raw: string | null | undefined): { minor: boolean; major: boolean } => {
    if (!raw) {
      return { minor: false, major: false };
    }

    try {
      const parsed = JSON.parse(raw) as { minor?: boolean; major?: boolean };
      return {
        minor: !!parsed?.minor,
        major: !!parsed?.major,
      };
    } catch {
      return { minor: false, major: false };
    }
  };

  const isTypeOverdue = (
    maintenanceDate: string | null | undefined,
    backlogFlag: boolean,
    todayDateOnly: string,
  ): boolean => {
    if (backlogFlag) {
      return true;
    }

    const dateOnly = typeof maintenanceDate === "string" ? maintenanceDate : null;
    if (!dateOnly) {
      return false;
    }

    return compareDateOnly(dateOnly, todayDateOnly) < 0;
  };

  // Calculate which maintenance types to show for each task
  interface TaskWithFilters extends MaintenanceTask {
    showMinor: boolean;
    showMajor: boolean;
    hasDeferredBacklog: boolean;
  }

  const filteredTasks: TaskWithFilters[] = tasks
    .filter(task => {
      // First apply category filter
      const categoryChecked = categoryFilters.find(f => f.category === task.category)?.checked ?? true;
      return categoryChecked;
    })
    .map(task => {
      // For each task, determine which maintenance types to show
      let showMinor = false;
      let showMajor = false;
      const todayDateOnly = toDateOnlyFromLocalDate(new Date());
      const backlog = parseOverdueBacklog(task.overdueBacklog);

      try {
        const nextMaintenance = task.nextMaintenanceDate ? JSON.parse(task.nextMaintenanceDate) : null;
        
        // Check minor maintenance
        if (includeMinor) {
          if (dateFilter === null) {
            // No date filter - show if it exists
            showMinor = !!nextMaintenance?.minor;
          } else {
            // dateFilter=0: include overdue-by-date OR deferred backlog.
            if (dateFilter === 0) {
              showMinor = isTypeOverdue(nextMaintenance?.minor ?? null, backlog.minor, todayDateOnly);
            } else {
              showMinor = passesDateFilter(nextMaintenance?.minor ?? null);
            }
          }
        }

        // Check major maintenance
        if (includeMajor) {
          if (dateFilter === null) {
            // No date filter - show if it exists
            showMajor = !!nextMaintenance?.major;
          } else {
            // dateFilter=0: include overdue-by-date OR deferred backlog.
            if (dateFilter === 0) {
              showMajor = isTypeOverdue(nextMaintenance?.major ?? null, backlog.major, todayDateOnly);
            } else {
              showMajor = passesDateFilter(nextMaintenance?.major ?? null);
            }
          }
        }

        // If task has no maintenance dates at all, show it with both flags true (but sections won't render if dates don't exist)
        if (!nextMaintenance || (!nextMaintenance.minor && !nextMaintenance.major)) {
          showMinor = includeMinor;
          showMajor = includeMajor;
        }
      } catch {
        // On error, default to showing based on type filters
        showMinor = includeMinor;
        showMajor = includeMajor;
      }

      return {
        ...task,
        showMinor,
        showMajor,
        hasDeferredBacklog: backlog.minor || backlog.major,
      };
    })
    .filter(task => {
      // Only show tasks where at least one maintenance type passes the filters
      if (!(task.showMinor || task.showMajor)) {
        return false;
      }

      if (deferredOnly) {
        return task.hasDeferredBacklog;
      }

      return true;
    });

  // Remove old filtering logic
  const dateFilteredTasks = filteredTasks;

  // Sort tasks based on selected option
  const sortedTasks = [...dateFilteredTasks].sort((a, b) => {
    if (sortBy === "nextDate") {
      // Get the closer nextMaintenanceDate for each task
      const getCloserDate = (task: MaintenanceTask): string | null => {
        try {
          if (!task.nextMaintenanceDate) return null;
          const nextDates = parseMaintenanceSchedule(task.nextMaintenanceDate);
          const minorDate = nextDates.minor;
          const majorDate = nextDates.major;
          
          if (!minorDate && !majorDate) return null;
          if (!minorDate) return majorDate;
          if (!majorDate) return minorDate;
          
          return compareDateOnly(minorDate, majorDate) <= 0 ? minorDate : majorDate;
        } catch {
          return null;
        }
      };
      
      const dateA = getCloserDate(a);
      const dateB = getCloserDate(b);
      
      // Tasks without dates go to the end
      if (!dateA && !dateB) return 0;
      if (!dateA) return 1;
      if (!dateB) return -1;
      
      return compareDateOnly(dateA, dateB);
    }
    return 0; // Default: maintain original order
  });

  const selectedCount = selectedTaskIds.size;

  const toggleTaskSelected = (taskId: string, selected: boolean) => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (selected) {
        next.add(taskId);
      } else {
        next.delete(taskId);
      }
      return next;
    });
  };

  const allVisibleSelected = sortedTasks.length > 0 && sortedTasks.every((task) => selectedTaskIds.has(task.id));

  const toggleSelectAllVisible = () => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        for (const task of sortedTasks) {
          next.delete(task.id);
        }
      } else {
        for (const task of sortedTasks) {
          next.add(task.id);
        }
      }
      return next;
    });
  };

  const selectAllVisible = () => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      for (const task of sortedTasks) {
        next.add(task.id);
      }
      return next;
    });
  };

  const clearSelection = () => {
    setSelectedTaskIds(new Set());
  };

  const parseBulkFillErrorPayload = (error: unknown): {
    message?: string;
    violatingTasks?: Array<{ title?: string; id?: string; kind?: BulkFillKind; lastMaintenanceDate?: string | null }>;
    warningTasks?: Array<{ title?: string; id?: string; kind?: BulkFillKind; lastMaintenanceDate?: string; intervalMonths?: number }>;
    requiresConfirmation?: boolean;
  } | null => {
    if (!(error instanceof Error)) {
      return null;
    }

    const message = error.message || "";
    const match = message.match(/^\d+:\s*(\{[\s\S]*\})$/);
    if (!match) {
      return null;
    }

    try {
      return JSON.parse(match[1]);
    } catch {
      return null;
    }
  };

  const getBulkFillValidationMessage = (parsed: ReturnType<typeof parseBulkFillErrorPayload>): string | null => {
    if (!parsed) {
      return null;
    }

    const violating = Array.isArray(parsed.violatingTasks) ? parsed.violatingTasks : [];
    if (violating.length > 0) {
      const labels = violating.map((task) => {
        const label = task.title || task.id || "Unknown task";
        return task.kind ? `${label} (${task.kind})` : label;
      });
      const summary = labels.length <= 6 ? labels.join(", ") : `${labels.slice(0, 6).join(", ")}, and ${labels.length - 6} more`;
      return `Selected date is earlier than last maintenance for: ${summary}.`;
    }

    return parsed.message || null;
  };

  const submitBulkFill = async (
    payload: { date: string; mode: BulkFillMode; taskSelections: BulkFillTaskSelectionPayload[] },
    allowBeyondInterval = false,
  ) => {
    return apiRequest("POST", "/api/tasks/bulk-next-maintenance-date", {
      date: payload.date,
      mode: payload.mode,
      taskSelections: payload.taskSelections,
      allowBeyondInterval,
    });
  };

  const handleBulkFillSubmit = async (payload: { date: string; mode: BulkFillMode; taskSelections: BulkFillTaskSelectionPayload[] }) => {
    if (selectedTaskIds.size === 0) {
      toast({
        title: "No tasks selected",
        description: "Select at least one task before running bulk fill.",
        variant: "destructive",
      });
      return;
    }

    setBulkSubmitting(true);
    try {
      let response = await submitBulkFill(payload, false);
      const result = await response.json();

      await queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/stats"] });

      toast({
        title: "Bulk update complete",
        description: `Updated ${result.updated}, skipped ${result.skipped}, failed ${result.failed}.`,
      });

      setShowBulkFillModal(false);
      setSelectedTaskIds(new Set());
    } catch (error: any) {
      const parsed = parseBulkFillErrorPayload(error);
      const warningTasks = Array.isArray(parsed?.warningTasks) ? parsed.warningTasks : [];

      if (parsed?.requiresConfirmation && warningTasks.length > 0) {
        const labels = warningTasks.map((task) => {
          const label = task.title || task.id || "Unknown task";
          return task.kind ? `${label} (${task.kind})` : label;
        });
        const summary = labels.length <= 8 ? labels.join(", ") : `${labels.slice(0, 8).join(", ")}, and ${labels.length - 8} more`;
        const confirmed = window.confirm(
          `Warning: The selected date goes beyond recommended interval for: ${summary}. Continue anyway?`,
        );

        if (confirmed) {
          try {
            const confirmedResponse = await submitBulkFill(payload, true);
            const confirmedResult = await confirmedResponse.json();
            await queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
            await queryClient.invalidateQueries({ queryKey: ["/api/stats"] });

            toast({
              title: "Bulk update complete",
              description: `Updated ${confirmedResult.updated}, skipped ${confirmedResult.skipped}, failed ${confirmedResult.failed}.`,
            });

            setShowBulkFillModal(false);
            setSelectedTaskIds(new Set());
            return;
          } catch (secondError: any) {
            const secondParsed = parseBulkFillErrorPayload(secondError);
            toast({
              title: "Bulk update failed",
              description: getBulkFillValidationMessage(secondParsed) || secondError?.message || "Failed to apply bulk maintenance date update.",
              variant: "destructive",
            });
            return;
          }
        }

        toast({
          title: "Bulk update cancelled",
          description: "No changes were applied.",
        });
        return;
      }

      const validationMessage = getBulkFillValidationMessage(parsed);
      toast({
        title: "Bulk update failed",
        description: validationMessage || error?.message || "Failed to apply bulk maintenance date update.",
        variant: "destructive",
      });
    } finally {
      setBulkSubmitting(false);
    }
  };

  const selectedTasksForBulkFill = sortedTasks
    .filter((task) => selectedTaskIds.has(task.id))
    .map((task) => ({ id: task.id, title: task.title }));

  if (tasksLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  if (!templateId) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white shadow-sm border-b border-gray-200">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16">
              <h1 className="text-2xl font-bold text-primary">SimpleHome</h1>
              {user && <AccountMenu user={user} onSettingsClick={() => setShowSettingsModal(true)} />}
            </div>
          </div>
        </header>
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Your Properties</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {properties?.map(p => (
              <Card
                key={p.id}
                className="cursor-pointer hover:shadow-md transition-shadow border-2 border-transparent hover:border-primary"
                onClick={() => setLocation(`/dashboard/${p.id}`)}
              >
                <CardContent className="p-6 flex items-center gap-3">
                  <Home className="w-8 h-8 text-primary flex-shrink-0" />
                  <div>
                    <p className="font-semibold text-gray-900">{p.name}</p>
                    <p className="text-sm text-gray-500 capitalize">{p.type.replace("_", "-")}</p>
                  </div>
                </CardContent>
              </Card>
            ))}
            {(properties?.length ?? 0) < 5 && (
              <Card
                className="cursor-pointer hover:shadow-md transition-shadow border-2 border-dashed border-gray-300 hover:border-primary"
                onClick={() => setShowAddPropertyModal(true)}
              >
                <CardContent className="p-6 flex items-center gap-3 text-gray-500 hover:text-primary">
                  <Plus className="w-8 h-8 flex-shrink-0" />
                  <p className="font-medium">Add Property</p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
        <UserSettingsModal
          isOpen={showSettingsModal}
          onClose={() => { setShowSettingsModal(false); setSettingsInitialTab(undefined); }}
          currentTimezone={user?.timezone ?? null}
          currentName={user?.name ?? ""}
          initialTab={settingsInitialTab}
        />
        <AddPropertyModal
          isOpen={showAddPropertyModal}
          onClose={() => setShowAddPropertyModal(false)}
          onSuccess={(template) => {
            setShowAddPropertyModal(false);
            queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
            setLocation(`/dashboard/${template.id}`);
          }}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div className="flex items-center">
              <Link href="/">
                <h1 className="text-2xl font-bold text-primary cursor-pointer">🏠 SimpleHome</h1>
              </Link>
            </div>
            <nav className="hidden md:flex items-center">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" className="gap-1 font-medium">
                    {currentProperty?.name ?? "Select Property"}
                    <ChevronDown className="h-3 w-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {properties?.map(p => (
                    <DropdownMenuItem key={p.id} onClick={() => setLocation(`/dashboard/${p.id}`)}>
                      {p.id === templateId
                        ? <span className="font-medium">{p.name} ✓</span>
                        : p.name}
                    </DropdownMenuItem>
                  ))}
                  {(properties?.length ?? 0) < 5 && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setShowAddPropertyModal(true)}>
                        <Plus className="h-3 w-3 mr-2" /> Add Property
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </nav>
            <div className="flex items-center space-x-3">
              {user && (
                <AccountMenu
                  user={user}
                  onSettingsClick={() => setShowSettingsModal(true)}
                />
              )}
              <Button onClick={() => setShowAddTaskModal(true)} className="bg-primary text-white hover:bg-blue-700" title="Add a new custom maintenance item or task">
                <Plus className="w-4 h-4 mr-2" />
                Add Item / Task
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* Sidebar */}
          <div className="lg:col-span-1">
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="text-lg">Quick Actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Button 
                  onClick={() => setShowAddTaskModal(true)}
                  className="w-full bg-primary text-white hover:bg-blue-700"
                  title="Create a new custom maintenance item or task"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add Custom Item / Task
                </Button>
                <Button 
                  variant="outline" 
                  className="w-full" 
                  title="Export your maintenance schedule to a file"
                  onClick={() => setShowExportModal(true)}
                >
                  📋 Export Schedule
                </Button>
              </CardContent>
            </Card>

            {/* Maintenance Type Filter */}
            <Card className="mb-6">
              <CardHeader>
                <CardTitle className="text-lg">Maintenance Type</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex items-center space-x-2" title="Show tasks with minor maintenance scheduled">
                  <Checkbox
                    id="include-minor"
                    checked={includeMinor}
                    onCheckedChange={(checked) => setIncludeMinor(checked === true)}
                  />
                  <label htmlFor="include-minor" className="text-sm cursor-pointer">
                    Include Minor Maintenance
                  </label>
                </div>
                <div className="flex items-center space-x-2" title="Show tasks with major maintenance scheduled">
                  <Checkbox
                    id="include-major"
                    checked={includeMajor}
                    onCheckedChange={(checked) => setIncludeMajor(checked === true)}
                  />
                  <label htmlFor="include-major" className="text-sm cursor-pointer">
                    Include Major Maintenance
                  </label>
                </div>
                {!includeMinor && !includeMajor && (
                  <p className="text-xs text-red-600 mt-1">At least one type must be selected</p>
                )}
              </CardContent>
            </Card>

            {/* Category Filter */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Categories</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {/* Select All Checkbox */}
                <div className="flex items-center space-x-2 pb-2 border-b" title="Toggle selection of all categories at once">
                  <Checkbox
                    checked={categoryFilters.every(f => f.checked)}
                    onCheckedChange={toggleAllCategories}
                  />
                  <span className="text-sm font-medium">Select/Deselect All</span>
                </div>
                {categoryFilters.map((filter) => (
                  <div key={filter.category} className="flex items-center space-x-2 group" title={`Filter items by ${filter.category} category`}>
                    <Checkbox
                      checked={filter.checked}
                      onCheckedChange={() => toggleCategoryFilter(filter.category)}
                    />
                    <span className="text-sm flex-1">{filter.category}</span>
                    {loadingCategories[filter.category] ? (
                      <>
                        <div className="animate-spin h-3 w-3 border-2 border-primary border-t-transparent rounded-full" />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs"
                          onClick={() => handleAIScheduleForCategory(filter.category)}
                          title="Cancel AI generation"
                        >
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => handleAIScheduleForCategory(filter.category, false)}
                        title="Generate AI schedule for items without suggestions"
                      >
                        <Sparkles className="h-3 w-3 text-purple-600" />
                      </Button>
                    )}
                    <Badge variant="secondary" className="text-xs">
                      {filter.count}
                    </Badge>
                  </div>
                ))}
                <div className="pt-3 border-t space-y-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-xs"
                    onClick={() => handleAIScheduleForAllCategories(false)}
                    disabled={Object.values(loadingCategories).some(loading => loading)}
                    title="Generate AI maintenance schedules for items that don't have suggestions yet"
                  >
                    <Sparkles className="h-3 w-3 mr-2" />
                    AI for Items Without Suggestions
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full text-xs"
                    onClick={() => handleAIScheduleForAllCategories(true)}
                    disabled={Object.values(loadingCategories).some(loading => loading)}
                    title="Generate or regenerate AI maintenance schedules for all items in selected categories"
                  >
                    <Sparkles className="h-3 w-3 mr-2" />
                    AI for All Items
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Main Content */}
          <div className="lg:col-span-3">
            {/* Stats Overview */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <Card>
                <CardContent className="p-6">
                  <div className="flex items-center">
                    <div className="bg-blue-100 rounded-lg p-3">
                      <ClipboardList className="w-6 h-6 text-blue-600" />
                    </div>
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-600">Total Items / Tasks</p>
                      <p className="text-2xl font-bold text-gray-900">{tasks.length}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card 
                className={cn(
                  "cursor-pointer hover:shadow-lg transition-all",
                  dateFilter === 0 && "ring-2 ring-red-500 shadow-lg"
                )}
                onClick={() => setDateFilter(dateFilter === 0 ? null : 0)}
                title={dateFilter === 0 ? "Click to clear overdue filter" : "Click to filter and show only overdue tasks"}
              >
                <CardContent className="p-6">
                  <div className="flex items-center">
                    <div className="bg-red-100 rounded-lg p-3">
                      <ClipboardList className="w-6 h-6 text-red-600" />
                    </div>
                    <div className="ml-4">
                      <p className="text-sm font-medium text-gray-600 flex items-center gap-1">
                        Over Due 
                        {dateFilter === 0 && <span className="text-red-600">🔍</span>}
                      </p>
                      <p className="text-2xl font-bold text-gray-900">{stats?.pastDue || 0}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>

            </div>

            {/* Tasks Section */}
            <Card>
              <CardHeader>
                <div className="flex flex-col gap-3">
                  <CardTitle className="text-lg">Items / Tasks</CardTitle>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant={selectedCount > 0 ? "default" : "outline"}
                      onClick={() => setShowBulkFillModal(true)}
                      disabled={selectedCount === 0}
                    >
                      Bulk Fill Dates ({selectedCount})
                    </Button>
                    <Button
                      variant="outline"
                      onClick={selectAllVisible}
                      disabled={sortedTasks.length === 0}
                    >
                      Select All
                    </Button>
                    <Button
                      variant="outline"
                      onClick={clearSelection}
                      disabled={selectedCount === 0}
                    >
                      Clear Selection
                    </Button>
                    <Button
                      variant="outline"
                      onClick={toggleSelectAllVisible}
                      disabled={sortedTasks.length === 0}
                    >
                      {allVisibleSelected ? "Unselect Visible" : "Select Visible"}
                    </Button>
                    <label className="flex items-center gap-2 px-2 text-sm text-gray-600 whitespace-nowrap">
                      <Checkbox
                        checked={deferredOnly}
                        onCheckedChange={(value) => setDeferredOnly(!!value)}
                      />
                      Deferred only
                    </label>
                    <div className="flex items-center gap-2">
                      <label htmlFor="dateRange" className="text-sm text-gray-600 whitespace-nowrap">Due within:</label>
                      <input
                        id="dateRange"
                        type="number"
                        min="0"
                        placeholder="All"
                        value={dateFilter === null ? "" : dateFilter}
                        onChange={(e) => {
                          const value = e.target.value;
                          setDateFilter(value === "" ? null : parseInt(value, 10));
                        }}
                        className="w-20 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                      />
                      <span className="text-sm text-gray-600">days {dateFilter === 0 ? "(past due only)" : dateFilter !== null ? "(incl. past due)" : ""}</span>
                    </div>
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as "default" | "nextDate")}
                      className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                    >
                      <option value="default">Sort: Default</option>
                      <option value="nextDate">Sort: Next Due Date</option>
                    </select>
                    <div className="relative">
                      <Search className="w-5 h-5 text-gray-400 absolute left-3 top-2.5" />
                      <Input
                        placeholder="Search Items / Tasks..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="pl-10 w-full sm:w-64"
                      />
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {sortedTasks.map((task) => (
                    <TaskCard 
                      key={task.id} 
                      task={task} 
                      showMinor={task.showMinor}
                      showMajor={task.showMajor}
                      selectable={true}
                      selected={selectedTaskIds.has(task.id)}
                      onToggleSelected={toggleTaskSelected}
                    />
                  ))}
                  {sortedTasks.length === 0 && (
                    <div className="text-center py-8 text-gray-500">
                      <ClipboardList className="w-12 h-12 mx-auto mb-4 text-gray-300" />
                      <p>No Items / Tasks match your current filters.</p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Modals */}
      {showAddTaskModal && (
        <AddTaskModal
          isOpen={showAddTaskModal}
          onClose={() => setShowAddTaskModal(false)}
        />
      )}
      
      {showExportModal && (
        <ExportScheduleModal
          isOpen={showExportModal}
          onClose={() => setShowExportModal(false)}
          tasks={sortedTasks}
          initialIncludeMinor={includeMinor}
          initialIncludeMajor={includeMajor}
        />
      )}

      <UserSettingsModal
        isOpen={showSettingsModal}
        onClose={() => {
          setShowSettingsModal(false);
          setSettingsInitialTab(undefined);
        }}
        currentTimezone={user?.timezone ?? null}
        currentName={user?.name ?? ""}
        initialTab={settingsInitialTab}
      />

      <BulkFillDatesModal
        isOpen={showBulkFillModal}
        onClose={() => setShowBulkFillModal(false)}
        selectedCount={selectedCount}
        selectedTasks={selectedTasksForBulkFill}
        isSubmitting={bulkSubmitting}
        onSubmit={handleBulkFillSubmit}
      />

      <AddPropertyModal
        isOpen={showAddPropertyModal}
        onClose={() => setShowAddPropertyModal(false)}
        onSuccess={(template) => {
          setShowAddPropertyModal(false);
          queryClient.invalidateQueries({ queryKey: ["/api/properties"] });
          setLocation(`/dashboard/${template.id}`);
        }}
      />
    </div>
  );
}
