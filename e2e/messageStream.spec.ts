import {
  channelPagePath,
  type MessageView,
  StickerKind,
  StreamEventName,
} from '@pantograph/shared';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import type { FakeEvent } from './fakeBackend.ts';
import {
  FAKE_CHANNEL_KEY,
  FAKE_IMAGE_STICKER_ID,
  FAKE_LOTTIE_STICKER_ID,
  FAKE_SECOND_CHANNEL_KEY,
  FAKE_UNKNOWN_CHANNEL_KEY,
  fakeChannelClosePath,
  fakeChannelEventsPath,
} from './fakeBackendConfig.ts';

const NO_CONTENT_STATUS = 204;
const BOARD_ON_TIME = 'ON TIME';
const BOARD_HELD_AT_SIGNAL = 'HELD AT SIGNAL';
const BOARD_CANCELLED = 'CANCELLED';
const PLATFORM_NUMBER_PATTERN = /^\d{1,2}$/;
const MESSAGES_TO_OVERFLOW_VIEWPORT = 40;
const STICKER_PLAYING = 'playing';
const STICKER_PAUSED = 'paused';
const REVOCATION_NOTICE_TIMEOUT_MS = 15_000;
const MENTIONED_USER_ID = '867465548148768840';
const MENTIONED_CHANNEL_ID = '1551732426290626634';
const CUSTOM_EMOJI_ID = '1552081214045822976';
const TRANSPARENT_PIXEL_URL =
  'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const RICH_MESSAGE = [
  'And just to be on the safe side, one more, this time ~~longer~~.',
  '`And` __maybe__ with some **rich** *formatting*? ||secret||',
  '',
  'Or something with a quote (line starting with ">").',
  '> quoted line',
  '> second quoted line',
].join('\n');

function buildMessage(overrides: Partial<MessageView> & Pick<MessageView, 'id'>): MessageView {
  return {
    channelId: '1',
    author: {
      id: 'author-1',
      displayName: 'Ada',
      avatarUrl: 'https://cdn.discordapp.com/embed/avatars/0.png',
      isBot: false,
    },
    content: 'hello from discord',
    mentions: { users: {}, roles: {}, channels: {} },
    createdAt: new Date().toISOString(),
    editedAt: null,
    replyToMessageId: null,
    attachments: [],
    stickers: [],
    ...overrides,
  };
}

async function emit(request: APIRequestContext, key: string, event: FakeEvent): Promise<void> {
  const response = await request.post(fakeChannelEventsPath(key), { data: event });
  expect(response.status()).toBe(NO_CONTENT_STATUS);
}

async function closeChannel(request: APIRequestContext, key: string): Promise<void> {
  const response = await request.post(fakeChannelClosePath(key));
  expect(response.status()).toBe(NO_CONTENT_STATUS);
}

async function expectOnTime(page: Page): Promise<void> {
  await expect(page.locator('[data-board-status]')).toHaveText(BOARD_ON_TIME);
}

function messageArticle(page: Page, messageId: string) {
  return page.locator(`article[data-message-id="${messageId}"]`);
}

test('shows, edits and removes messages as they stream in', async ({ page, request }) => {
  await page.goto(channelPagePath(FAKE_CHANNEL_KEY));
  await expectOnTime(page);
  await expect(page.locator('[data-channel-name]')).toHaveText('#fake-channel');
  await expect(page.locator('[data-board-platform]')).toHaveText(PLATFORM_NUMBER_PATTERN);

  const messageId = `${Date.now()}`;
  await emit(request, FAKE_CHANNEL_KEY, {
    name: StreamEventName.MessageCreated,
    payload: buildMessage({ id: messageId, content: 'first version' }),
  });
  const article = messageArticle(page, messageId);
  await expect(article).toBeVisible();
  await expect(article.locator('[data-content]')).toHaveText('first version');
  await expect(article.locator('[data-author]')).toContainText('Ada');
  await expect(article.locator('[data-edited]')).toBeHidden();

  await emit(request, FAKE_CHANNEL_KEY, {
    name: StreamEventName.MessageUpdated,
    payload: buildMessage({
      id: messageId,
      content: 'second version',
      editedAt: new Date().toISOString(),
    }),
  });
  await expect(article.locator('[data-content]')).toHaveText('second version');
  await expect(article.locator('[data-edited]')).toBeVisible();

  await page.reload();
  await expect(messageArticle(page, messageId).locator('[data-content]')).toHaveText(
    'second version',
  );

  await emit(request, FAKE_CHANNEL_KEY, {
    name: StreamEventName.MessageDeleted,
    payload: { ids: [messageId] },
  });
  await expect(messageArticle(page, messageId)).toHaveCount(0);
});

