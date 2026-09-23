import type { MessageView } from '@pantograph/shared';
import { renderDiscordMarkdown } from './discordMarkdown.ts';
import { requireElement } from './dom.ts';

const MAX_ANNOUNCEMENT_LINES = 20;
const MAX_ANNOUNCED_CHARACTERS = 140;
const TRUNCATION_MARKER = '…';
const SPOILER_PLACEHOLDER = 'spoiler';
const WHITESPACE_RUN = /\s+/g;
const PART_SEPARATOR = ', ';

export class ArrivalAnnouncer {
  readonly #region: HTMLElement;

  constructor(root: ParentNode) {
    this.#region = requireElement(root, '[data-announcer]');
  }

  announce(message: MessageView): void {
    const line = document.createElement('p');
    line.textContent = describeArrival(message);
    this.#region.append(line);
    while (this.#region.childElementCount > MAX_ANNOUNCEMENT_LINES) {
      this.#region.firstElementChild?.remove();
    }
  }
}

export function describeArrival(message: MessageView): string {
  const parts = [
    spokenContent(message),
    ...message.stickers.map((sticker) => `sticker :${sticker.name}:`),
    attachmentSummary(message.attachments.length),
  ].filter((part) => part.length > 0);
  const author = message.author.displayName;
  return parts.length === 0
    ? `${author} posted a message`
    : `${author}: ${parts.join(PART_SEPARATOR)}`;
}

function spokenContent(message: MessageView): string {
  const container = document.createElement('div');
  container.append(
    renderDiscordMarkdown(message.content, {
      extended: message.author.isBot,
      mentions: message.mentions,
    }),
  );
  for (const spoiler of container.querySelectorAll('[data-spoiler]')) {
    spoiler.replaceWith(SPOILER_PLACEHOLDER);
  }
  for (const image of container.querySelectorAll('img')) {
    image.replaceWith(image.alt);
  }
  const text = (container.textContent ?? '').replace(WHITESPACE_RUN, ' ').trim();
  return text.length > MAX_ANNOUNCED_CHARACTERS
    ? `${text.slice(0, MAX_ANNOUNCED_CHARACTERS).trimEnd()}${TRUNCATION_MARKER}`
    : text;
}

function attachmentSummary(count: number): string {
  if (count === 0) {
    return '';
  }
  return count === 1 ? 'with an attachment' : `with ${count} attachments`;
}
