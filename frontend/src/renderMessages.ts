import {
  type AttachmentView,
  compareSnowflakes,
  type MessageView,
  StickerKind,
  type StickerView,
  stickerLottiePath,
} from '@pantograph/shared';
import type { AnimationItem } from 'lottie-web/build/player/lottie_light';
import { renderDiscordMarkdown } from './discordMarkdown.ts';
import { requireElement } from './dom.ts';
import type { MessageStore, StoreChange } from './messageStore.ts';

const NEAR_BOTTOM_THRESHOLD_PX = 80;
const IMAGE_CONTENT_TYPE_PREFIX = 'image/';
const MESSAGE_ID_ATTRIBUTE = 'data-message-id';
const SNOWFLAKE_BEFORE_ALL_OTHERS = '0';
const STICKER_ATTRIBUTE = 'data-sticker';
const STICKER_SIZE_CLASS = 'size-32';
const STICKER_NAME_CLASS = 'rounded bg-neutral-800 px-1 text-sm text-neutral-400';
const LOTTIE_RENDERER = 'svg';
const LOTTIE_LOAD_FAILED_EVENT = 'data_failed';

const animationsByItem = new WeakMap<Element, AnimationItem[]>();
const discardedItems = new WeakSet<Element>();

const timeFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  month: 'short',
  day: 'numeric',
});

export class MessageListRenderer {
  readonly #list: HTMLOListElement;
  readonly #emptyState: HTMLElement;
  readonly #template: HTMLTemplateElement;
  readonly #store: MessageStore;

  constructor(root: ParentNode, store: MessageStore) {
    this.#list = requireElement<HTMLOListElement>(root, '[data-message-list]');
    this.#emptyState = requireElement(root, '[data-empty-state]');
    this.#template = requireElement<HTMLTemplateElement>(root, '[data-message-template]');
    this.#store = store;
  }

  applyChange(change: StoreChange): void {
    const wasNearBottom = this.#isNearBottom();
    switch (change.kind) {
      case 'reset':
        this.#renderAll();
        break;
      case 'upsert':
        this.#upsert(change.message);
        for (const id of change.evictedIds) {
          this.#removeItem(id);
        }
        break;
      case 'remove':
        for (const id of change.ids) {
          this.#removeItem(id);
        }
        break;
      case 'syncState':
      case 'none':
        break;
    }
    this.#emptyState.hidden = this.#list.childElementCount > 0;
    if (wasNearBottom || change.kind === 'reset') {
      this.#list.scrollTop = this.#list.scrollHeight;
    }
  }

  #renderAll(): void {
    for (const existing of this.#list.children) {
      discardItem(existing);
    }
    this.#list.replaceChildren(
      ...this.#store.messagesOldestFirst.map((message) => this.#createItem(message)),
    );
  }

  #removeItem(messageId: string): void {
    const item = this.#findItem(messageId);
    if (item === null) {
      return;
    }
    discardItem(item);
    item.remove();
  }

  #upsert(message: MessageView): void {
    const existing = this.#findItem(message.id);
    const item = this.#createItem(message);
    if (existing) {
      discardItem(existing);
      existing.replaceWith(item);
      return;
    }
    const nextItem = [...this.#list.children].find(
      (candidate) => compareSnowflakes(messageIdOf(candidate), message.id) > 0,
    );
    this.#list.insertBefore(item, nextItem ?? null);
  }

  #findItem(messageId: string): Element | null {
    return this.#list.querySelector(`li:has([${MESSAGE_ID_ATTRIBUTE}="${messageId}"])`);
  }

  #createItem(message: MessageView): HTMLLIElement {
    const fragment = this.#template.content.cloneNode(true) as DocumentFragment;
    const item = requireElement<HTMLLIElement>(fragment, 'li');
    requireElement(item, 'article').setAttribute(MESSAGE_ID_ATTRIBUTE, message.id);

    const avatar = requireElement<HTMLImageElement>(item, '[data-avatar]');
    avatar.src = message.author.avatarUrl;

    const author = requireElement(item, '[data-author]');
    author.textContent = message.author.displayName;
    if (message.author.isBot) {
      author.append(createBotBadge());
    }

    const created = requireElement<HTMLTimeElement>(item, '[data-created]');
    created.dateTime = message.createdAt;
    created.textContent = timeFormatter.format(new Date(message.createdAt));

    requireElement(item, '[data-edited]').hidden = message.editedAt === null;
    requireElement(item, '[data-content]').replaceChildren(
      renderDiscordMarkdown(message.content, {
        extended: message.author.isBot,
        mentions: message.mentions,
      }),
    );

    const stickers = requireElement<HTMLUListElement>(item, '[data-stickers]');
    stickers.replaceChildren(
      ...message.stickers.map((sticker) => createStickerItem(item, sticker)),
    );
    stickers.hidden = message.stickers.length === 0;

    const attachments = requireElement<HTMLUListElement>(item, '[data-attachments]');
    attachments.replaceChildren(...message.attachments.map(createAttachmentItem));
    attachments.hidden = message.attachments.length === 0;
    return item;
  }

  #isNearBottom(): boolean {
    const distanceFromBottom =
      this.#list.scrollHeight - this.#list.scrollTop - this.#list.clientHeight;
    return distanceFromBottom < NEAR_BOTTOM_THRESHOLD_PX;
  }
}

