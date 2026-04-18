import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  addMonthsToDateOnly,
  compareDateOnly,
  MaintenanceTask,
  normalizeCalendarExports,
  normalizeDateOnly,
  parseMaintenanceSchedule,
  serializeMaintenanceSchedule,
  toDateOnlyFromLocalDate,
  User,
} from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Edit2, Trash2, Sparkles, CheckCircle2, Calendar as CalendarIcon } from "lucide-react";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import EditTaskModal from "./edit-task-modal";
import { toStorageDate, formatDateInTimezone } from "@/components/user-settings-modal";

interface TaskCardProps {
  task: MaintenanceTask;
  showMinor?: boolean; // Whether to show minor maintenance section
  showMajor?: boolean; // Whether to show major maintenance section
}

const categoryColors = {
  HVAC: "bg-red-500 text-white",
  Plumbing: "bg-blue-500 text-white", 
  Electrical: "bg-yellow-500 text-white",
  Exterior: "bg-green-500 text-white",
  Interior: "bg-purple-500 text-white",
  Safety: "bg-orange-500 text-white",
  Landscaping: "bg-emerald-500 text-white",
};

const priorityColors = {
  Urgent: "bg-red-100 text-red-800",
  High: "bg-orange-100 text-orange-800",
  Medium: "bg-yellow-100 text-yellow-800",
  Low: "bg-blue-100 text-blue-800",
};

