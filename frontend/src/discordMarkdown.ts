import type { MentionNames, MentionsView } from '@pantograph/shared';
import { parse } from 'discord-markdown-parser';

const NodeType = {
  Text: 'text',
  Twemoji: 'twemoji',
  LineBreak: 'br',
  Newline: 'newline',
  Strong: 'strong',
  Emphasis: 'em',
  Underline: 'underline',
  Strikethrough: 'strikethrough',
  InlineCode: 'inlineCode',
  CodeBlock: 'codeBlock',
  BlockQuote: 'blockQuote',
  Heading: 'heading',
  Subtext: 'subtext',
  Spoiler: 'spoiler',
  Url: 'url',
  Autolink: 'autolink',
  Link: 'link',
  Emoji: 'emoji',
  Timestamp: 'timestamp',
  Everyone: 'everyone',
  Here: 'here',
  User: 'user',
  Channel: 'channel',
  Role: 'role',
  SlashCommand: 'slashCommand',
  GuildNavigation: 'guildNavigation',
} as const;

type InlineContainerType =
  | typeof NodeType.Strong
  | typeof NodeType.Emphasis
  | typeof NodeType.Underline
  | typeof NodeType.Strikethrough
  | typeof NodeType.Subtext
  | typeof NodeType.Spoiler
  | typeof NodeType.BlockQuote;

type LinkType = typeof NodeType.Url | typeof NodeType.Autolink | typeof NodeType.Link;

export type DiscordMarkdownNode =
  | { type: typeof NodeType.Text; content: string }
  | { type: typeof NodeType.Twemoji; name: string }
  | { type: typeof NodeType.LineBreak }
  | { type: typeof NodeType.Newline }
  | { type: typeof NodeType.InlineCode; content: string }
  | { type: typeof NodeType.CodeBlock; lang: string; content: string }
  | { type: typeof NodeType.Heading; level: number; content: DiscordMarkdownNode[] }
  | { type: InlineContainerType; content: DiscordMarkdownNode[] }
  | { type: LinkType; target: string; content: DiscordMarkdownNode[] }
  | { type: typeof NodeType.Emoji; id: string; name: string; animated: boolean }
  | { type: typeof NodeType.Timestamp; timestamp: string; format: string | undefined }
  | { type: typeof NodeType.Everyone }
  | { type: typeof NodeType.Here }
  | { type: typeof NodeType.User; id: string }
  | { type: typeof NodeType.Channel; id: string }
  | { type: typeof NodeType.Role; id: string }
  | { type: typeof NodeType.SlashCommand; fullName: string; id: string }
  | { type: typeof NodeType.GuildNavigation; id: string; navigation: string };

export type RenderOptions = { extended: boolean; mentions: MentionsView };

const BLOCK_NODE_TYPES: ReadonlySet<string> = new Set([
  NodeType.CodeBlock,
  NodeType.BlockQuote,
  NodeType.Heading,
]);

const INLINE_CONTAINER_TAGS: Record<InlineContainerType, keyof HTMLElementTagNameMap> = {
  strong: 'strong',
  em: 'em',
  underline: 'u',
  strikethrough: 's',
  subtext: 'small',
  spoiler: 'span',
  blockQuote: 'blockquote',
};

const INLINE_CONTAINER_CLASSES: Partial<Record<InlineContainerType, string>> = {
  subtext: 'block text-xs text-neutral-400',
  blockQuote: 'my-1 border-l-4 border-neutral-600 pl-3',
};

const HeadingLevel = { Title: 1, Section: 2, Subsection: 3 } as const;
type HeadingStyle = { tag: keyof HTMLElementTagNameMap; className: string };
const HEADING_STYLES_BY_LEVEL: ReadonlyMap<number, HeadingStyle> = new Map([
  [HeadingLevel.Title, { tag: 'h1', className: 'mt-2 text-2xl font-bold' }],
  [HeadingLevel.Section, { tag: 'h2', className: 'mt-2 text-xl font-bold' }],
  [HeadingLevel.Subsection, { tag: 'h3', className: 'mt-2 text-lg font-bold' }],
]);
const FALLBACK_HEADING_STYLE: HeadingStyle = { tag: 'h3', className: 'mt-2 text-lg font-bold' };

