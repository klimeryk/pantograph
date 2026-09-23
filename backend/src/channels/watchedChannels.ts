import type { SyncStateView } from '@pantograph/shared';
import type { BotStateStore, WatchedChannelRecord } from '../state/botState.ts';
import { MessageStreamHub } from '../stream/messageStreamHub.ts';
import { generateChannelKey } from './channelKey.ts';

export type WatchedChannel = {
  record: WatchedChannelRecord;
  hub: MessageStreamHub;
  channelName: string | null;
};

type RuntimeEntry = {
  hub: MessageStreamHub;
  channelName: string | null;
};

export class WatchedChannels {
  readonly #state: BotStateStore;
  readonly #epoch: string;
  readonly #entries = new Map<string, RuntimeEntry>();

  constructor(options: { state: BotStateStore; epoch: string }) {
    this.#state = options.state;
    this.#epoch = options.epoch;
    for (const record of this.#state.allChannels()) {
      this.#entries.set(record.channelId, this.#createEntry(record));
    }
  }

  all(): WatchedChannel[] {
    return this.#state.allChannels().map((record) => this.#view(record));
  }

  inGuild(guildId: string): WatchedChannel[] {
    return this.#state.channelsInGuild(guildId).map((record) => this.#view(record));
  }

  byChannelId(channelId: string): WatchedChannel | null {
    const record = this.#state.channel(channelId);
    return record === null ? null : this.#view(record);
  }

  byKey(key: string): WatchedChannel | null {
    const record = this.#state.channelByKey(key);
    return record === null ? null : this.#view(record);
  }

  get totalViewers(): number {
    let total = 0;
    for (const entry of this.#entries.values()) {
      total += entry.hub.subscriberCount;
    }
    return total;
  }

  async add(options: { channelId: string; guildId: string }): Promise<WatchedChannel> {
    const record: WatchedChannelRecord = {
      channelId: options.channelId,
      guildId: options.guildId,
      key: generateChannelKey(),
      paused: false,
      watchedAt: new Date().toISOString(),
    };
    this.#entries.set(record.channelId, this.#createEntry(record));
    try {
      await this.#state.addChannel(record);
    } catch (error) {
      this.#entries.delete(record.channelId);
      throw error;
    }
    return this.#view(record);
  }

  async remove(channelId: string): Promise<void> {
    this.#dropEntry(channelId);
    await this.#state.removeChannel(channelId);
  }

  async removeGuild(guildId: string): Promise<void> {
    for (const record of this.#state.channelsInGuild(guildId)) {
      this.#dropEntry(record.channelId);
    }
    await this.#state.removeGuild(guildId);
  }

  async rotateKey(channelId: string): Promise<WatchedChannel> {
    this.#requireEntry(channelId).hub.disconnectAll();
    await this.#state.setChannelKey(channelId, generateChannelKey());
    return this.#requireView(channelId);
  }

  async setPaused(channelId: string, paused: boolean): Promise<void> {
    await this.#state.setChannelPaused(channelId, paused);
  }

  setChannelName(channelId: string, channelName: string | null): void {
    this.#requireEntry(channelId).channelName = channelName;
  }

  syncStateView(channelId: string): SyncStateView {
    const { record, channelName } = this.#requireView(channelId);
    return {
      paused: record.paused,
      watchedChannel: channelName === null ? null : { id: channelId, name: channelName },
    };
  }

  #createEntry(record: WatchedChannelRecord): RuntimeEntry {
    return {
      hub: new MessageStreamHub({
        epoch: this.#epoch,
        initialSyncState: { paused: record.paused, watchedChannel: null },
      }),
      channelName: null,
    };
  }

  #dropEntry(channelId: string): void {
    this.#entries.get(channelId)?.hub.disconnectAll();
    this.#entries.delete(channelId);
  }

  #requireEntry(channelId: string): RuntimeEntry {
    const entry = this.#entries.get(channelId);
    if (entry === undefined) {
      throw new Error(`Channel ${channelId} is not watched`);
    }
    return entry;
  }

  #requireView(channelId: string): WatchedChannel {
    const record = this.#state.channel(channelId);
    if (record === null) {
      throw new Error(`Channel ${channelId} is not watched`);
    }
    return this.#view(record);
  }

  #view(record: WatchedChannelRecord): WatchedChannel {
    const entry = this.#requireEntry(record.channelId);
    return { record, hub: entry.hub, channelName: entry.channelName };
  }
}