test('renders Discord formatting instead of raw markers', async ({ page, request }) => {
  await page.goto(channelPagePath(FAKE_CHANNEL_KEY));
  await expectOnTime(page);

  const messageId = `${Date.now()}`;
  await emit(request, FAKE_CHANNEL_KEY, {
    name: StreamEventName.MessageCreated,
    payload: buildMessage({ id: messageId, content: RICH_MESSAGE }),
  });
  const content = messageArticle(page, messageId).locator('[data-content]');
  await expect(content.locator('s')).toHaveText('longer');
  await expect(content.locator('code')).toHaveText('And');
  await expect(content.locator('u')).toHaveText('maybe');
  await expect(content.locator('strong')).toHaveText('rich');
  await expect(content.locator('em')).toHaveText('formatting');
  await expect(content.locator('blockquote')).toContainText('quoted line');
  await expect(content).not.toContainText('**');
  await expect(content).not.toContainText('~~');

  const spoiler = content.locator('[data-spoiler]');
  await expect(spoiler).toHaveAttribute('data-spoiler', 'hidden');
  await spoiler.click();
  await expect(spoiler).toHaveAttribute('data-spoiler', 'revealed');
  await expect(spoiler).toHaveText('secret');
});

test('renders custom emoji and mention names', async ({ page, request }) => {
  await page.goto(channelPagePath(FAKE_CHANNEL_KEY));
  await expectOnTime(page);

  const messageId = `${Date.now()}`;
  await emit(request, FAKE_CHANNEL_KEY, {
    name: StreamEventName.MessageCreated,
    payload: buildMessage({
      id: messageId,
      content: `<:blobaww:${CUSTOM_EMOJI_ID}> hi <@${MENTIONED_USER_ID}> in <#${MENTIONED_CHANNEL_ID}>`,
      mentions: {
        users: { [MENTIONED_USER_ID]: 'klimeryk' },
        roles: {},
        channels: { [MENTIONED_CHANNEL_ID]: 'general' },
      },
    }),
  });

  const content = messageArticle(page, messageId).locator('[data-content]');
  const emoji = content.locator('img');
  await expect(emoji).toHaveAttribute('alt', ':blobaww:');
  await expect(emoji).toHaveAttribute('src', new RegExp(`/emojis/${CUSTOM_EMOJI_ID}\\.`));
  await expect(content).toContainText('@klimeryk');
  await expect(content).toContainText('#general');
  await expect(content).not.toContainText(MENTIONED_USER_ID);
});

test('renders image and animated stickers', async ({ page, request }) => {
  await page.goto(channelPagePath(FAKE_CHANNEL_KEY));
  await expectOnTime(page);

  const messageId = `${Date.now()}`;
  await emit(request, FAKE_CHANNEL_KEY, {
    name: StreamEventName.MessageCreated,
    payload: buildMessage({
      id: messageId,
      content: '',
      stickers: [
        {
          id: FAKE_IMAGE_STICKER_ID,
          name: 'waving',
          kind: StickerKind.Image,
          url: TRANSPARENT_PIXEL_URL,
        },
        { id: FAKE_LOTTIE_STICKER_ID, name: 'dancing', kind: StickerKind.Lottie },
      ],
    }),
  });

  const stickers = messageArticle(page, messageId).locator('[data-sticker]');
  await expect(stickers).toHaveCount(2);
  await expect(stickers.filter({ has: page.locator('img') })).toHaveAttribute(
    'data-sticker',
    'waving',
  );
  const animated = stickers.filter({ has: page.locator('svg') });
  await expect(animated).toHaveAttribute('data-sticker', 'dancing');
  await expect(animated).toHaveAttribute('data-sticker-state', STICKER_PLAYING);

  const firstFillerId = Number(messageId) + 1;
  for (let offset = 0; offset < MESSAGES_TO_OVERFLOW_VIEWPORT; offset += 1) {
    await emit(request, FAKE_CHANNEL_KEY, {
      name: StreamEventName.MessageCreated,
      payload: buildMessage({ id: `${firstFillerId + offset}`, content: `service ${offset}` }),
    });
  }
  await expect(animated).not.toBeInViewport();
  await expect(animated).toHaveAttribute('data-sticker-state', STICKER_PAUSED);

  await page.locator('[data-message-list]').evaluate((element) => {
    element.scrollTop = 0;
  });
  await expect(animated).toBeInViewport();
  await expect(animated).toHaveAttribute('data-sticker-state', STICKER_PLAYING);
});

