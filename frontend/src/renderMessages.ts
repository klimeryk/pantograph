import {
  type AttachmentView,
  compareSnowflakes,
  type MessageView,
  StickerKind,
  type StickerView,
} from '@pantograph/shared';
import { renderDiscordMarkdown } from './discordMarkdown.ts';
import { requireElement } from './dom.ts';
import { LottieStickerPlayer } from './lottieStickers.ts';
import type { MessageStore, StoreChange } from './messageStore.ts';
import { prefersReducedMotion } from './motion.ts';

const NEAR_BOTTOM_THRESHOLD_PX = 80;
const IMAGE_CONTENT_TYPE_PREFIX = 'image/';
const MESSAGE_ID_ATTRIBUTE = 'data-message-id';
const SNOWFLAKE_BEFORE_ALL_OTHERS = '0';
const STICKER_ATTRIBUTE = 'data-sticker';
const STICKER_SIZE_CLASS = 'size-32';
const STICKER_NAME_CLASS = 'rounded bg-neutral-800 px-1 text-sm text-neutral-400';
const MESSAGE_DAY_CLASS = 'text-neutral-500';
const ARRIVAL_DURATION_MS = 700;
const ARRIVAL_EASING = 'cubic-bezier(0.16, 1, 0.3, 1)';
const ARRIVAL_KEYFRAMES: Keyframe[] = [
  { transform: 'translateX(3rem)', opacity: 0 },
  { transform: 'none', opacity: 1 },
];
const DEPARTURE_DURATION_MS = 400;
const DEPARTURE_EASING = 'cubic-bezier(0.7, 0, 0.84, 0)';
const DEPARTURE_KEYFRAMES: Keyframe[] = [
  { transform: 'none', opacity: 1 },
  { transform: 'translateX(-3rem)', opacity: 0 },
];

type RenderedMessage = {
  item: HTMLLIElement;
  message: MessageView;
};

const clockFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const dayFormatter = new Intl.DateTimeFormat(undefined, { day: '2-digit', month: '2-digit' });
const fullDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export class MessageListRenderer {
  readonly #scroller: HTMLElement;
  readonly #list: HTMLOListElement;
  readonly #emptyState: HTMLElement;
  readonly #template: HTMLTemplateElement;
  readonly #approaching: HTMLButtonElement;
  readonly #approachingCount: HTMLElement;
  readonly #store: MessageStore;
  readonly #stickers: LottieStickerPlayer;
  readonly #renderedById = new Map<string, RenderedMessage>();
  #approachingMessages = 0;

  constructor(root: ParentNode, store: MessageStore) {
    this.#scroller = requireElement(root, '[data-message-scroller]');
    this.#list = requireElement<HTMLOListElement>(root, '[data-message-list]');
    this.#emptyState = requireElement(root, '[data-empty-state]');
    this.#template = requireElement<HTMLTemplateElement>(root, '[data-message-template]');
    this.#approaching = requireElement<HTMLButtonElement>(root, '[data-approaching]');
    this.#approachingCount = requireElement(root, '[data-approaching-count]');
    this.#store = store;
    this.#stickers = new LottieStickerPlayer(this.#scroller);
    this.#scroller.addEventListener('scroll', () => {
      if (this.#isNearBottom()) {
        this.#clearApproaching();
      }
    });
    this.#approaching.addEventListener('click', () => {
      this.#clearApproaching();
      this.#scrollToBottom(true);
    });
  }

  applyChange(change: StoreChange): MessageView | null {
    const wasNearBottom = this.#isNearBottom();
    let arrival: MessageView | null = null;
    switch (change.kind) {
      case 'reset':
        this.#renderAll();
        break;
      case 'upsert':
        arrival = this.#upsert(change.message);
        for (const id of change.evictedIds) {
          this.#removeItem(id, false);
        }
        break;
      case 'remove':
        for (const id of change.ids) {
          this.#removeItem(id, true);
        }
        break;
      case 'syncState':
      case 'none':
        break;
    }
    this.#emptyState.hidden = this.#list.childElementCount > 0;
    if (wasNearBottom || change.kind === 'reset') {
      this.#scrollToBottom(false);
    } else if (arrival !== null) {
      this.#announceApproaching();
    }
    return arrival;
  }

  #renderAll(): void {
    for (const existing of this.#list.children) {
      this.#stickers.discard(existing);
    }
    this.#renderedById.clear();
    this.#list.replaceChildren(
      ...this.#store.messagesOldestFirst.map((message) => this.#createItem(message)),
    );
    this.#clearApproaching();
  }

  #removeItem(messageId: string, animated: boolean): void {
    const rendered = this.#renderedById.get(messageId);
    if (rendered === undefined) {
      return;
    }
    this.#renderedById.delete(messageId);
    const { item } = rendered;
    this.#stickers.discard(item);
    if (!animated || prefersReducedMotion()) {
      item.remove();
      return;
    }
    requireElement(item, `[${MESSAGE_ID_ATTRIBUTE}]`).removeAttribute(MESSAGE_ID_ATTRIBUTE);
    const departure = item.animate(DEPARTURE_KEYFRAMES, {
      duration: DEPARTURE_DURATION_MS,
      easing: DEPARTURE_EASING,
      fill: 'forwards',
    });
    departure.finished.then(
      () => item.remove(),
      () => item.remove(),
    );
  }

  #upsert(message: MessageView): MessageView | null {
    const existing = this.#renderedById.get(message.id);
    if (existing !== undefined) {
      patchItem(existing.item, existing.message, message);
      existing.message = message;
      return null;
    }
    const item = this.#createItem(message);
    this.#list.insertBefore(item, this.#itemAfter(message.id));
    if (!prefersReducedMotion()) {
      item.animate(ARRIVAL_KEYFRAMES, { duration: ARRIVAL_DURATION_MS, easing: ARRIVAL_EASING });
    }
    return message;
  }

  #itemAfter(messageId: string): Element | null {
    const last = this.#list.lastElementChild;
    if (last === null || compareSnowflakes(messageIdOf(last), messageId) < 0) {
      return null;
    }
    return (
      [...this.#list.children].find(
        (candidate) => compareSnowflakes(messageIdOf(candidate), messageId) > 0,
      ) ?? null
    );
  }

  #createItem(message: MessageView): HTMLLIElement {
    const fragment = this.#template.content.cloneNode(true) as DocumentFragment;
    const item = requireElement<HTMLLIElement>(fragment, 'li');
    requireElement(item, 'article').setAttribute(MESSAGE_ID_ATTRIBUTE, message.id);
    fillAuthor(item, message);

    const created = requireElement<HTMLTimeElement>(item, '[data-created]');
    const createdAt = new Date(message.createdAt);
    created.dateTime = message.createdAt;
    created.title = fullDateFormatter.format(createdAt);
    created.replaceChildren(...createTimetableTime(createdAt));

    fillEdited(item, message);
    fillContent(item, message);

    const stickers = requireElement<HTMLUListElement>(item, '[data-stickers]');
    stickers.replaceChildren(
      ...message.stickers.map((sticker) => createStickerItem(this.#stickers, item, sticker)),
    );
    stickers.hidden = message.stickers.length === 0;

    fillAttachments(item, message);
    this.#renderedById.set(message.id, { item, message });
    return item;
  }

  #isNearBottom(): boolean {
    const distanceFromBottom =
      this.#scroller.scrollHeight - this.#scroller.scrollTop - this.#scroller.clientHeight;
    return distanceFromBottom < NEAR_BOTTOM_THRESHOLD_PX;
  }

  #scrollToBottom(smooth: boolean): void {
    this.#scroller.scrollTo({
      top: this.#scroller.scrollHeight,
      behavior: smooth && !prefersReducedMotion() ? 'smooth' : 'auto',
    });
  }

  #announceApproaching(): void {
    this.#approachingMessages += 1;
    this.#approachingCount.textContent = String(this.#approachingMessages);
    this.#approaching.hidden = false;
  }

  #clearApproaching(): void {
    this.#approachingMessages = 0;
    this.#approaching.hidden = true;
  }
}

