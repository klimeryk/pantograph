import {
  type Client,
  Events,
  type GuildTextBasedChannel,
  type Message,
  type PartialMessage,
  type ReadonlyCollection,
  type Snowflake,
} from 'discord.js';
import type { WatchedChannels } from '../channels/watchedChannels.ts';
import { describeError } from '../errors.ts';
import type { Logger } from '../logging.ts';
import { type MessageStreamHub, RECENT_MESSAGE_LIMIT } from '../stream/messageStreamHub.ts';
import { IncidentKind, type IncidentTracker } from './incidentTracker.ts';
import { isSyncedMessage, toMessageView } from './messageView.ts';
import {
  type ChannelResolution,
  resolveWatchableChannel,
  type WatchableChannel,
} from './watchedChannel.ts';

export type ResyncResult = ChannelResolution;

export type DiscordMessageSourceDependencies = {
  client: Client;
  channels: WatchedChannels;
  incidents: IncidentTracker;
  logger: Logger;
};

export class DiscordMessageSource {
  readonly #client: Client;
  readonly #channels: WatchedChannels;
  readonly #incidents: IncidentTracker;
  readonly #logger: Logger;

  constructor(dependencies: DiscordMessageSourceDependencies) {
    this.#client = dependencies.client;
    this.#channels = dependencies.channels;
    this.#incidents = dependencies.incidents;
    this.#logger = dependencies.logger;
  }

  attach(): void {
    this.#client.on(Events.MessageCreate, (message) => this.#onMessageCreated(message));
    this.#client.on(Events.MessageUpdate, (_previous, message) => this.#onMessageUpdated(message));
    this.#client.on(Events.MessageDelete, (message) => this.#onMessageDeleted(message));
    this.#client.on(Events.MessageBulkDelete, (messages, channel) =>
      this.#onMessagesBulkDeleted(messages, channel),
    );
  }

  publishSyncState(channelId: string): void {
    const watched = this.#channels.byChannelId(channelId);
    watched?.hub.setSyncState(this.#channels.syncStateView(channelId));
  }

  async syncAll(): Promise<void> {
    for (const watched of this.#channels.all()) {
      const result = await this.syncChannel(watched.record.channelId);
      if (!result.ok) {
        this.#logger.warn(result.reason);
      }
    }
  }

  async syncChannel(channelId: string): Promise<ResyncResult> {
    const watched = this.#channels.byChannelId(channelId);
    if (watched === null) {
      return { ok: false, reason: 'That channel is not being mirrored.' };
    }
    if (!this.#client.isReady()) {
      return { ok: false, reason: 'The bot is not connected to Discord yet.' };
    }
    const scope = { guildId: watched.record.guildId, channelId };

    const resolution = await resolveWatchableChannel(this.#client, channelId);
    if (!this.#isStillWatched(channelId)) {
      return { ok: false, reason: 'That channel is no longer being mirrored.' };
    }
    if (!resolution.ok) {
      this.#incidents.report(IncidentKind.ChannelInaccessible, scope, resolution.reason);
      this.#channels.setChannelName(channelId, null);
      watched.hub.replaceMessages([], this.#channels.syncStateView(channelId));
      return resolution;
    }
    this.#incidents.resolve(IncidentKind.ChannelInaccessible, scope);
    return this.#loadHistory(watched.hub, resolution.channel, scope);
  }

  async #loadHistory(
    hub: MessageStreamHub,
    channel: WatchableChannel,
    scope: { guildId: string; channelId: string },
  ): Promise<ResyncResult> {
    let history: ReadonlyCollection<Snowflake, Message<true>>;
    try {
      history = await channel.messages.fetch({ limit: RECENT_MESSAGE_LIMIT });
    } catch (error) {
      const reason = `Could not load recent messages from #${channel.name}: ${describeError(error)}`;
      this.#incidents.report(IncidentKind.HistoryFetchFailed, scope, reason);
      return { ok: false, reason };
    }
    if (!this.#isStillWatched(channel.id)) {
      return { ok: false, reason: 'That channel is no longer being mirrored.' };
    }
    this.#incidents.resolve(IncidentKind.HistoryFetchFailed, scope);
    this.#channels.setChannelName(channel.id, channel.name);
    const botUserId = channel.client.user.id;
    const messages = history
      .filter((message) => isSyncedMessage(message, botUserId))
      .map(toMessageView);
    hub.replaceMessages(messages, this.#channels.syncStateView(channel.id));
    this.#logger.info({ channel: channel.name, messages: messages.length }, 'Synced history');
    return { ok: true, channel };
  }

  #onMessageCreated(message: Message | PartialMessage): void {
    const hub = this.#liveHubFor(message.channelId);
    if (hub !== null && this.#isFullSyncedMessage(message)) {
      hub.applyMessageCreated(toMessageView(message));
    }
  }

  #onMessageUpdated(message: Message | PartialMessage): void {
    const hub = this.#liveHubFor(message.channelId);
    if (hub !== null && this.#isFullSyncedMessage(message)) {
      hub.applyMessageUpdated(toMessageView(message));
    }
  }

  #onMessageDeleted(message: Message | PartialMessage): void {
    this.#liveHubFor(message.channelId)?.applyMessagesDeleted([message.id]);
  }

  #onMessagesBulkDeleted(
    messages: ReadonlyCollection<Snowflake, Message | PartialMessage>,
    channel: GuildTextBasedChannel,
  ): void {
    this.#liveHubFor(channel.id)?.applyMessagesDeleted([...messages.keys()]);
  }

  #liveHubFor(channelId: string): MessageStreamHub | null {
    const watched = this.#channels.byChannelId(channelId);
    if (watched === null || watched.record.paused) {
      return null;
    }
    return watched.hub;
  }

  #isStillWatched(channelId: string): boolean {
    return this.#channels.byChannelId(channelId) !== null;
  }

  #isFullSyncedMessage(message: Message | PartialMessage): message is Message {
    if (message.partial) {
      return false;
    }
    const botUserId = this.#client.user?.id;
    return botUserId !== undefined && isSyncedMessage(message, botUserId);
  }
}
