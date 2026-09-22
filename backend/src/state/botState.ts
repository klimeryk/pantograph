import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const STATE_VERSION = 2;

export type WatchedChannelRecord = {
  channelId: string;
  guildId: string;
  key: string;
  paused: boolean;
  watchedAt: string;
};

export type GuildRecord = {
  notifyChannelId: string | null;
  registeredCommandHash: string | null;
};

export type PersistedBotState = {
  version: typeof STATE_VERSION;
  channels: Record<string, WatchedChannelRecord>;
  guilds: Record<string, GuildRecord>;
};

export type BotStateListener = (current: PersistedBotState, previous: PersistedBotState) => void;

const EMPTY_GUILD_RECORD: GuildRecord = { notifyChannelId: null, registeredCommandHash: null };
const STATE_FILE_INDENT = 2;
const TEMP_FILE_SUFFIX = '.tmp';

export class BotStateStore {
  readonly #filePath: string;
  #state: PersistedBotState;
  #writeChain: Promise<void> = Promise.resolve();
  readonly #listeners = new Set<BotStateListener>();

  private constructor(filePath: string, state: PersistedBotState) {
    this.#filePath = filePath;
    this.#state = state;
  }

  static async load(options: { filePath: string }): Promise<BotStateStore> {
    const persisted = await readPersistedState(options.filePath);
    return new BotStateStore(
      options.filePath,
      persisted ?? { version: STATE_VERSION, channels: {}, guilds: {} },
    );
  }

  get snapshot(): PersistedBotState {
    return this.#state;
  }

  onChange(listener: BotStateListener): () => void {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  channel(channelId: string): WatchedChannelRecord | null {
    return this.#state.channels[channelId] ?? null;
  }

  channelByKey(key: string): WatchedChannelRecord | null {
    return this.allChannels().find((record) => record.key === key) ?? null;
  }

  channelsInGuild(guildId: string): WatchedChannelRecord[] {
    return this.allChannels().filter((record) => record.guildId === guildId);
  }

  allChannels(): WatchedChannelRecord[] {
    return Object.values(this.#state.channels);
  }

  guild(guildId: string): GuildRecord {
    return this.#state.guilds[guildId] ?? EMPTY_GUILD_RECORD;
  }

  async addChannel(record: WatchedChannelRecord): Promise<void> {
    await this.#update({ channels: { ...this.#state.channels, [record.channelId]: record } });
  }

  async removeChannel(channelId: string): Promise<void> {
    const { [channelId]: _removed, ...remaining } = this.#state.channels;
    await this.#update({ channels: remaining });
  }

  async removeGuild(guildId: string): Promise<void> {
    const { [guildId]: _removed, ...remainingGuilds } = this.#state.guilds;
    const remainingChannels = Object.fromEntries(
      Object.entries(this.#state.channels).filter(([, record]) => record.guildId !== guildId),
    );
    await this.#update({ channels: remainingChannels, guilds: remainingGuilds });
  }

  async setChannelPaused(channelId: string, paused: boolean): Promise<void> {
    await this.#updateChannel(channelId, { paused });
  }

  async setChannelKey(channelId: string, key: string): Promise<void> {
    await this.#updateChannel(channelId, { key });
  }

  async setNotifyChannel(guildId: string, notifyChannelId: string | null): Promise<void> {
    await this.#updateGuild(guildId, { notifyChannelId });
  }

  registeredCommandHash(guildId: string): string | null {
    return this.guild(guildId).registeredCommandHash;
  }

  async setRegisteredCommandHash(guildId: string, registeredCommandHash: string): Promise<void> {
    await this.#updateGuild(guildId, { registeredCommandHash });
  }

  async #updateChannel(channelId: string, changes: Partial<WatchedChannelRecord>): Promise<void> {
    const existing = this.#state.channels[channelId];
    if (existing === undefined) {
      throw new Error(`Channel ${channelId} is not watched`);
    }
    await this.#update({
      channels: { ...this.#state.channels, [channelId]: { ...existing, ...changes } },
    });
  }

  async #updateGuild(guildId: string, changes: Partial<GuildRecord>): Promise<void> {
    await this.#update({
      guilds: { ...this.#state.guilds, [guildId]: { ...this.guild(guildId), ...changes } },
    });
  }

  async #update(changes: Partial<PersistedBotState>): Promise<void> {
    const previous = this.#state;
    const current = { ...previous, ...changes };
    this.#state = current;
    this.#writeChain = this.#writeChain.then(() => writePersistedState(this.#filePath, current));
    await this.#writeChain;
    for (const listener of this.#listeners) {
      listener(current, previous);
    }
  }
}

async function readPersistedState(filePath: string): Promise<PersistedBotState | null> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf8');
  } catch (error) {
    if (isFileNotFound(error)) {
      return null;
    }
    throw error;
  }
  const parsed: unknown = JSON.parse(raw);
  if (!isPersistedBotState(parsed)) {
    throw new Error(
      `State file ${filePath} is from an earlier version or is damaged; delete it and run /pantograph watch again.`,
    );
  }
  return parsed;
}

async function writePersistedState(filePath: string, state: PersistedBotState): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}${TEMP_FILE_SUFFIX}`;
  await writeFile(temporaryPath, JSON.stringify(state, null, STATE_FILE_INDENT), 'utf8');
  await rename(temporaryPath, filePath);
}

function isFileNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'ENOENT'
  );
}

function isPersistedBotState(value: unknown): value is PersistedBotState {
  if (!isRecord(value)) {
    return false;
  }
  const candidate = value as Partial<Record<keyof PersistedBotState, unknown>>;
  return (
    candidate.version === STATE_VERSION &&
    isRecord(candidate.channels) &&
    Object.values(candidate.channels).every(isWatchedChannelRecord) &&
    isRecord(candidate.guilds) &&
    Object.values(candidate.guilds).every(isGuildRecord)
  );
}

function isWatchedChannelRecord(value: unknown): value is WatchedChannelRecord {
  if (!isRecord(value)) {
    return false;
  }
  const candidate = value as Partial<Record<keyof WatchedChannelRecord, unknown>>;
  return (
    typeof candidate.channelId === 'string' &&
    typeof candidate.guildId === 'string' &&
    typeof candidate.key === 'string' &&
    typeof candidate.paused === 'boolean' &&
    typeof candidate.watchedAt === 'string'
  );
}

function isGuildRecord(value: unknown): value is GuildRecord {
  if (!isRecord(value)) {
    return false;
  }
  const candidate = value as Partial<Record<keyof GuildRecord, unknown>>;
  return (
    isNullableString(candidate.notifyChannelId) && isNullableString(candidate.registeredCommandHash)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}