test('reflects the paused state pushed by the backend', async ({ page, request }) => {
  await page.goto(channelPagePath(FAKE_CHANNEL_KEY));
  const banner = page.locator('[data-paused-banner]');
  await expect(banner).toBeHidden();

  await emit(request, FAKE_CHANNEL_KEY, {
    name: StreamEventName.SyncStateChanged,
    payload: { paused: true, watchedChannel: { id: '1', name: 'fake-channel' } },
  });
  await expect(banner).toBeVisible();
  await expect(page.locator('[data-board-status]')).toHaveText(BOARD_HELD_AT_SIGNAL);

  await emit(request, FAKE_CHANNEL_KEY, {
    name: StreamEventName.SyncStateChanged,
    payload: { paused: false, watchedChannel: { id: '1', name: 'fake-channel' } },
  });
  await expect(banner).toBeHidden();
  await expectOnTime(page);
});

test('keeps channels separate', async ({ page, request }) => {
  await page.goto(channelPagePath(FAKE_SECOND_CHANNEL_KEY));
  await expect(page.locator('[data-channel-name]')).toHaveText('#other-channel');

  const firstChannelMessageId = `${Date.now()}`;
  await emit(request, FAKE_CHANNEL_KEY, {
    name: StreamEventName.MessageCreated,
    payload: buildMessage({ id: firstChannelMessageId, content: 'only in fake-channel' }),
  });
  const secondChannelMessageId = `${Date.now() + 1}`;
  await emit(request, FAKE_SECOND_CHANNEL_KEY, {
    name: StreamEventName.MessageCreated,
    payload: buildMessage({
      id: secondChannelMessageId,
      channelId: '2',
      content: 'only in other-channel',
    }),
  });
  await expect(messageArticle(page, secondChannelMessageId)).toBeVisible();
  await expect(messageArticle(page, firstChannelMessageId)).toHaveCount(0);
});

test('explains when a link is not active', async ({ page }) => {
  await page.goto(channelPagePath(FAKE_UNKNOWN_CHANNEL_KEY));
  await expect(page.locator('[data-unavailable]')).toBeVisible();
  await expect(page.locator('[data-message-list]')).toBeHidden();
});

test('shows a landing page without a channel link', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-landing]')).toBeVisible();
  await expect(page.locator('[data-departure-board]')).toBeHidden();
});

test('tells viewers when their channel link is revoked', async ({ page, request }) => {
  await page.goto(channelPagePath(FAKE_SECOND_CHANNEL_KEY));
  await expectOnTime(page);

  await closeChannel(request, FAKE_SECOND_CHANNEL_KEY);
  await expect(page.locator('[data-unavailable]')).toBeVisible({
    timeout: REVOCATION_NOTICE_TIMEOUT_MS,
  });
  await expect(page.locator('[data-board-status]')).toHaveText(BOARD_CANCELLED);
});

test('announces arrivals waiting below the fold', async ({ page, request }) => {
  await page.goto(channelPagePath(FAKE_CHANNEL_KEY));
  await expectOnTime(page);

  const firstId = Date.now();
  for (let offset = 0; offset < MESSAGES_TO_OVERFLOW_VIEWPORT; offset += 1) {
    await emit(request, FAKE_CHANNEL_KEY, {
      name: StreamEventName.MessageCreated,
      payload: buildMessage({ id: `${firstId + offset}`, content: `service ${offset}` }),
    });
  }
  const lastFillerId = `${firstId + MESSAGES_TO_OVERFLOW_VIEWPORT - 1}`;
  await expect(messageArticle(page, lastFillerId)).toBeVisible();
  const pill = page.locator('[data-approaching]');
  await expect(pill).toBeHidden();

  const list = page.locator('[data-message-list]');
  await list.evaluate((element) => {
    element.scrollTop = 0;
  });
  const approachingId = `${firstId + MESSAGES_TO_OVERFLOW_VIEWPORT}`;
  await emit(request, FAKE_CHANNEL_KEY, {
    name: StreamEventName.MessageCreated,
    payload: buildMessage({ id: approachingId, content: 'now approaching' }),
  });
  await expect(pill).toBeVisible();
  await expect(pill.locator('[data-approaching-count]')).toHaveText('1');

  await emit(request, FAKE_CHANNEL_KEY, {
    name: StreamEventName.MessageCreated,
    payload: buildMessage({ id: `${firstId + MESSAGES_TO_OVERFLOW_VIEWPORT + 1}` }),
  });
  await expect(pill.locator('[data-approaching-count]')).toHaveText('2');

  await pill.click();
  await expect(pill).toBeHidden();
  await expect(messageArticle(page, approachingId)).toBeInViewport();
});
