import type { HealthReport } from '@pantograph/shared';
import { type Client, Events, OAuth2Scopes, PermissionFlagsBits } from 'discord.js';
import { buildChannelLink } from '../channels/channelLink.ts';
import type { WatchedChannel, WatchedChannels } from '../channels/watchedChannels.ts';
import type { BackendConfig } from '../config.ts';
import type { Logger } from '../logging.ts';
import type { BotStateStore } from '../state/botState.ts';
import { MILLISECONDS_PER_MINUTE, MILLISECONDS_PER_SECOND, SECONDS_PER_MINUTE } from '../time.ts';
import {
  buildPantographCommand,
  handlePantographCommand,
  handleStatusPageButton,
  isStatusPageButton,
  PANTOGRAPH_COMMAND_NAME,
} from './commands/pantographCommand.ts';
import { ensureCommandsRegistered } from './commands/registerCommands.ts';
import { DiscordMessageSource } from './discordMessageSource.ts';
import { explainFatalCloseCode } from './gatewayCloseCodes.ts';
import type { IncidentTracker } from './incidentTracker.ts';
import { buildNotice, NoticeTone, type StatusReport } from './statusViews.ts';
import { SyncController } from './syncController.ts';

const INVITE_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.SendMessages,
];
const GATEWAY_OUTAGE_NOTICE_THRESHOLD_MS = MILLISECONDS_PER_MINUTE;
const UNKNOWN_PING = -1;

export type PantographBotDependencies = {
  client: Client;
  config: BackendConfig;
  channels: WatchedChannels;
  state: BotStateStore;
  incidents: IncidentTracker;
  logger: Logger;
  startedAt: Date;
  onFatalDisconnect: () => void;
};

export type PantographBot = {
  getStatusReport: (guildId: string, channelId: string | null) => StatusReport;
  getHealthReport: () => HealthReport;
};

