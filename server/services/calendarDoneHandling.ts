import { addMonthsToDateOnly, normalizeDateOnly, type MaintenanceTask } from "@shared/schema";

export type CalendarDoneKind = "minor" | "major";

export function deriveDoneCompletionDates(
  task: MaintenanceTask,
  kind: CalendarDoneKind,
  completionDateRaw: string | null | undefined,
): { completedDateOnly: string; nextDateOnly: string } | null {
  const normalizedCompletedDateOnly = normalizeDateOnly(completionDateRaw);
  if (!normalizedCompletedDateOnly) {
    return null;
  }

  // [DONE] should never complete in the future.
  const todayDateOnly = getTodayDateOnly();
  const completedDateOnly = normalizedCompletedDateOnly > todayDateOnly ? todayDateOnly : normalizedCompletedDateOnly;

  const intervalMonths = kind === "minor" ? task.minorIntervalMonths : task.majorIntervalMonths;
  const nextDateOnly =
    normalizeDateOnly(
      typeof intervalMonths === "number" && intervalMonths > 0
        ? addMonthsToDateOnly(completedDateOnly, intervalMonths)
        : completedDateOnly,
    ) ?? completedDateOnly;

  return {
    completedDateOnly,
    nextDateOnly,
  };
}

function getTodayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}
