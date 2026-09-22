import type {
  AttachmentView,
  MentionNames,
  MentionsView,
  MessageView,
  StickerView,
} from '@pantograph/shared';
import { StickerKind } from '@pantograph/shared';
import {
  type Attachment,
  type Collection,
  type Message,
  MessageType,
  type Sticker,
  StickerFormatType,
} from 'discord.js';

const AVATAR_SIZE = 64;
const SYNCED_MESSAGE_TYPES: ReadonlySet<MessageType> = new Set([
  MessageType.Default,
  MessageType.Reply,
]);
const ANIMATED_STICKER_BASE_URL = 'https://media.discordapp.net/stickers/';
const ANIMATED_STICKER_EXTENSION = '.gif';

export function isSyncedMessage(message: Message, botUserId: string): boolean {
  return SYNCED_MESSAGE_TYPES.has(message.type) && message.author.id !== botUserId;
}

export function toMessageView(message: Message): MessageView {
  return {
    id: message.id,
    channelId: message.channelId,
    author: {
      id: message.author.id,
      displayName: message.member?.displayName ?? message.author.displayName,
      avatarUrl: message.author.displayAvatarURL({ size: AVATAR_SIZE, extension: 'webp' }),
      isBot: message.author.bot,
    },
    content: message.content,
    mentions: toMentionsView(message),
    createdAt: message.createdAt.toISOString(),
    editedAt: message.editedAt?.toISOString() ?? null,
    replyToMessageId: message.reference?.messageId ?? null,
    attachments: message.attachments.map(toAttachmentView),
    stickers: message.stickers.map(toStickerView),
  };
}

function toMentionsView(message: Message): MentionsView {
  const members = message.inGuild() ? message.mentions.members : null;
  return {
    users: toMentionNames(
      message.mentions.users,
      (user) => members?.get(user.id)?.displayName ?? user.displayName,
    ),
    roles: toMentionNames(message.mentions.roles, (role) => role.name),
    channels: toMentionNames(message.mentions.channels, (channel) =>
      'name' in channel ? channel.name : null,
    ),
  };
}

function toMentionNames<Mentioned>(
  mentioned: Collection<string, Mentioned>,
  nameOf: (value: Mentioned) => string | null,
): MentionNames {
  const names: MentionNames = {};
  for (const [id, value] of mentioned) {
    const name = nameOf(value);
    if (name !== null) {
      names[id] = name;
    }
  }
  return names;
}

function toAttachmentView(attachment: Attachment): AttachmentView {
  return {
    id: attachment.id,
    name: attachment.name,
    url: attachment.url,
    contentType: attachment.contentType,
    width: attachment.width,
    height: attachment.height,
    sizeBytes: attachment.size,
  };
}

function toStickerView(sticker: Sticker): StickerView {
  const identity = { id: sticker.id, name: sticker.name };
  if (sticker.format === StickerFormatType.Lottie) {
    return { ...identity, kind: StickerKind.Lottie };
  }
  return { ...identity, kind: StickerKind.Image, url: stickerImageUrl(sticker) };
}

function stickerImageUrl(sticker: Sticker): string {
  if (sticker.format === StickerFormatType.GIF) {
    return `${ANIMATED_STICKER_BASE_URL}${sticker.id}${ANIMATED_STICKER_EXTENSION}`;
  }
  return sticker.url;
}
