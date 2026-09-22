import type { AttachmentView, MessageView } from '@pantograph/shared';
import { type Attachment, type Message, MessageType } from 'discord.js';

const AVATAR_SIZE = 64;
const SYNCED_MESSAGE_TYPES: ReadonlySet<MessageType> = new Set([
  MessageType.Default,
  MessageType.Reply,
]);

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
    cleanContent: message.cleanContent,
    createdAt: message.createdAt.toISOString(),
    editedAt: message.editedAt?.toISOString() ?? null,
    replyToMessageId: message.reference?.messageId ?? null,
    attachments: message.attachments.map(toAttachmentView),
  };
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
