import path from 'node:path';

const DEFAULT_PORT = 3000;
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_LOG_LEVEL = 'info';
const DEFAULT_STATE_FILE = path.resolve(import.meta.dirname, '../data/bot-state.json');
const FRONTEND_DIST_PATH = path.resolve(import.meta.dirname, '../../frontend/dist');
const PRODUCTION_NODE_ENV = 'production';
const DEVELOPMENT_PUBLIC_URL = 'http://localhost:5173';
const TRAILING_SLASHES = /\/+$/;

export type BackendConfig = {
  discordToken: string;
  port: number;
  host: string;
  publicUrl: string;
  publicUrlIsDefault: boolean;
  stateFilePath: string;
  logLevel: string;
  isProduction: boolean;
  frontendDistPath: string;
};

export class ConfigError extends Error {}

export function loadConfigFromEnv(env: NodeJS.ProcessEnv): BackendConfig {
  const discordToken = readOptional(env, 'DISCORD_TOKEN');
  if (discordToken === null) {
    throw new ConfigError(
      'DISCORD_TOKEN is not set. Copy .env.example to .env and paste the bot token from the Discord Developer Portal.',
    );
  }
  const port = readPort(env);
  const isProduction = readOptional(env, 'NODE_ENV') === PRODUCTION_NODE_ENV;
  const configuredPublicUrl = readOptional(env, 'PUBLIC_URL');
  const defaultPublicUrl = isProduction ? `http://localhost:${port}` : DEVELOPMENT_PUBLIC_URL;

  return {
    discordToken,
    port,
    host: readOptional(env, 'HOST') ?? DEFAULT_HOST,
    publicUrl: (configuredPublicUrl ?? defaultPublicUrl).replace(TRAILING_SLASHES, ''),
    publicUrlIsDefault: configuredPublicUrl === null,
    stateFilePath: path.resolve(readOptional(env, 'STATE_FILE') ?? DEFAULT_STATE_FILE),
    logLevel: readOptional(env, 'LOG_LEVEL') ?? DEFAULT_LOG_LEVEL,
    isProduction,
    frontendDistPath: FRONTEND_DIST_PATH,
  };
}

function readOptional(env: NodeJS.ProcessEnv, name: string): string | null {
  const value = env[name]?.trim();
  return value ? value : null;
}

function readPort(env: NodeJS.ProcessEnv): number {
  const rawPort = readOptional(env, 'PORT');
  if (rawPort === null) {
    return DEFAULT_PORT;
  }
  const port = Number.parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port <= 0) {
    throw new ConfigError(`PORT must be a positive integer, got "${rawPort}".`);
  }
  return port;
}
