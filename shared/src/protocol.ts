export const HEALTH_PATH = '/api/health';
export const CHANNEL_PAGE_PATH_PREFIX = '/c/';
export const CHANNEL_KEY_PATTERN = /^[a-z0-9]{4}(-[a-z0-9]{4}){3}$/;
export const STICKER_ID_PATTERN = /^\d{17,20}$/;

const CHANNEL_API_PATH_PREFIX = '/api/channels/';
const STREAM_PATH_SUFFIX = '/stream';
const STICKER_API_PATH_PREFIX = '/api/stickers/';

export function isChannelKey(value: string): boolean {
  return CHANNEL_KEY_PATTERN.test(value);
}

export function isStickerId(value: string): boolean {
  return STICKER_ID_PATTERN.test(value);
}

export function stickerLottiePath(id: string): string {
  return `${STICKER_API_PATH_PREFIX}${id}`;
}

export function channelPagePath(key: string): string {
  return `${CHANNEL_PAGE_PATH_PREFIX}${key}`;
}

export function channelInfoPath(key: string): string {
  return `${CHANNEL_API_PATH_PREFIX}${key}`;
}

export function channelStreamPath(key: string): string {
  return `${channelInfoPath(key)}${STREAM_PATH_SUFFIX}`;
}

export const StreamEventName = {
  Snapshot: 'snapshot',
  MessageCreated: 'message.created',
  MessageUpdated: 'message.updated',
  MessageDeleted: 'message.deleted',
  SyncStateChanged: 'sync.state',
} as const;

export type StreamEventName = (typeof StreamEventName)[keyof typeof StreamEventName];

export type AttachmentView = {
  id: string;
  name: string;
  url: string;
  contentType: string | null;
  width: number | null;
  height: number | null;
  sizeBytes: number;
};

export type AuthorView = {
  id: string;
  displayName: string;
  avatarUrl: string;
  isBot: boolean;
};

export type MentionNames = Record<string, string>;

export type MentionsView = {
  users: MentionNames;
  roles: MentionNames;
  channels: MentionNames;
};

export const StickerKind = { Image: 'image', Lottie: 'lottie' } as const;

export type StickerKind = (typeof StickerKind)[keyof typeof StickerKind];

export type StickerView =
  | { id: string; name: string; kind: typeof StickerKind.Image; url: string }
  | { id: string; name: string; kind: typeof StickerKind.Lottie };

export type MessageView = {
  id: string;
  channelId: string;
  author: AuthorView;
  content: string;
  mentions: MentionsView;
  createdAt: string;
  editedAt: string | null;
  replyToMessageId: string | null;
  attachments: AttachmentView[];
  stickers: StickerView[];
};

export type WatchedChannelView = {
  id: string;
  name: string;
};

export type SyncStateView = {
  paused: boolean;
  watchedChannel: WatchedChannelView | null;
};

export type SnapshotPayload = {
  messages: MessageView[];
  syncState: SyncStateView;
};

export type MessageDeletedPayload = {
  ids: string[];
};

export type StreamEvent =
  | { name: typeof StreamEventName.Snapshot; payload: SnapshotPayload }
  | { name: typeof StreamEventName.MessageCreated; payload: MessageView }
  | { name: typeof StreamEventName.MessageUpdated; payload: MessageView }
  | { name: typeof StreamEventName.MessageDeleted; payload: MessageDeletedPayload }
  | { name: typeof StreamEventName.SyncStateChanged; payload: SyncStateView };

export type StreamEventPayload<Name extends StreamEventName> = Extract<
  StreamEvent,
  { name: Name }
>['payload'];

export type UnknownChannelResponse = {
  error: 'unknown-channel';
};

export type HealthReport = {
  status: 'ok' | 'degraded';
  discord: {
    connected: boolean;
    gatewayPingMs: number | null;
  };
  watchedChannels: number;
  connectedViewers: number;
  uptimeSeconds: number;
};

export function compareSnowflakes(left: string, right: string): number {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);
  if (leftValue < rightValue) {
    return -1;
  }
  if (leftValue > rightValue) {
    return 1;
  }
  return 0;
}
