import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { type MessageView, StreamEventName, type SyncStateView } from '@pantograph/shared';
import { Hono } from 'hono';
import { createHttpApp, startHttpServer } from '../backend/src/http/server.ts';
import { createLogger } from '../backend/src/logging.ts';
import { MessageStreamHub } from '../backend/src/stream/messageStreamHub.ts';
import { MILLISECONDS_PER_SECOND } from '../backend/src/time.ts';
import {
  FAKE_BACKEND_HOST,
  FAKE_BACKEND_PORT,
  FAKE_CHANNEL_KEY,
  FAKE_PIXEL_PATH,
  FAKE_SECOND_CHANNEL_KEY,
  FAKE_STICKER_JSON_BASE_URL,
  fakeChannelClosePath,
  fakeChannelEventsPath,
  fakeStickerJsonPath,
} from './fakeBackendConfig.ts';

const FRONTEND_DIST_PATH = path.resolve(import.meta.dirname, '../frontend/dist');
const LOTTIE_STICKER_FIXTURE_PATH = path.resolve(
  import.meta.dirname,
  'fixtures/lottieSticker.json',
);
const KEY_ROUTE_PARAMETER = 'key';
const STICKER_ROUTE_PARAMETER = 'sticker';
const NO_CONTENT_STATUS = 204;
const NOT_FOUND_STATUS = 404;
const JSON_CONTENT_TYPE = 'application/json';
const GIF_CONTENT_TYPE = 'image/gif';
const TRANSPARENT_PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64',
);

export type FakeEvent =
  | { name: typeof StreamEventName.MessageCreated; payload: MessageView }
  | { name: typeof StreamEventName.MessageUpdated; payload: MessageView }
  | { name: typeof StreamEventName.MessageDeleted; payload: { ids: string[] } }
  | { name: typeof StreamEventName.SyncStateChanged; payload: SyncStateView };

const logger = createLogger({ level: 'warn', pretty: false });
const epoch = String(Date.now());
const startedAt = Date.now();
const hubsByKey = new Map<string, MessageStreamHub>();

function registerFakeChannel(key: string, channelId: string, name: string): void {
  hubsByKey.set(
    key,
    new MessageStreamHub({
      epoch,
      initialSyncState: { paused: false, watchedChannel: { id: channelId, name } },
    }),
  );
}

registerFakeChannel(FAKE_CHANNEL_KEY, '1', 'fake-channel');
registerFakeChannel(FAKE_SECOND_CHANNEL_KEY, '2', 'other-channel');

function totalViewers(): number {
  let total = 0;
  for (const hub of hubsByKey.values()) {
    total += hub.subscriberCount;
  }
  return total;
}

const app = new Hono();
app.post(fakeChannelEventsPath(`:${KEY_ROUTE_PARAMETER}`), async (context) => {
  const hub = hubsByKey.get(context.req.param(KEY_ROUTE_PARAMETER) ?? '');
  if (hub === undefined) {
    return context.body(null, NOT_FOUND_STATUS);
  }
  const event = (await context.req.json()) as FakeEvent;
  switch (event.name) {
    case StreamEventName.MessageCreated:
      hub.applyMessageCreated(event.payload);
      break;
    case StreamEventName.MessageUpdated:
      hub.applyMessageUpdated(event.payload);
      break;
    case StreamEventName.MessageDeleted:
      hub.applyMessagesDeleted(event.payload.ids);
      break;
    case StreamEventName.SyncStateChanged:
      hub.setSyncState(event.payload);
      break;
  }
  return context.body(null, NO_CONTENT_STATUS);
});
app.post(fakeChannelClosePath(`:${KEY_ROUTE_PARAMETER}`), (context) => {
  const key = context.req.param(KEY_ROUTE_PARAMETER) ?? '';
  const hub = hubsByKey.get(key);
  if (hub === undefined) {
    return context.body(null, NOT_FOUND_STATUS);
  }
  hub.disconnectAll();
  hubsByKey.delete(key);
  return context.body(null, NO_CONTENT_STATUS);
});
app.get(fakeStickerJsonPath(`:${STICKER_ROUTE_PARAMETER}`), async (context) => {
  const animation = await readFile(LOTTIE_STICKER_FIXTURE_PATH, 'utf8');
  context.header('Content-Type', JSON_CONTENT_TYPE);
  return context.body(animation);
});
app.get(FAKE_PIXEL_PATH, (context) => {
  context.header('Content-Type', GIF_CONTENT_TYPE);
  return context.body(TRANSPARENT_PIXEL);
});
app.route(
  '/',
  createHttpApp({
    resolveChannel: (key) => {
      const hub = hubsByKey.get(key);
      return hub === undefined ? null : { hub };
    },
    totalViewers,
    logger,
    frontendDistPath: FRONTEND_DIST_PATH,
    stickerJsonBaseUrl: FAKE_STICKER_JSON_BASE_URL,
    getHealthReport: () => ({
      status: 'ok',
      discord: { connected: true, gatewayPingMs: 0 },
      watchedChannels: hubsByKey.size,
      connectedViewers: totalViewers(),
      uptimeSeconds: Math.floor((Date.now() - startedAt) / MILLISECONDS_PER_SECOND),
    }),
  }),
);

await startHttpServer(app, { host: FAKE_BACKEND_HOST, port: FAKE_BACKEND_PORT });
process.stdout.write(
  `Fake backend listening on http://${FAKE_BACKEND_HOST}:${FAKE_BACKEND_PORT}\n`,
);
