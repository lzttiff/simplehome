import { useEffect, useState } from "react";
import { format } from "date-fns";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type BulkFillKind = "minor" | "major";
export type BulkFillMode = "fill-empty-only" | "overwrite";
export type BulkFillTaskKindSelection = "minor" | "major" | "both";

export type BulkFillTaskSelectionPayload = {
  taskId: string;
  kinds: BulkFillKind[];
};

interface BulkFillDatesModalProps {
  isOpen: boolean;
  onClose: () => void;
  selectedCount: number;
  selectedTasks: Array<{ id: string; title: string }>;
  isSubmitting?: boolean;
  onSubmit: (payload: {
    date: string;
    mode: BulkFillMode;
    taskSelections: BulkFillTaskSelectionPayload[];
  }) => Promise<void>;
}

export default function BulkFillDatesModal({
  isOpen,
  onClose,
  selectedCount,
  selectedTasks,
  isSubmitting = false,
  onSubmit,
}: BulkFillDatesModalProps) {
  const [date, setDate] = useState<Date | null>(null);
  const [calendarMonth, setCalendarMonth] = useState<Date>(new Date());
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [mode, setMode] = useState<BulkFillMode>("fill-empty-only");
  const [taskSelections, setTaskSelections] = useState<Record<string, BulkFillTaskKindSelection>>({});
  const currentYear = new Date().getFullYear();
  const minYear = currentYear - 10;
  const maxYear = currentYear + 30;
  const yearOptions = Array.from({ length: maxYear - minYear + 1 }, (_, i) => minYear + i);
  const monthOptions = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];

  const toDateOnlyString = (value: Date): string => {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  useEffect(() => {
    if (!isOpen) {
      setDate(null);
      setMode("fill-empty-only");
      setCalendarMonth(new Date());
      setCalendarOpen(false);
      setTaskSelections({});
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setTaskSelections((prev) => {
      const next: Record<string, BulkFillTaskKindSelection> = {};
      for (const task of selectedTasks) {
        next[task.id] = prev[task.id] ?? "both";
      }
      return next;
    });
  }, [isOpen, selectedTasks]);

  const kindsForSelection = (selection: BulkFillTaskKindSelection): BulkFillKind[] => {
    if (selection === "minor") return ["minor"];
    if (selection === "major") return ["major"];
    return ["minor", "major"];
  };

  const normalizedSelections = selectedTasks
    .map((task) => {
      const selection = taskSelections[task.id] ?? "both";
      return {
        taskId: task.id,
        kinds: kindsForSelection(selection),
      };
    })
    .filter((entry) => entry.kinds.length > 0);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date) {
      return;
    }
    if (normalizedSelections.length === 0) {
      return;
    }
    await onSubmit({
      date: toDateOnlyString(date),
      mode,
      taskSelections: normalizedSelections,
    });
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Bulk Fill Next Maintenance Date</DialogTitle>
          <DialogDescription>
            Update {selectedCount} selected item(s) in one action.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          <div className="space-y-2">
            <Label>Per-task schedule kind</Label>
            <div className="max-h-48 overflow-y-auto rounded-md border border-gray-200 divide-y">
              {selectedTasks.map((task) => (
                <div key={task.id} className="grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-2">
                  <span className="text-sm text-gray-700 truncate" title={task.title}>{task.title}</span>
                  <select
                    aria-label={`Kind for ${task.title}`}
                    className="rounded-md border border-gray-300 px-2 py-1 text-sm"
                    value={taskSelections[task.id] ?? "both"}
                    onChange={(e) => {
                      const value = e.target.value as BulkFillTaskKindSelection;
                      setTaskSelections((prev) => ({ ...prev, [task.id]: value }));
                    }}
                    disabled={isSubmitting}
                  >
                    <option value="minor">Minor only</option>
                    <option value="major">Major only</option>
                    <option value="both">Both</option>
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bulk-date">Date</Label>
            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <Button
                  id="bulk-date"
                  type="button"
                  variant="outline"
                  disabled={isSubmitting}
                  className={cn("w-full justify-start text-left font-normal", !date && "text-muted-foreground")}
                >
                  {date ? format(date, "PPP") : <span>Pick a date</span>}
                  <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <div className="flex items-center gap-2 p-3 border-b bg-gray-50">
                  <Select
                    value={String(calendarMonth.getMonth())}
                    onValueChange={(value) => {
                      const next = new Date(calendarMonth);
                      next.setMonth(parseInt(value, 10));
                      setCalendarMonth(next);
                    }}
                  >
                    <SelectTrigger className="h-8 w-[150px]">
                      <SelectValue placeholder="Month" />
                    </SelectTrigger>
                    <SelectContent>
                      {monthOptions.map((monthLabel, index) => (
                        <SelectItem key={monthLabel} value={String(index)}>
                          {monthLabel}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select
                    value={String(calendarMonth.getFullYear())}
                    onValueChange={(value) => {
                      const next = new Date(calendarMonth);
                      next.setFullYear(parseInt(value, 10));
                      setCalendarMonth(next);
                    }}
                  >
                    <SelectTrigger className="h-8 w-[110px]">
                      <SelectValue placeholder="Year" />
                    </SelectTrigger>
                    <SelectContent className="max-h-64">
                      {yearOptions.map((year) => (
                        <SelectItem key={year} value={String(year)}>
                          {year}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Calendar
                  mode="single"
                  selected={date ?? undefined}
                  month={calendarMonth}
                  onMonthChange={setCalendarMonth}
                  onSelect={(selectedDate) => {
                    if (!selectedDate) {
                      return;
                    }
                    setDate(selectedDate);
                    setCalendarMonth(selectedDate);
                    setCalendarOpen(false);
                  }}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="space-y-2">
            <Label htmlFor="bulk-mode">Apply mode</Label>
            <select
              id="bulk-mode"
              value={mode}
              onChange={(e) => setMode(e.target.value as BulkFillMode)}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
              disabled={isSubmitting}
            >
              <option value="fill-empty-only">Fill empty only</option>
              <option value="overwrite">Overwrite existing</option>
            </select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting || selectedCount === 0 || !date || normalizedSelections.length === 0}>
              {isSubmitting ? "Applying..." : "Apply"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