const INLINE_CODE_CLASS = 'rounded bg-neutral-800 px-1 py-0.5 font-mono text-sm';
const CODE_BLOCK_CLASS =
  'my-1 overflow-x-auto rounded border border-neutral-800 bg-neutral-900 p-2 font-mono text-sm';
const LANGUAGE_ATTRIBUTE = 'data-language';

const SPOILER_ATTRIBUTE = 'data-spoiler';
const SPOILER_REVEALED_VALUE = 'revealed';
const SPOILER_HIDDEN_VALUE = 'hidden';
const SPOILER_HIDDEN_CLASS =
  'cursor-pointer select-none rounded bg-neutral-700 text-transparent [&_*]:invisible';
const SPOILER_REVEALED_CLASS = 'rounded bg-neutral-800';
const SPOILER_LABEL = 'Spoiler, activate to reveal';
const REVEAL_KEYS: ReadonlySet<string> = new Set(['Enter', ' ']);

const LINK_CLASS = 'text-sky-400 hover:underline';
const ALLOWED_LINK_PROTOCOLS: ReadonlySet<string> = new Set(['http:', 'https:']);

const EMOJI_CDN_BASE_URL = 'https://cdn.discordapp.com/emojis/';
const EMOJI_IMAGE_SIZE = 32;
const EMOJI_CLASS = 'inline size-5 align-text-bottom';
const ANIMATED_EMOJI_EXTENSION = 'gif';
const STATIC_EMOJI_EXTENSION = 'webp';

const MENTION_CLASS = 'rounded bg-indigo-500/30 px-1 text-indigo-200';
const USER_MENTION_PREFIX = '@';
const CHANNEL_MENTION_PREFIX = '#';
const ROLE_MENTION_PREFIX = '@';
const SLASH_COMMAND_PREFIX = '/';
const EVERYONE_MENTION = '@everyone';
const HERE_MENTION = '@here';
const UNKNOWN_USER_NAME = 'unknown-user';
const UNKNOWN_ROLE_NAME = 'unknown-role';
const UNKNOWN_CHANNEL_NAME = 'unknown-channel';

const MILLISECONDS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const HOURS_PER_DAY = 24;
const DAYS_PER_WEEK = 7;
const DAYS_PER_MONTH = 30;
const DAYS_PER_YEAR = 365;
const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR;
const SECONDS_PER_DAY = SECONDS_PER_HOUR * HOURS_PER_DAY;
const RELATIVE_TIME_UNITS: ReadonlyArray<{ unit: Intl.RelativeTimeFormatUnit; seconds: number }> = [
  { unit: 'year', seconds: SECONDS_PER_DAY * DAYS_PER_YEAR },
  { unit: 'month', seconds: SECONDS_PER_DAY * DAYS_PER_MONTH },
  { unit: 'week', seconds: SECONDS_PER_DAY * DAYS_PER_WEEK },
  { unit: 'day', seconds: SECONDS_PER_DAY },
  { unit: 'hour', seconds: SECONDS_PER_HOUR },
  { unit: 'minute', seconds: SECONDS_PER_MINUTE },
];
const SMALLEST_RELATIVE_TIME_UNIT: Intl.RelativeTimeFormatUnit = 'second';

const TimestampFormat = {
  ShortTime: 't',
  LongTime: 'T',
  ShortDate: 'd',
  LongDate: 'D',
  ShortDateTime: 'f',
  LongDateTime: 'F',
  Relative: 'R',
} as const;
const DEFAULT_TIMESTAMP_FORMAT = TimestampFormat.ShortDateTime;
const defaultTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'long',
  timeStyle: 'short',
});
const TIMESTAMP_FORMATTERS: ReadonlyMap<string, Intl.DateTimeFormat> = new Map([
  [TimestampFormat.ShortTime, new Intl.DateTimeFormat(undefined, { timeStyle: 'short' })],
  [TimestampFormat.LongTime, new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' })],
  [TimestampFormat.ShortDate, new Intl.DateTimeFormat(undefined, { dateStyle: 'short' })],
  [TimestampFormat.LongDate, new Intl.DateTimeFormat(undefined, { dateStyle: 'long' })],
  [TimestampFormat.ShortDateTime, defaultTimestampFormatter],
  [
    TimestampFormat.LongDateTime,
    new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' }),
  ],
]);
const fullTimestampFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'full',
  timeStyle: 'long',
});
const relativeTimeFormatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const TIMESTAMP_CLASS = 'rounded bg-neutral-800 px-1';