export default function TaskCard({ task, showMinor = true, showMajor = true }: TaskCardProps) {
  const [isCompleting, setIsCompleting] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [isMinorCalendarOpen, setIsMinorCalendarOpen] = useState(false);
  const [isMajorCalendarOpen, setIsMajorCalendarOpen] = useState(false);
  const [isLoadingAI, setIsLoadingAI] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: user } = useQuery<User>({
    queryKey: ["/api/auth/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: Infinity,
    retry: false,
  });
  const userTimezone = user?.timezone ?? null;

  const updateTaskMutation = useMutation({
    mutationFn: async (updates: Partial<MaintenanceTask>) => {
      const response = await apiRequest("PATCH", `/api/tasks/${task.id}`, updates);
      return response.json();
    },
    onSuccess: (data) => {
      console.log('[Task Updated] Server returned:', data);
      if (data.lastMaintenanceDate) {
        console.log('[Task Updated] lastMaintenanceDate:', JSON.parse(data.lastMaintenanceDate));
      }
      if (data.nextMaintenanceDate) {
        console.log('[Task Updated] nextMaintenanceDate:', JSON.parse(data.nextMaintenanceDate));
      }
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({
        title: "Task updated",
        description: "Task has been updated successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update task",
        variant: "destructive",
      });
    },
  });

  const deleteTaskMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", `/api/tasks/${task.id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({
        title: "Task deleted",
        description: "Task has been deleted successfully.",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to delete task",
        variant: "destructive",
      });
    },
  });

  const handleMinorDateSelect = async (date: Date | undefined) => {
    if (!date) {
      setIsMinorCalendarOpen(false);
      return;
    }
    
    setIsCompleting(true);
    setIsMinorCalendarOpen(false);
    
    try {
      const lastMaintenance = parseMaintenanceSchedule(task.lastMaintenanceDate);
      const nextMaintenance = parseMaintenanceSchedule(task.nextMaintenanceDate);
      
      lastMaintenance.minor = toStorageDate(date);
      
      // Calculate nextMaintenanceDate.minor based on formula: lastMaintenanceDate.minor + minorIntervalMonths
      if (task.minorIntervalMonths) {
        const nextDateOnly = addMonthsToDateOnly(lastMaintenance.minor, task.minorIntervalMonths);
        nextMaintenance.minor = nextDateOnly;
        console.log('[Minor Complete] Setting next minor date to:', nextDateOnly, 'from', lastMaintenance.minor, '+', task.minorIntervalMonths, 'months');
      } else {
        console.warn('[Minor Complete] No minorIntervalMonths defined for task:', task.title);
        toast({
          title: "Missing Interval",
          description: "This task doesn't have a minor maintenance interval. Please use AI to generate a schedule or edit the task to set intervals.",
          variant: "destructive",
        });
        // Don't update if no interval is defined
        setIsCompleting(false);
        return;
      }
      
      const updates: Partial<MaintenanceTask> = {
        lastMaintenanceDate: serializeMaintenanceSchedule(lastMaintenance),
        nextMaintenanceDate: serializeMaintenanceSchedule(nextMaintenance),
      };
      
      console.log('[Minor Complete] Updating task with:', updates);

      updateTaskMutation.mutate(updates);
    } catch (error) {
      console.error('Error updating minor maintenance:', error);
    } finally {
      setIsCompleting(false);
    }
  };

  const handleMajorDateSelect = async (date: Date | undefined) => {
    if (!date) {
      setIsMajorCalendarOpen(false);
      return;
    }
    
    setIsCompleting(true);
    setIsMajorCalendarOpen(false);
    
    try {
      const lastMaintenance = parseMaintenanceSchedule(task.lastMaintenanceDate);
      const nextMaintenance = parseMaintenanceSchedule(task.nextMaintenanceDate);
      
      lastMaintenance.major = toStorageDate(date);
      
      // Calculate nextMaintenanceDate.major based on formula: lastMaintenanceDate.major + majorIntervalMonths
      if (task.majorIntervalMonths) {
        const nextDateOnly = addMonthsToDateOnly(lastMaintenance.major, task.majorIntervalMonths);
        nextMaintenance.major = nextDateOnly;
        console.log('[Major Complete] Setting next major date to:', nextDateOnly, 'from', lastMaintenance.major, '+', task.majorIntervalMonths, 'months');
      } else {
        console.warn('[Major Complete] No majorIntervalMonths defined for task:', task.title);
        toast({
          title: "Missing Interval",
          description: "This task doesn't have a major maintenance interval. Please use AI to generate a schedule or edit the task to set intervals.",
          variant: "destructive",
        });
        // Don't update if no interval is defined
        setIsCompleting(false);
        return;
      }
      
      const updates: Partial<MaintenanceTask> = {
        lastMaintenanceDate: serializeMaintenanceSchedule(lastMaintenance),
        nextMaintenanceDate: serializeMaintenanceSchedule(nextMaintenance),
      };
      
      console.log('[Major Complete] Updating task with:', updates);

      updateTaskMutation.mutate(updates);
    } catch (error) {
      console.error('Error updating major maintenance:', error);
    } finally {
      setIsCompleting(false);
    }
  };

  const handleDelete = () => {
    if (window.confirm("Are you sure you want to delete this task?")) {
      deleteTaskMutation.mutate();
    }
  };

  const handleAISchedule = async () => {
    setIsLoadingAI(true);
    
    try {
      // Build the item structure for API call
      const item = {
        id: task.id,
        name: task.title,
        brand: task.brand || "",
        model: task.model || "",
        installationDate: task.installationDate || "",
        lastMaintenanceDate: parseMaintenanceSchedule(task.lastMaintenanceDate),
        nextMaintenanceDate: parseMaintenanceSchedule(task.nextMaintenanceDate),
        location: task.location || "",
        notes: task.notes || ""
      };

      const response = await fetch('/api/item-schedule', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item })
      });

      if (!response.ok) {
        throw new Error('Failed to generate AI schedule');
      }

      const data = await response.json();
      const result = data.result;
      
      // Update the task with AI results
      const updates: any = {};
      
      if (result.nextMaintenanceDates) {
        updates.nextMaintenanceDate = serializeMaintenanceSchedule({
          minor: normalizeDateOnly(result.nextMaintenanceDates.minor || null),
          major: normalizeDateOnly(result.nextMaintenanceDates.major || null),
        });
      }
      
      if (result.maintenanceSchedule) {
        if (result.maintenanceSchedule.minorIntervalMonths) {
          updates.minorIntervalMonths = parseInt(result.maintenanceSchedule.minorIntervalMonths) || null;
        }
        if (result.maintenanceSchedule.majorIntervalMonths) {
          updates.majorIntervalMonths = parseInt(result.maintenanceSchedule.majorIntervalMonths) || null;
        }
        if (result.maintenanceSchedule.minorTasks && Array.isArray(result.maintenanceSchedule.minorTasks)) {
          updates.minorTasks = JSON.stringify(result.maintenanceSchedule.minorTasks);
        }
        if (result.maintenanceSchedule.majorTasks && Array.isArray(result.maintenanceSchedule.majorTasks)) {
          updates.majorTasks = JSON.stringify(result.maintenanceSchedule.majorTasks);
        }
      }
      
      if (result.reasoning) {
        updates.notes = result.reasoning;
      }
      
      if (Object.keys(updates).length > 0) {
        updateTaskMutation.mutate(updates);
        toast({
          title: "AI Schedule Generated",
          description: "Task has been updated with AI suggestions.",
        });
      }
    } catch (error) {
      console.error('Error generating AI schedule:', error);
      toast({
        title: "Error",
        description: "Failed to generate AI schedule",
        variant: "destructive",
      });
    } finally {
      setIsLoadingAI(false);
    }
  };

  const formatDate = (date: Date | string | null) => {
    if (!date) return "Not set";
    return formatDateInTimezone(typeof date === 'string' ? date : date.toISOString(), userTimezone ?? 'UTC');
  };

  // Check if task has AI-generated task lists
  const hasAITaskLists = () => {
    try {
      const minorTasks = task.minorTasks ? JSON.parse(task.minorTasks) : [];
      const majorTasks = task.majorTasks ? JSON.parse(task.majorTasks) : [];
      return (Array.isArray(minorTasks) && minorTasks.length > 0) || 
             (Array.isArray(majorTasks) && majorTasks.length > 0);
    } catch {
      return false;
    }
  };

  // Check if task is missing required interval data
  const isMissingIntervals = () => {
    return !task.minorIntervalMonths || !task.majorIntervalMonths;
  };

  // Check if task has calendar exports
  const getCalendarExports = () => {
    return normalizeCalendarExports(task.calendarExports);
  };

  const calendarExports = getCalendarExports();
  const hasCalendarExport = calendarExports.length > 0;

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

  const nextMaintenance = parseMaintenanceSchedule(task.nextMaintenanceDate);
  const overdueBacklog = parseOverdueBacklog(task.overdueBacklog);
  const todayDateOnly = toDateOnlyFromLocalDate(new Date());

  const isMinorOverdue =
    overdueBacklog.minor ||
    (!!nextMaintenance.minor && compareDateOnly(nextMaintenance.minor, todayDateOnly) < 0);
  const isMajorOverdue =
    overdueBacklog.major ||
    (!!nextMaintenance.major && compareDateOnly(nextMaintenance.major, todayDateOnly) < 0);
  const isTaskOverdue = isMinorOverdue || isMajorOverdue;
  const hasDeferredBacklog = overdueBacklog.minor || overdueBacklog.major;

  return (
    <Card className="p-4 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center space-x-2 mb-2">
            <Badge 
              variant="secondary" 
              className={cn("text-xs", categoryColors[task.category as keyof typeof categoryColors] || "bg-gray-500 text-white")}
            >
              {task.category}
            </Badge>
            <Badge 
              variant="secondary" 
              className={cn("text-xs", priorityColors[task.priority as keyof typeof priorityColors])}
            >
              {task.priority}
            </Badge>
            {task.isAiGenerated && (
              <Badge variant="secondary" className="text-xs bg-accent text-white">
                🤖 AI
              </Badge>
            )}
            {hasCalendarExport && (
              <Badge
                variant="secondary"
                className="text-xs bg-green-100 text-green-700"
                title={`Exported to: ${calendarExports.map((record) => `${record.provider}${record.syncMode === 'direct' ? ' sync' : ''}`).join(', ')}`}
              >
                <CalendarIcon className="w-3 h-3 mr-1" />
                {calendarExports.map((record) => record.provider === 'google' ? 'G' : 'A').join('/')}
              </Badge>
            )}
            {isTaskOverdue && (
              <Badge variant="secondary" className="text-xs bg-red-100 text-red-700">
                Overdue
              </Badge>
            )}
            {hasDeferredBacklog && (
              <Badge variant="secondary" className="text-xs bg-amber-100 text-amber-700">
                Deferred
              </Badge>
            )}
            {isMinorOverdue && (
              <Badge variant="secondary" className="text-xs bg-blue-100 text-blue-700">
                Minor Due
              </Badge>
            )}
            {isMajorOverdue && (
              <Badge variant="secondary" className="text-xs bg-purple-100 text-purple-700">
                Major Due
              </Badge>
            )}
          </div>
          <h4 className="font-medium text-gray-900">
            {task.title}
          </h4>
          <p className="text-sm mt-1 text-gray-600">
            {task.description}
          </p>
          {task.notes && (
            <p className="text-sm text-gray-500 mt-2 italic">{task.notes}</p>
          )}
          
          {/* Completion buttons below description */}
          <div className="flex space-x-4 mt-3">
            {/* Minor Maintenance */}
            {showMinor && (
            <div className="flex flex-col space-y-1">
              <div className="flex items-center space-x-2">
                <Popover open={isMinorCalendarOpen} onOpenChange={setIsMinorCalendarOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isCompleting || updateTaskMutation.isPending}
                      className="h-7 text-xs px-2"
                    >
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      Mark Minor Complete
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={undefined}
                      onSelect={handleMinorDateSelect}
                      disabled={(date) => date > new Date()}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex flex-col ml-2">
                {(() => {
                  const lastMaintenance = parseMaintenanceSchedule(task.lastMaintenanceDate);
                  const nextMaintenance = parseMaintenanceSchedule(task.nextMaintenanceDate);

                  if (lastMaintenance.minor) {
                    return (
                      <div className="space-y-0.5">
                        <span className="text-xs text-gray-700">
                          <strong className="text-blue-600">Last:</strong> {formatDate(lastMaintenance.minor)}
                        </span>
                        {nextMaintenance.minor && (
                          <span className="text-xs text-gray-700">
                            <strong className="text-blue-600">Next:</strong> {formatDate(nextMaintenance.minor)}
                          </span>
                        )}
                      </div>
                    );
                  }
                  if (nextMaintenance.minor) {
                    return (
                      <span className="text-xs text-gray-600">
                        <strong className="text-blue-600">Next:</strong> {formatDate(nextMaintenance.minor)}
                      </span>
                    );
                  }
                  return null;
                })()}
              </div>
              {task.minorTasks && (() => {
                try {
                  const minorTasksList = JSON.parse(task.minorTasks);
                  
                  if (Array.isArray(minorTasksList) && minorTasksList.length > 0) {
                    return (
                      <ul className="ml-2 text-xs text-blue-700 space-y-0.5">
                        {minorTasksList.map((taskItem: string, idx: number) => (
                          <li key={idx} className="leading-tight">• {taskItem}</li>
                        ))}
                      </ul>
                    );
                  }
                } catch (e) {
                  return null;
                }
                return null;
              })()}
            </div>
            )}
            
            {/* Major Maintenance */}
            {showMajor && (
            <div className="flex flex-col space-y-1">
              <div className="flex items-center space-x-2">
                <Popover open={isMajorCalendarOpen} onOpenChange={setIsMajorCalendarOpen}>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isCompleting || updateTaskMutation.isPending}
                      className="h-7 text-xs px-2"
                    >
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      Mark Major Complete
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={undefined}
                      onSelect={handleMajorDateSelect}
                      disabled={(date) => date > new Date()}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>
              <div className="flex flex-col ml-2">
                {(() => {
                  const lastMaintenance = parseMaintenanceSchedule(task.lastMaintenanceDate);
                  const nextMaintenance = parseMaintenanceSchedule(task.nextMaintenanceDate);

                  if (lastMaintenance.major) {
                    return (
                      <div className="space-y-0.5">
                        <span className="text-xs text-gray-700">
                          <strong className="text-purple-600">Last:</strong> {formatDate(lastMaintenance.major)}
                        </span>
                        {nextMaintenance.major && (
                          <span className="text-xs text-gray-700">
                            <strong className="text-purple-600">Next:</strong> {formatDate(nextMaintenance.major)}
                          </span>
                        )}
                      </div>
                    );
                  }
                  if (nextMaintenance.major) {
                    return (
                      <span className="text-xs text-gray-600">
                        <strong className="text-purple-600">Next:</strong> {formatDate(nextMaintenance.major)}
                      </span>
                    );
                  }
                  return null;
                })()}
              </div>
              {task.majorTasks && (() => {
                try {
                  const majorTasksList = JSON.parse(task.majorTasks);
                  
                  if (Array.isArray(majorTasksList) && majorTasksList.length > 0) {
                    return (
                      <ul className="ml-2 text-xs text-purple-700 space-y-0.5">
                        {majorTasksList.map((taskItem: string, idx: number) => (
                          <li key={idx} className="leading-tight">• {taskItem}</li>
                        ))}
                      </ul>
                    );
                  }
                } catch (e) {
                  return null;
                }
                return null;
              })()}
            </div>
            )}
          </div>
        </div>
        <div className="flex items-center space-x-2 ml-4">
          {/* Always show AI button, highlight if missing intervals or no AI data */}
          <Button 
            variant={isMissingIntervals() ? "default" : "ghost"}
            size="sm"
            onClick={handleAISchedule}
            disabled={isLoadingAI}
            title={isMissingIntervals() 
              ? "Missing maintenance intervals - click to generate AI schedule" 
              : hasAITaskLists() 
                ? "Regenerate AI maintenance schedule"
                : "Generate AI maintenance schedule"}
            className={isMissingIntervals() 
              ? "text-white bg-purple-600 hover:bg-purple-700" 
              : "text-purple-600 hover:text-purple-700"}
          >
            {isLoadingAI ? (
              <div className="animate-spin h-4 w-4 border-2 border-purple-600 border-t-transparent rounded-full" />
            ) : (
              <Sparkles className="w-4 h-4" />
            )}
          </Button>
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => setIsEditModalOpen(true)}
          >
            <Edit2 className="w-4 h-4" />
          </Button>
          <Button 
            variant="ghost" 
            size="sm" 
            onClick={handleDelete}
            disabled={deleteTaskMutation.isPending}
            className="text-gray-400 hover:text-red-600"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
      
      <EditTaskModal 
        isOpen={isEditModalOpen}
        onClose={() => setIsEditModalOpen(false)}
        task={task}
      />
    </Card>
  );
}
