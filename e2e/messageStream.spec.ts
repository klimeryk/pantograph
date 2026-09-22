import { channelPagePath, type MessageView, StreamEventName } from '@pantograph/shared';
import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import type { FakeEvent } from './fakeBackend.ts';
import {
  FAKE_CHANNEL_KEY,
  FAKE_SECOND_CHANNEL_KEY,
  FAKE_UNKNOWN_CHANNEL_KEY,
  fakeChannelClosePath,
  fakeChannelEventsPath,
} from './fakeBackendConfig.ts';

const NO_CONTENT_STATUS = 204;
const REVOCATION_NOTICE_TIMEOUT_MS = 15_000;

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
    cleanContent: 'hello from discord',
    createdAt: new Date().toISOString(),
    editedAt: null,
    replyToMessageId: null,
    attachments: [],
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

function messageArticle(page: Page, messageId: string) {
  return page.locator(`article[data-message-id="${messageId}"]`);
}

test('shows, edits and removes messages as they stream in', async ({ page, request }) => {
  await page.goto(channelPagePath(FAKE_CHANNEL_KEY));
  await expect(page.locator('[data-connection-state]')).toHaveText('Live');
  await expect(page.locator('[data-channel-name]')).toHaveText('#fake-channel');

  const messageId = `${Date.now()}`;
  await emit(request, FAKE_CHANNEL_KEY, {
    name: StreamEventName.MessageCreated,
    payload: buildMessage({ id: messageId, cleanContent: 'first version' }),
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
      cleanContent: 'second version',
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

test('reflects the paused state pushed by the backend', async ({ page, request }) => {
  await page.goto(channelPagePath(FAKE_CHANNEL_KEY));
  const banner = page.locator('[data-paused-banner]');
  await expect(banner).toBeHidden();

  await emit(request, FAKE_CHANNEL_KEY, {
    name: StreamEventName.SyncStateChanged,
    payload: { paused: true, watchedChannel: { id: '1', name: 'fake-channel' } },
  });
  await expect(banner).toBeVisible();

  await emit(request, FAKE_CHANNEL_KEY, {
    name: StreamEventName.SyncStateChanged,
    payload: { paused: false, watchedChannel: { id: '1', name: 'fake-channel' } },
  });
  await expect(banner).toBeHidden();
});

test('keeps channels separate', async ({ page, request }) => {
  await page.goto(channelPagePath(FAKE_SECOND_CHANNEL_KEY));
  await expect(page.locator('[data-channel-name]')).toHaveText('#other-channel');

  const firstChannelMessageId = `${Date.now()}`;
  await emit(request, FAKE_CHANNEL_KEY, {
    name: StreamEventName.MessageCreated,
    payload: buildMessage({ id: firstChannelMessageId, cleanContent: 'only in fake-channel' }),
  });
  const secondChannelMessageId = `${Date.now() + 1}`;
  await emit(request, FAKE_SECOND_CHANNEL_KEY, {
    name: StreamEventName.MessageCreated,
    payload: buildMessage({
      id: secondChannelMessageId,
      channelId: '2',
      cleanContent: 'only in other-channel',
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
  await expect(page.locator('[data-connection-state]')).toBeHidden();
});

test('tells viewers when their channel link is revoked', async ({ page, request }) => {
  await page.goto(channelPagePath(FAKE_SECOND_CHANNEL_KEY));
  await expect(page.locator('[data-connection-state]')).toHaveText('Live');

  await closeChannel(request, FAKE_SECOND_CHANNEL_KEY);
  await expect(page.locator('[data-unavailable]')).toBeVisible({
    timeout: REVOCATION_NOTICE_TIMEOUT_MS,
  });
});
