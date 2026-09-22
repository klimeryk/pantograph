import path from 'node:path';
import { type ServerType, serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import {
  channelInfoPath,
  channelStreamPath,
  HEALTH_PATH,
  type HealthReport,
  isChannelKey,
  type UnknownChannelResponse,
} from '@pantograph/shared';
import { type Context, Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Logger } from '../logging.ts';
import type { MessageStreamHub } from '../stream/messageStreamHub.ts';
import { SseClient } from './sseClient.ts';

const MAX_STREAM_CLIENTS = 5000;
const OVER_CAPACITY_RETRY_AFTER_SECONDS = 15;
const SERVICE_UNAVAILABLE_STATUS = 503;
const NOT_FOUND_STATUS = 404;
const LAST_EVENT_ID_HEADER = 'Last-Event-ID';
const INDEX_FILE = 'index.html';
const KEY_ROUTE_PARAMETER = 'key';
const CHANNEL_INFO_ROUTE = channelInfoPath(`:${KEY_ROUTE_PARAMETER}`);
const CHANNEL_STREAM_ROUTE = channelStreamPath(`:${KEY_ROUTE_PARAMETER}`);
const UNKNOWN_CHANNEL_RESPONSE: UnknownChannelResponse = { error: 'unknown-channel' };

export type ChannelStreamTarget = {
  hub: MessageStreamHub;
};

export type HttpAppDependencies = {
  resolveChannel: (key: string) => ChannelStreamTarget | null;
  totalViewers: () => number;
  getHealthReport: () => HealthReport;
  frontendDistPath: string | null;
  logger: Logger;
};

export function createHttpApp(dependencies: HttpAppDependencies): Hono {
  const { resolveChannel, totalViewers, getHealthReport, frontendDistPath, logger } = dependencies;
  const app = new Hono();

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

  if (frontendDistPath !== null) {
    const relativeDistPath = path.relative(process.cwd(), frontendDistPath);
    app.use('/*', serveStatic({ root: relativeDistPath }));
    app.get('/*', serveStatic({ path: path.join(relativeDistPath, INDEX_FILE) }));
  }

  return app;
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