export function renderDiscordMarkdown(content: string, options: RenderOptions): DocumentFragment {
  const nodes = parse(content, options.extended ? 'extended' : 'normal') as DiscordMarkdownNode[];
  return renderNodes(nodes, options.mentions);
}

function renderNodes(nodes: DiscordMarkdownNode[], mentions: MentionsView): DocumentFragment {
  const fragment = document.createDocumentFragment();
  let previousWasBlock = false;
  for (const node of nodes) {
    const isLineBreak = node.type === NodeType.LineBreak || node.type === NodeType.Newline;
    if (!(previousWasBlock && isLineBreak)) {
      fragment.append(renderNode(node, mentions));
    }
    previousWasBlock = BLOCK_NODE_TYPES.has(node.type);
  }
  return fragment;
}

function renderNode(node: DiscordMarkdownNode, mentions: MentionsView): Node {
  switch (node.type) {
    case NodeType.Text:
      return document.createTextNode(node.content);
    case NodeType.Twemoji:
      return document.createTextNode(node.name);
    case NodeType.LineBreak:
    case NodeType.Newline:
      return document.createElement('br');
    case NodeType.InlineCode:
      return createElement('code', INLINE_CODE_CLASS, node.content);
    case NodeType.CodeBlock:
      return createCodeBlock(node.lang, node.content);
    case NodeType.Heading:
      return createHeading(node.level, node.content, mentions);
    case NodeType.Spoiler:
      return createSpoiler(node.content, mentions);
    case NodeType.Strong:
    case NodeType.Emphasis:
    case NodeType.Underline:
    case NodeType.Strikethrough:
    case NodeType.Subtext:
    case NodeType.BlockQuote:
      return createContainer(node.type, node.content, mentions);
    case NodeType.Url:
    case NodeType.Autolink:
    case NodeType.Link:
      return createLink(node.target, node.content, mentions);
    case NodeType.Emoji:
      return createCustomEmoji(node.id, node.name, node.animated);
    case NodeType.Timestamp:
      return createTimestamp(node.timestamp, node.format ?? DEFAULT_TIMESTAMP_FORMAT);
    case NodeType.Everyone:
      return createMention(EVERYONE_MENTION);
    case NodeType.Here:
      return createMention(HERE_MENTION);
    case NodeType.User:
      return createMention(
        `${USER_MENTION_PREFIX}${nameFor(mentions.users, node.id, UNKNOWN_USER_NAME)}`,
      );
    case NodeType.Channel:
      return createMention(
        `${CHANNEL_MENTION_PREFIX}${nameFor(mentions.channels, node.id, UNKNOWN_CHANNEL_NAME)}`,
      );
    case NodeType.Role:
      return createMention(
        `${ROLE_MENTION_PREFIX}${nameFor(mentions.roles, node.id, UNKNOWN_ROLE_NAME)}`,
      );
    case NodeType.SlashCommand:
      return createMention(`${SLASH_COMMAND_PREFIX}${node.fullName}`);
    case NodeType.GuildNavigation:
      return createMention(`${CHANNEL_MENTION_PREFIX}${node.navigation}`);
    default:
      return renderUnknownNode(node, mentions);
  }
}

function nameFor(names: MentionNames, id: string, fallback: string): string {
  return names[id] ?? fallback;
}

function renderUnknownNode(node: never, mentions: MentionsView): Node {
  const candidate: { content?: unknown } = node;
  if (typeof candidate.content === 'string') {
    return document.createTextNode(candidate.content);
  }
  if (Array.isArray(candidate.content)) {
    return renderNodes(candidate.content as DiscordMarkdownNode[], mentions);
  }
  return document.createDocumentFragment();
}

function createElement<TagName extends keyof HTMLElementTagNameMap>(
  tagName: TagName,
  className: string | null,
  content: string | DocumentFragment,
): HTMLElementTagNameMap[TagName] {
  const element = document.createElement(tagName);
  if (className !== null) {
    element.className = className;
  }
  element.append(content);
  return element;
}

function createContainer(
  type: InlineContainerType,
  children: DiscordMarkdownNode[],
  mentions: MentionsView,
): HTMLElement {
  return createElement(
    INLINE_CONTAINER_TAGS[type],
    INLINE_CONTAINER_CLASSES[type] ?? null,
    renderNodes(children, mentions),
  );
}