function messageIdOf(item: Element): string {
  return (
    item.querySelector(`[${MESSAGE_ID_ATTRIBUTE}]`)?.getAttribute(MESSAGE_ID_ATTRIBUTE) ??
    SNOWFLAKE_BEFORE_ALL_OTHERS
  );
}

function createBotBadge(): HTMLSpanElement {
  const badge = document.createElement('span');
  badge.className = 'ml-1 rounded bg-indigo-500 px-1 text-[10px] font-medium uppercase';
  badge.textContent = 'bot';
  return badge;
}

function discardItem(item: Element): void {
  discardedItems.add(item);
  for (const animation of animationsByItem.get(item) ?? []) {
    animation.destroy();
  }
  animationsByItem.delete(item);
}

function createStickerItem(item: Element, sticker: StickerView): HTMLLIElement {
  const stickerItem = document.createElement('li');
  stickerItem.setAttribute(STICKER_ATTRIBUTE, sticker.name);
  if (sticker.kind === StickerKind.Image) {
    stickerItem.append(createStickerImage(sticker.url, sticker.name));
    return stickerItem;
  }
  const container = document.createElement('div');
  container.className = STICKER_SIZE_CLASS;
  stickerItem.append(container);
  void playLottieSticker(item, container, sticker.id, sticker.name);
  return stickerItem;
}

function createStickerImage(url: string, name: string): HTMLImageElement {
  const image = document.createElement('img');
  image.src = url;
  image.alt = stickerLabel(name);
  image.title = stickerLabel(name);
  image.className = STICKER_SIZE_CLASS;
  image.loading = 'lazy';
  image.addEventListener('error', () => image.replaceWith(createStickerName(name)), { once: true });
  return image;
}

async function playLottieSticker(
  item: Element,
  container: HTMLElement,
  stickerId: string,
  name: string,
): Promise<void> {
  let lottie: typeof import('lottie-web/build/player/lottie_light').default;
  try {
    lottie = (await import('lottie-web/build/player/lottie_light')).default;
  } catch {
    container.replaceWith(createStickerName(name));
    return;
  }
  if (discardedItems.has(item)) {
    return;
  }
  const animation = lottie.loadAnimation({
    container,
    renderer: LOTTIE_RENDERER,
    loop: true,
    autoplay: true,
    path: stickerLottiePath(stickerId),
  });
  animation.addEventListener(LOTTIE_LOAD_FAILED_EVENT, () =>
    container.replaceWith(createStickerName(name)),
  );
  animationsByItem.set(item, [...(animationsByItem.get(item) ?? []), animation]);
}

function createStickerName(name: string): HTMLSpanElement {
  const label = document.createElement('span');
  label.className = STICKER_NAME_CLASS;
  label.textContent = stickerLabel(name);
  return label;
}

function stickerLabel(name: string): string {
  return `:${name}:`;
}

function createAttachmentItem(attachment: AttachmentView): HTMLLIElement {
  const item = document.createElement('li');
  const link = document.createElement('a');
  link.href = attachment.url;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  if (attachment.contentType?.startsWith(IMAGE_CONTENT_TYPE_PREFIX)) {
    const image = document.createElement('img');
    image.src = attachment.url;
    image.alt = attachment.name;
    image.className = 'max-h-64 max-w-full rounded';
    link.append(image);
  } else {
    link.className = 'text-sm text-sky-400 underline';
    link.textContent = attachment.name;
  }
  item.append(link);
  return item;
}