function patchItem(item: Element, previous: MessageView, next: MessageView): void {
  if (!sameJson(previous.author, next.author)) {
    fillAuthor(item, next);
  }
  if (previous.editedAt !== next.editedAt) {
    fillEdited(item, next);
  }
  if (previous.content !== next.content || !sameJson(previous.mentions, next.mentions)) {
    fillContent(item, next);
  }
  if (!sameJson(previous.attachments, next.attachments)) {
    fillAttachments(item, next);
  }
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function fillAuthor(item: Element, message: MessageView): void {
  requireElement<HTMLImageElement>(item, '[data-avatar]').src = message.author.avatarUrl;
  const author = requireElement(item, '[data-author]');
  author.textContent = message.author.displayName;
  if (message.author.isBot) {
    author.append(createBotBadge());
  }
}

function fillEdited(item: Element, message: MessageView): void {
  requireElement(item, '[data-edited]').hidden = message.editedAt === null;
}

function fillContent(item: Element, message: MessageView): void {
  requireElement(item, '[data-content]').replaceChildren(
    renderDiscordMarkdown(message.content, {
      extended: message.author.isBot,
      mentions: message.mentions,
    }),
  );
}

function fillAttachments(item: Element, message: MessageView): void {
  const attachments = requireElement<HTMLUListElement>(item, '[data-attachments]');
  attachments.replaceChildren(...message.attachments.map(createAttachmentItem));
  attachments.hidden = message.attachments.length === 0;
}

function messageIdOf(item: Element): string {
  return (
    item.querySelector(`[${MESSAGE_ID_ATTRIBUTE}]`)?.getAttribute(MESSAGE_ID_ATTRIBUTE) ??
    SNOWFLAKE_BEFORE_ALL_OTHERS
  );
}

function createTimetableTime(createdAt: Date): HTMLSpanElement[] {
  const clock = document.createElement('span');
  clock.textContent = clockFormatter.format(createdAt);
  if (isSameDay(createdAt, new Date())) {
    return [clock];
  }
  const day = document.createElement('span');
  day.className = MESSAGE_DAY_CLASS;
  day.textContent = dayFormatter.format(createdAt);
  return [clock, day];
}

function isSameDay(left: Date, right: Date): boolean {
  return left.toDateString() === right.toDateString();
}

function createBotBadge(): HTMLSpanElement {
  const badge = document.createElement('span');
  badge.className = 'ml-1 rounded bg-indigo-500 px-1 text-[10px] font-medium uppercase';
  badge.textContent = 'bot';
  return badge;
}

function createStickerItem(
  player: LottieStickerPlayer,
  item: Element,
  sticker: StickerView,
): HTMLLIElement {
  const stickerItem = document.createElement('li');
  stickerItem.setAttribute(STICKER_ATTRIBUTE, sticker.name);
  if (sticker.kind === StickerKind.Image) {
    stickerItem.append(createStickerImage(sticker.url, sticker.name));
    return stickerItem;
  }
  const container = document.createElement('div');
  container.className = STICKER_SIZE_CLASS;
  container.setAttribute('role', 'img');
  container.setAttribute('aria-label', stickerLabel(sticker.name));
  stickerItem.append(container);
  player.mount(item, stickerItem, container, sticker.id, () =>
    container.replaceWith(createStickerName(sticker.name)),
  );
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
