import { access } from 'node:fs/promises';
import { DiscordjsErrorCodes, GatewayCloseCodes } from 'discord.js';
import { WatchedChannels } from './channels/watchedChannels.ts';
import { type BackendConfig, ConfigError, loadConfigFromEnv } from './config.ts';
import { createDiscordClient } from './discord/discordClient.ts';
import { explainFatalCloseCode } from './discord/gatewayCloseCodes.ts';
import { IncidentTracker } from './discord/incidentTracker.ts';
import { attachPantographBot } from './discord/pantographBot.ts';
import { describeError, hasErrorCode } from './errors.ts';
import { createHttpApp, startHttpServer } from './http/server.ts';
import { createLogger } from './logging.ts';
import { BotStateStore } from './state/botState.ts';

const EXIT_CODE_CONFIG_ERROR = 2;
const EXIT_CODE_STARTUP_FAILED = 1;
const EXIT_CODE_FATAL_DISCONNECT = 3;
const SHUTDOWN_SIGNALS = ['SIGINT', 'SIGTERM'] as const;

async function main(): Promise<void> {
  const startedAt = new Date();
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel, pretty: !config.isProduction });
  if (config.isProduction && config.publicUrlIsDefault) {
    logger.warn(
      { publicUrl: config.publicUrl },
      'PUBLIC_URL is not set; channel links will point at the default origin',
    );
  }

  const state = await loadState(config, logger);
  const channels = new WatchedChannels({ state, epoch: String(startedAt.getTime()) });
  const client = createDiscordClient();
  const incidents = new IncidentTracker({
    client,
    getNotifyChannelId: (guildId) => state.guild(guildId).notifyChannelId,
    logger,
  });

  const shutdown = async (exitCode: number): Promise<never> => {
    logger.info('Shutting down');
    server?.close();
    await client.destroy();
    process.exit(exitCode);
  };

  const bot = attachPantographBot({
    client,
    config,
    channels,
    state,
    incidents,
    logger,
    startedAt,
    onFatalDisconnect: () => void shutdown(EXIT_CODE_FATAL_DISCONNECT),
  });

  const app = createHttpApp({
    resolveChannel: (key) => {
      const watched = channels.byKey(key);
      return watched === null ? null : { hub: watched.hub };
    },
    totalViewers: () => channels.totalViewers,
    logger,
    frontendDistPath: await resolveFrontendDistPath(config, logger),
    getHealthReport: bot.getHealthReport,
  });
  let server: Awaited<ReturnType<typeof startHttpServer>> | null = null;
  try {
    server = await startHttpServer(app, { host: config.host, port: config.port });
  } catch (error) {
    logger.fatal(describeStartupError(error, config));
    process.exit(EXIT_CODE_STARTUP_FAILED);
  }
  logger.info(`Web server listening on http://${config.host}:${config.port}`);

  for (const signal of SHUTDOWN_SIGNALS) {
    process.once(signal, () => void shutdown(0));
  }

  try {
    await client.login(config.discordToken);
  } catch (error) {
    logger.fatal(describeLoginError(error));
    await shutdown(EXIT_CODE_STARTUP_FAILED);
  }
}

function loadConfig(): BackendConfig {
  try {
    return loadConfigFromEnv(process.env);
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`Configuration error: ${error.message}\n`);
      process.exit(EXIT_CODE_CONFIG_ERROR);
    }
    throw error;
  }
}

async function loadState(
  config: BackendConfig,
  logger: ReturnType<typeof createLogger>,
): Promise<BotStateStore> {
  try {
    return await BotStateStore.load({ filePath: config.stateFilePath });
  } catch (error) {
    logger.fatal(describeError(error));
    return process.exit(EXIT_CODE_STARTUP_FAILED);
  }
}

async function resolveFrontendDistPath(
  config: BackendConfig,
  logger: ReturnType<typeof createLogger>,
): Promise<string | null> {
  if (!config.isProduction) {
    return null;
  }
  try {
    await access(config.frontendDistPath);
    return config.frontendDistPath;
  } catch {
    logger.warn(
      { path: config.frontendDistPath },
      'Frontend build not found; run "npm run build" to serve the web page from this server',
    );
    return null;
  }
}

function describeStartupError(error: unknown, config: BackendConfig): string {
  if (hasErrorCode(error, 'EADDRINUSE')) {
    return `Port ${config.port} is already in use. Stop the other process or set PORT in .env.`;
  }
  return `Could not start the web server: ${describeError(error)}`;
}

function describeLoginError(error: unknown): string {
  if (hasErrorCode(error, DiscordjsErrorCodes.TokenInvalid)) {
    return explainFatalCloseCode(GatewayCloseCodes.AuthenticationFailed) ?? describeError(error);
  }
  if (hasErrorCode(error, DiscordjsErrorCodes.DisallowedIntents)) {
    return explainFatalCloseCode(GatewayCloseCodes.DisallowedIntents) ?? describeError(error);
  }
  return `Could not connect to Discord: ${describeError(error)}`;
}

await main();
