// Utility for log level filtering
export type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";
export const LOG_LEVEL: LogLevel = (process.env.LOG_LEVEL as LogLevel) || "INFO";
const LOG_LEVELS: Record<LogLevel, number> = { DEBUG: 0, INFO: 1, WARN: 2, ERROR: 3 };
export function logWithLevel(level: LogLevel, ...args: any[]) {
  if (LOG_LEVELS[level] >= LOG_LEVELS[LOG_LEVEL]) {
    console.log(`[${level}]`, ...args);
  }
}
