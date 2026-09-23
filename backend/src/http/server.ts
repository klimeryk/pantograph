import path from 'node:path';
import { type ServerType, serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import {
  channelInfoPath,
  channelStreamPath,
  HEALTH_PATH,
  type HealthReport,
  isChannelKey,
  isStickerId,
  stickerLottiePath,
  type UnknownChannelResponse,
} from '@pantograph/shared';
import { type Context, Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import { streamSSE } from 'hono/streaming';
import type { Logger } from '../logging.ts';
import type { MessageStreamHub } from '../stream/messageStreamHub.ts';
import { SseClient } from './sseClient.ts';
import { StickerJsonCache } from './stickerJsonCache.ts';

const MAX_STREAM_CLIENTS = 5000;
const OVER_CAPACITY_RETRY_AFTER_SECONDS = 15;
const SERVICE_UNAVAILABLE_STATUS = 503;
const NOT_FOUND_STATUS = 404;
const BAD_GATEWAY_STATUS = 502;
const OK_STATUS = 200;
const LAST_EVENT_ID_HEADER = 'Last-Event-ID';
const INDEX_FILE = 'index.html';
const KEY_ROUTE_PARAMETER = 'key';
const STICKER_ROUTE_PARAMETER = 'sticker';
const CHANNEL_INFO_ROUTE = channelInfoPath(`:${KEY_ROUTE_PARAMETER}`);
const CHANNEL_STREAM_ROUTE = channelStreamPath(`:${KEY_ROUTE_PARAMETER}`);
const STICKER_LOTTIE_ROUTE = stickerLottiePath(`:${STICKER_ROUTE_PARAMETER}`);
const UNKNOWN_CHANNEL_RESPONSE: UnknownChannelResponse = { error: 'unknown-channel' };

const STICKER_CACHE_MAX_AGE_SECONDS = 86_400;
const JSON_CONTENT_TYPE = 'application/json';
const STICKER_UNAVAILABLE_MESSAGE = 'Sticker is unavailable.';

const SELF_SOURCE = "'self'";
const NO_SOURCE = "'none'";
const DISCORD_IMAGE_SOURCES = ['https://cdn.discordapp.com', 'https://media.discordapp.net'];
const CONTENT_SECURITY_POLICY = {
  defaultSrc: [SELF_SOURCE],
  imgSrc: [SELF_SOURCE, ...DISCORD_IMAGE_SOURCES],
  connectSrc: [SELF_SOURCE],
  styleSrc: [SELF_SOURCE],
  scriptSrc: [SELF_SOURCE],
  objectSrc: [NO_SOURCE],
  baseUri: [NO_SOURCE],
  formAction: [NO_SOURCE],
  frameAncestors: [NO_SOURCE],
};

export type ChannelStreamTarget = {
  hub: MessageStreamHub;
};

export type HttpAppDependencies = {
  resolveChannel: (key: string) => ChannelStreamTarget | null;
  totalViewers: () => number;
  getHealthReport: () => HealthReport;
  frontendDistPath: string | null;
  stickerJsonBaseUrl: string;
  logger: Logger;
};

export function createHttpApp(dependencies: HttpAppDependencies): Hono {
  const {
    resolveChannel,
    totalViewers,
    getHealthReport,
    frontendDistPath,
    stickerJsonBaseUrl,
    logger,
  } = dependencies;
  const app = new Hono();
  const stickerJsonCache = new StickerJsonCache(stickerJsonBaseUrl);
  app.use(secureHeaders({ contentSecurityPolicy: CONTENT_SECURITY_POLICY }));

  const resolveFromRequest = (context: Context): ChannelStreamTarget | null => {
    const key = context.req.param(KEY_ROUTE_PARAMETER) ?? '';
    return isChannelKey(key) ? resolveChannel(key) : null;
  };

  app.get(HEALTH_PATH, (context) => context.json(getHealthReport()));

  app.get(CHANNEL_INFO_ROUTE, (context) => {
    const target = resolveFromRequest(context);
    if (target === null) {
      return context.json(UNKNOWN_CHANNEL_RESPONSE, NOT_FOUND_STATUS);
    }
    return context.json(target.hub.syncState);
  });

  app.get(CHANNEL_STREAM_ROUTE, (context) => {
    const target = resolveFromRequest(context);
    if (target === null) {
      return context.json(UNKNOWN_CHANNEL_RESPONSE, NOT_FOUND_STATUS);
    }
    if (totalViewers() >= MAX_STREAM_CLIENTS) {
      context.header('Retry-After', String(OVER_CAPACITY_RETRY_AFTER_SECONDS));
      return context.text(
        'Too many connected viewers, try again shortly.',
        SERVICE_UNAVAILABLE_STATUS,
      );
    }
    context.header('X-Accel-Buffering', 'no');
    const lastEventId = context.req.header(LAST_EVENT_ID_HEADER) ?? null;
    const { hub } = target;

    return streamSSE(context, async (stream) => {
      const client = new SseClient(stream, {
        onOverflow: () => logger.warn('Dropping viewer that fell too far behind'),
      });
      stream.onAbort(() => client.close());
      const unsubscribe = hub.subscribe(client, lastEventId);
      logger.debug({ viewers: hub.subscriberCount }, 'Viewer connected');
      try {
        await client.run();
      } finally {
        unsubscribe();
        logger.debug({ viewers: hub.subscriberCount }, 'Viewer disconnected');
      }
    });
  });

  app.get(STICKER_LOTTIE_ROUTE, async (context) => {
    const stickerId = context.req.param(STICKER_ROUTE_PARAMETER) ?? '';
    if (!isStickerId(stickerId)) {
      return context.text(STICKER_UNAVAILABLE_MESSAGE, NOT_FOUND_STATUS);
    }
    const animation = await stickerJsonCache.get(stickerId);
    if (animation === null) {
      logger.warn({ stickerId }, 'Sticker animation is unavailable');
      return context.text(STICKER_UNAVAILABLE_MESSAGE, BAD_GATEWAY_STATUS);
    }
    return stickerJsonResponse(context, animation);
  });

  if (frontendDistPath !== null) {
    const relativeDistPath = path.relative(process.cwd(), frontendDistPath);
    app.use('/*', serveStatic({ root: relativeDistPath }));
    app.get('/*', serveStatic({ path: path.join(relativeDistPath, INDEX_FILE) }));
  }

  return app;
}

function stickerJsonResponse(context: Context, animation: string): Response {
  context.header('Content-Type', JSON_CONTENT_TYPE);
  context.header('Cache-Control', `public, max-age=${STICKER_CACHE_MAX_AGE_SECONDS}`);
  return context.body(animation, OK_STATUS);
}

export function startHttpServer(
  app: Hono,
  options: { host: string; port: number },
): Promise<ServerType> {
  return new Promise((resolve, reject) => {
    const server = serve({ fetch: app.fetch, hostname: options.host, port: options.port }, () =>
      resolve(server),
    );
    server.once('error', reject);
  });
}