export function attachPantographBot(dependencies: PantographBotDependencies): PantographBot {
  const { client, config, channels, state, incidents, logger, startedAt } = dependencies;
  const source = new DiscordMessageSource({ client, channels, incidents, logger });
  source.attach();

  const commandJson = buildPantographCommand().toJSON();
  const registrationDependencies = { commandJson, state, incidents, logger };
  let controller: SyncController | null = null;
  let disconnectedSince: Date | null = null;

  const gatewayPingMs = (): number | null =>
    client.ws.ping === UNKNOWN_PING ? null : client.ws.ping;

  const getStatusReport = (guildId: string, channelId: string | null): StatusReport => ({
    notifyChannelId: state.guild(guildId).notifyChannelId,
    gatewayPingMs: gatewayPingMs(),
    startedAt,
    channels: channels
      .inGuild(guildId)
      .filter((watched) => channelId === null || watched.record.channelId === channelId)
      .toSorted(compareByChannelName)
      .map((watched) => ({
        id: watched.record.channelId,
        name: watched.channelName,
        paused: watched.record.paused,
        link: buildChannelLink(config.publicUrl, watched.record.key),
        viewers: watched.hub.subscriberCount,
        buffered: watched.hub.bufferedMessageCount,
        lastEventAt: watched.hub.lastEventAt,
      })),
    openIncidents: incidents.openIncidentsIn(guildId),
  });

  const getHealthReport = (): HealthReport => ({
    status: client.isReady() ? 'ok' : 'degraded',
    discord: { connected: client.isReady(), gatewayPingMs: gatewayPingMs() },
    watchedChannels: channels.all().length,
    connectedViewers: channels.totalViewers,
    uptimeSeconds: Math.floor((Date.now() - startedAt.getTime()) / MILLISECONDS_PER_SECOND),
  });

  const announceGatewayRecovery = (how: string): void => {
    if (disconnectedSince === null) {
      return;
    }
    const downtimeMs = Date.now() - disconnectedSince.getTime();
    disconnectedSince = null;
    logger.info({ downtimeMs, how }, 'Gateway connection restored');
    if (downtimeMs < GATEWAY_OUTAGE_NOTICE_THRESHOLD_MS) {
      return;
    }
    const notice = buildNotice(NoticeTone.Info, 'Gateway connection restored', [
      `The connection to Discord was down for ${formatDuration(downtimeMs)} and ${how}.`,
    ]);
    for (const guild of client.guilds.cache.values()) {
      void incidents.postNotice(guild.id, notice);
    }
  };

  client.once(Events.ClientReady, async (readyClient) => {
    logger.info({ user: readyClient.user.tag }, 'Connected to Discord');
    logger.info(
      {
        url: readyClient.generateInvite({
          scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands],
          permissions: INVITE_PERMISSIONS,
        }),
      },
      'Install link (add the bot to a server)',
    );
    controller = new SyncController({
      client: readyClient,
      channels,
      source,
      incidents,
      state,
      publicUrl: config.publicUrl,
    });
    for (const guild of readyClient.guilds.cache.values()) {
      await ensureCommandsRegistered(guild, registrationDependencies, { force: false });
    }
    await controller.initialize();
  });

  client.on(Events.GuildCreate, (guild) => {
    logger.info({ guild: guild.name }, 'Added to server');
    void ensureCommandsRegistered(guild, registrationDependencies, { force: true });
  });

  client.on(Events.GuildDelete, (guild) => {
    logger.info({ guild: guild.name }, 'Removed from server, dropping its mirrored channels');
    void controller?.removeGuild(guild.id);
  });

  client.on(Events.ChannelDelete, (channel) => {
    const watched = channels.byChannelId(channel.id);
    if (watched === null) {
      return;
    }
    logger.info({ channelId: channel.id }, 'Mirrored channel was deleted, stopping its mirror');
    void controller?.unwatch(watched.record.guildId, channel.id);
  });

  client.on(Events.InteractionCreate, (interaction) => {
    if (controller === null) {
      return;
    }
    const context = { controller, getStatusReport, logger };
    if (interaction.isButton() && isStatusPageButton(interaction.customId)) {
      void handleStatusPageButton(interaction, context);
      return;
    }
    if (interaction.isChatInputCommand() && interaction.commandName === PANTOGRAPH_COMMAND_NAME) {
      void handlePantographCommand(interaction, context);
    }
  });

  client.on(Events.ShardDisconnect, (closeEvent, shardId) => {
    const explanation = explainFatalCloseCode(closeEvent.code);
    if (explanation !== null) {
      logger.fatal({ shardId, code: closeEvent.code }, explanation);
      dependencies.onFatalDisconnect();
      return;
    }
    disconnectedSince ??= new Date();
    logger.error(
      { shardId, code: closeEvent.code },
      'Gateway closed the connection and discord.js will not reconnect on its own',
    );
    dependencies.onFatalDisconnect();
  });
  client.on(Events.ShardReconnecting, (shardId) => {
    disconnectedSince ??= new Date();
    logger.info({ shardId }, 'Gateway reconnecting');
  });
  client.on(Events.ShardResume, (shardId, replayedEvents) => {
    logger.info({ shardId, replayedEvents }, 'Gateway session resumed');
    announceGatewayRecovery(`resumed with ${replayedEvents} replayed events`);
  });
  client.on(Events.ShardReady, (shardId) => {
    if (controller === null) {
      return;
    }
    logger.info({ shardId }, 'Gateway re-identified, re-syncing history');
    void controller.initialize();
    announceGatewayRecovery('started a fresh session (history re-synced)');
  });
  client.on(Events.ShardError, (error, shardId) => {
    logger.error({ shardId, error: error.message }, 'Gateway error');
  });
  client.on(Events.Error, (error) =>
    logger.error({ error: error.message }, 'Discord client error'),
  );
  client.on(Events.Warn, (message) => logger.warn(message));

  return { getStatusReport, getHealthReport };
}

function compareByChannelName(left: WatchedChannel, right: WatchedChannel): number {
  const byName = (left.channelName ?? left.record.channelId).localeCompare(
    right.channelName ?? right.record.channelId,
  );
  return byName === 0 ? left.record.channelId.localeCompare(right.record.channelId) : byName;
}

function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.round(milliseconds / MILLISECONDS_PER_SECOND);
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}