function createHeading(
  level: number,
  children: DiscordMarkdownNode[],
  mentions: MentionsView,
): HTMLElement {
  const style = HEADING_STYLES_BY_LEVEL.get(level) ?? FALLBACK_HEADING_STYLE;
  return createElement(style.tag, style.className, renderNodes(children, mentions));
}

function createCodeBlock(language: string, code: string): HTMLPreElement {
  const codeElement = createElement('code', null, code);
  if (language.length > 0) {
    codeElement.setAttribute(LANGUAGE_ATTRIBUTE, language);
  }
  const pre = document.createElement('pre');
  pre.className = CODE_BLOCK_CLASS;
  pre.append(codeElement);
  return pre;
}

function createSpoiler(children: DiscordMarkdownNode[], mentions: MentionsView): HTMLSpanElement {
  const spoiler = createElement('span', SPOILER_HIDDEN_CLASS, renderNodes(children, mentions));
  spoiler.setAttribute(SPOILER_ATTRIBUTE, SPOILER_HIDDEN_VALUE);
  spoiler.setAttribute('role', 'button');
  spoiler.setAttribute('aria-label', SPOILER_LABEL);
  spoiler.tabIndex = 0;
  const reveal = (): void => {
    spoiler.className = SPOILER_REVEALED_CLASS;
    spoiler.setAttribute(SPOILER_ATTRIBUTE, SPOILER_REVEALED_VALUE);
    spoiler.removeAttribute('role');
    spoiler.removeAttribute('aria-label');
    spoiler.removeAttribute('tabindex');
  };
  spoiler.addEventListener('click', reveal, { once: true });
  spoiler.addEventListener('keydown', (event) => {
    if (REVEAL_KEYS.has(event.key)) {
      event.preventDefault();
      reveal();
    }
  });
  return spoiler;
}

function createLink(target: string, children: DiscordMarkdownNode[], mentions: MentionsView): Node {
  const href = toSafeHref(target);
  if (href === null) {
    return renderNodes(children, mentions);
  }
  const link = createElement('a', LINK_CLASS, renderNodes(children, mentions));
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  return link;
}

function toSafeHref(target: string): string | null {
  try {
    const url = new URL(target);
    return ALLOWED_LINK_PROTOCOLS.has(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function createCustomEmoji(id: string, name: string, animated: boolean): HTMLImageElement {
  const extension = animated ? ANIMATED_EMOJI_EXTENSION : STATIC_EMOJI_EXTENSION;
  const image = document.createElement('img');
  image.src = `${EMOJI_CDN_BASE_URL}${id}.${extension}?size=${EMOJI_IMAGE_SIZE}`;
  image.alt = `:${name}:`;
  image.title = `:${name}:`;
  image.className = EMOJI_CLASS;
  image.loading = 'lazy';
  return image;
}

function createTimestamp(unixSeconds: string, format: string): HTMLTimeElement {
  const date = new Date(Number(unixSeconds) * MILLISECONDS_PER_SECOND);
  const time = document.createElement('time');
  time.className = TIMESTAMP_CLASS;
  if (Number.isNaN(date.getTime())) {
    time.textContent = unixSeconds;
    return time;
  }
  time.dateTime = date.toISOString();
  time.title = fullTimestampFormatter.format(date);
  time.textContent = formatTimestamp(date, format);
  return time;
}

function formatTimestamp(date: Date, format: string): string {
  if (format === TimestampFormat.Relative) {
    return formatRelativeTime(date);
  }
  const formatter = TIMESTAMP_FORMATTERS.get(format) ?? defaultTimestampFormatter;
  return formatter.format(date);
}

function formatRelativeTime(date: Date): string {
  const elapsedSeconds = (date.getTime() - Date.now()) / MILLISECONDS_PER_SECOND;
  const magnitude = Math.abs(elapsedSeconds);
  const matchingUnit = RELATIVE_TIME_UNITS.find((candidate) => magnitude >= candidate.seconds);
  if (matchingUnit === undefined) {
    return relativeTimeFormatter.format(Math.round(elapsedSeconds), SMALLEST_RELATIVE_TIME_UNIT);
  }
  return relativeTimeFormatter.format(
    Math.round(elapsedSeconds / matchingUnit.seconds),
    matchingUnit.unit,
  );
}

function createMention(label: string): HTMLSpanElement {
  return createElement('span', MENTION_CLASS, label);
}
