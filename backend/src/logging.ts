import { type Logger, pino } from 'pino';

export type { Logger };

export function createLogger(options: { level: string; pretty: boolean }): Logger {
  if (options.pretty) {
    return pino({
      level: options.level,
      transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
    });
  }
  return pino({ level: options.level });
}
