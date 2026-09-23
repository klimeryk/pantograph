import type { Client } from 'discord.js';
import { buildChannelLink } from '../channels/channelLink.ts';
import type { WatchedChannel, WatchedChannels } from '../channels/watchedChannels.ts';
import type { BotStateStore, WatchedChannelRecord } from '../state/botState.ts';
import type { DiscordMessageSource } from './discordMessageSource.ts';
import type { IncidentTracker } from './incidentTracker.ts';
import { resolveWatchableChannel } from './watchedChannel.ts';

export type SyncControllerDependencies = {
  client: Client<true>;
  channels: WatchedChannels;
  source: DiscordMessageSource;
  incidents: IncidentTracker;
  state: BotStateStore;
  publicUrl: string;
};

export type WatchResult =
  | { ok: true; link: string; alreadyWatched: boolean; syncProblem: string | null }
  | { ok: false; reason: string };

export type LinkResult = { ok: true; link: string } | { ok: false; reason: string };

export type ChannelSyncProblem = { channelId: string; reason: string };

export type BulkResult =
  | { ok: true; channelIds: string[]; problems: ChannelSyncProblem[] }
  | { ok: false; reason: string };

const NOT_WATCHED_REASON = 'That channel is not being mirrored.';
const NOTHING_WATCHED_REASON = 'No channel in this server is being mirrored yet.';

export class SyncController {
  readonly #client: Client<true>;
  readonly #channels: WatchedChannels;
  readonly #source: DiscordMessageSource;
  readonly #incidents: IncidentTracker;
  readonly #state: BotStateStore;
  readonly #publicUrl: string;

  constructor(dependencies: SyncControllerDependencies) {
    this.#client = dependencies.client;
    this.#channels = dependencies.channels;
    this.#source = dependencies.source;
    this.#incidents = dependencies.incidents;
    this.#state = dependencies.state;
    this.#publicUrl = dependencies.publicUrl;
  }

  linkFor(record: WatchedChannelRecord): string {
    return buildChannelLink(this.#publicUrl, record.key);
  }

  async initialize(): Promise<void> {
    await this.#source.syncAll();
  }

  async watch(guildId: string, channelId: string): Promise<WatchResult> {
    const existing = this.#channels.byChannelId(channelId);
    if (existing !== null && existing.record.guildId !== guildId) {
      return { ok: false, reason: NOT_WATCHED_REASON };
    }
    if (existing !== null) {
      return {
        ok: true,
        link: this.linkFor(existing.record),
        alreadyWatched: true,
        syncProblem: null,
      };
    }
    const resolution = await resolveWatchableChannel(this.#client, channelId);
    if (!resolution.ok) {
      return resolution;
    }
    const watched = await this.#channels.add({ channelId, guildId });
    const synced = await this.#source.syncChannel(channelId);
    return {
      ok: true,
      link: this.linkFor(watched.record),
      alreadyWatched: false,
      syncProblem: synced.ok ? null : synced.reason,
    };
  }

  async unwatch(guildId: string, channelId: string): Promise<boolean> {
    if (this.#watchedInGuild(guildId, channelId) === null) {
      return false;
    }
    await this.#channels.remove(channelId);
    this.#incidents.resolveAllForChannel(channelId);
    return true;
  }

  async removeGuild(guildId: string): Promise<void> {
    for (const watched of this.#channels.inGuild(guildId)) {
      this.#incidents.resolveAllForChannel(watched.record.channelId);
    }
    await this.#channels.removeGuild(guildId);
  }

  async rotate(guildId: string, channelId: string): Promise<LinkResult> {
    if (this.#watchedInGuild(guildId, channelId) === null) {
      return { ok: false, reason: NOT_WATCHED_REASON };
    }
    const rotated = await this.#channels.rotateKey(channelId);
    return { ok: true, link: this.linkFor(rotated.record) };
  }

  async pause(guildId: string, channelId: string | null): Promise<BulkResult> {
    const targets = this.#selectTargets(guildId, channelId);
    if (!targets.ok) {
      return targets;
    }
    for (const watched of targets.channels) {
      await this.#channels.setPaused(watched.record.channelId, true);
      this.#source.publishSyncState(watched.record.channelId);
    }
    return { ok: true, channelIds: targets.channels.map(idOf), problems: [] };
  }

  async resume(guildId: string, channelId: string | null): Promise<BulkResult> {
    const targets = this.#selectTargets(guildId, channelId);
    if (!targets.ok) {
      return targets;
    }
    const problems: ChannelSyncProblem[] = [];
    for (const watched of targets.channels) {
      await this.#channels.setPaused(watched.record.channelId, false);
      const synced = await this.#source.syncChannel(watched.record.channelId);
      if (!synced.ok) {
        problems.push({ channelId: watched.record.channelId, reason: synced.reason });
      }
    }
    return { ok: true, channelIds: targets.channels.map(idOf), problems };
  }

  async setNotifyChannel(guildId: string, channelId: string): Promise<void> {
    await this.#state.setNotifyChannel(guildId, channelId);
  }

  #selectTargets(
    guildId: string,
    channelId: string | null,
  ): { ok: true; channels: WatchedChannel[] } | { ok: false; reason: string } {
    if (channelId !== null) {
      const watched = this.#watchedInGuild(guildId, channelId);
      return watched === null
        ? { ok: false, reason: NOT_WATCHED_REASON }
        : { ok: true, channels: [watched] };
    }
    const channels = this.#channels.inGuild(guildId);
    return channels.length === 0
      ? { ok: false, reason: NOTHING_WATCHED_REASON }
      : { ok: true, channels };
  }

  #watchedInGuild(guildId: string, channelId: string): WatchedChannel | null {
    const watched = this.#channels.byChannelId(channelId);
    return watched !== null && watched.record.guildId === guildId ? watched : null;
  }
}

function idOf(watched: WatchedChannel): string {
  return watched.record.channelId;
}
