import { getRuntimeContext } from "./context";

export function logMessage(
  message: string,
  level: "info" | "warn" | "error" | "debug" = "info"
): void {
  const timestamp = new Date().toISOString();
  const formatted = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  const logger = getRuntimeContext().logger;
  if (level === "warn") {
    logger.warn(formatted);
    return;
  }
  if (level === "error") {
    logger.error(formatted);
    return;
  }
  if (level === "debug") {
    logger.debug(formatted);
    return;
  }
  logger.info(formatted);
}
