/**
 * Logger simple para la extensión.
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

class Logger {
  private prefix: string;
  private level: LogLevel;

  constructor(prefix: string, level: LogLevel = LogLevel.INFO) {
    this.prefix = prefix;
    this.level = level;
  }

  debug(...args: unknown[]): void {
    if (this.level <= LogLevel.DEBUG) {
      console.debug(`[MVC:${this.prefix}]`, ...args);
    }
  }

  info(...args: unknown[]): void {
    if (this.level <= LogLevel.INFO) {
      console.log(`[MVC:${this.prefix}]`, ...args);
    }
  }

  warn(...args: unknown[]): void {
    if (this.level <= LogLevel.WARN) {
      console.warn(`[MVC:${this.prefix}]`, ...args);
    }
  }

  error(...args: unknown[]): void {
    if (this.level <= LogLevel.ERROR) {
      console.error(`[MVC:${this.prefix}]`, ...args);
    }
  }
}

export function createLogger(name: string): Logger {
  return new Logger(name);
}
