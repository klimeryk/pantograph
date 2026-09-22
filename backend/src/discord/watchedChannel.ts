import {
  type Channel,
  ChannelType,
  type Client,
  channelMention,
  type NewsChannel,
  PermissionFlagsBits,
  type TextChannel,
} from 'discord.js';
import { describeError } from '../errors.ts';

export type WatchableChannel = TextChannel | NewsChannel;

export const WATCHABLE_CHANNEL_TYPES = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
] as const;

export const REQUIRED_WATCH_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ReadMessageHistory,
] as const;

export type ChannelResolution =
  | { ok: true; channel: WatchableChannel }
  | { ok: false; reason: string };

export function isWatchableChannel(channel: Channel): channel is WatchableChannel {
  return channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement;
}

export async function resolveWatchableChannel(
  client: Client<true>,
  channelId: string,
): Promise<ChannelResolution> {
  let channel: Channel | null;
  try {
    channel = await client.channels.fetch(channelId);
  } catch (error) {
    return {
      ok: false,
      reason: `Channel ${channelMention(channelId)} could not be fetched: ${describeError(error)}`,
    };
  }
  if (channel === null || !isWatchableChannel(channel)) {
    return {
      ok: false,
      reason: `${channelMention(channelId)} is not a text or announcement channel the bot can see.`,
    };
  }
  const botMember = channel.guild.members.me ?? (await channel.guild.members.fetchMe());
  const missingPermissions = channel.permissionsFor(botMember).missing(REQUIRED_WATCH_PERMISSIONS);
  if (missingPermissions.length > 0) {
    return {
      ok: false,
      reason: `The bot is missing ${missingPermissions.join(', ')} in ${channelMention(channelId)}.`,
    };
  }
  return { ok: true, channel };
}
