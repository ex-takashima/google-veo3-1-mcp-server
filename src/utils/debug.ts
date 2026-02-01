/**
 * Debug logging utilities
 */

const DEBUG = process.env.DEBUG === 'true';

/**
 * Log a debug message (only if DEBUG=true)
 */
export function debugLog(message: string, data?: unknown): void {
  if (!DEBUG) return;

  const timestamp = new Date().toISOString();
  if (data !== undefined) {
    console.error(`[DEBUG ${timestamp}] ${message}`, JSON.stringify(data, null, 2));
  } else {
    console.error(`[DEBUG ${timestamp}] ${message}`);
  }
}

/**
 * Log an error message (always logs)
 */
export function errorLog(message: string, error?: unknown): void {
  const timestamp = new Date().toISOString();
  if (error instanceof Error) {
    console.error(`[ERROR ${timestamp}] ${message}: ${error.message}`);
    if (DEBUG && error.stack) {
      console.error(error.stack);
    }
  } else if (error !== undefined) {
    console.error(`[ERROR ${timestamp}] ${message}:`, error);
  } else {
    console.error(`[ERROR ${timestamp}] ${message}`);
  }
}

/**
 * Log an info message (always logs)
 */
export function infoLog(message: string): void {
  const timestamp = new Date().toISOString();
  console.error(`[INFO ${timestamp}] ${message}`);
}
