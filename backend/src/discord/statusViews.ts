import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  bold,
  ContainerBuilder,
  channelMention,
  HeadingLevel,
  heading,
  hideLinkEmbed,
  inlineCode,
  SeparatorSpacingSize,
  subtext,
  TimestampStyles,
  time,
} from 'discord.js';
import type { IncidentSummary } from './incidentTracker.ts';

const ACCENT_COLOR_SUCCESS = 0x57f287;
const ACCENT_COLOR_ERROR = 0xed4245;
const ACCENT_COLOR_WARNING = 0xfee75c;
const ACCENT_COLOR_INFO = 0x5865f2;
const CHANNELS_PER_STATUS_PAGE = 10;
const PREVIOUS_PAGE_LABEL = '◀ Prev';
const NEXT_PAGE_LABEL = 'Next ▶';

export const FIRST_STATUS_PAGE = 0;
export const STATUS_PAGE_BUTTON_PREFIX = 'pantograph:status:page:';

export const NoticeTone = {
  Success: 'success',
  Error: 'error',
  Warning: 'warning',
  Info: 'info',
} as const;

export type NoticeTone = (typeof NoticeTone)[keyof typeof NoticeTone];

const ACCENT_COLORS: Record<NoticeTone, number> = {
  success: ACCENT_COLOR_SUCCESS,
  error: ACCENT_COLOR_ERROR,
  warning: ACCENT_COLOR_WARNING,
  info: ACCENT_COLOR_INFO,
};

export const LINK_SHARING_HINT =
  'Anyone with this link can read the mirrored messages. Share it deliberately.';

export type ChannelStatus = {
  id: string;
  name: string | null;
  paused: boolean;
  link: string;
  viewers: number;
  buffered: number;
  lastEventAt: Date | null;
};

export type StatusReport = {
  notifyChannelId: string | null;
  gatewayPingMs: number | null;
  startedAt: Date;
  channels: ChannelStatus[];
  openIncidents: readonly IncidentSummary[];
};

export function buildNotice(
  tone: NoticeTone,
  title: string,
  lines: readonly string[],
): ContainerBuilder {
  const container = new ContainerBuilder()
    .setAccentColor(ACCENT_COLORS[tone])
    .addTextDisplayComponents((text) => text.setContent(heading(title, HeadingLevel.Three)));
  if (lines.length > 0) {
    container.addTextDisplayComponents((text) => text.setContent(lines.join('\n')));
  }
  return container;
}

export function buildLinkNotice(
  tone: NoticeTone,
  title: string,
  channelId: string,
  link: string,
  extraLines: readonly string[],
): ContainerBuilder {
  return buildNotice(tone, title, [
    `${channelMention(channelId)} is mirrored at ${mirrorLink(link)}`,
    ...extraLines,
    subtext(LINK_SHARING_HINT),
  ]);
}

export function buildStatusView(report: StatusReport, requestedPage: number): ContainerBuilder {
  const notifyLine = report.notifyChannelId
    ? `${bold('Notices:')} ${channelMention(report.notifyChannelId)}`
    : `${bold('Notices:')} logs only · use ${inlineCode('/pantograph notify')}`;
  const container = new ContainerBuilder()
    .setAccentColor(report.openIncidents.length > 0 ? ACCENT_COLOR_WARNING : ACCENT_COLOR_INFO)
    .addTextDisplayComponents((text) => text.setContent(heading('Pantograph', HeadingLevel.Two)))
    .addTextDisplayComponents((text) =>
      text.setContent(
        [
          notifyLine,
          `${bold('Gateway ping:')} ${report.gatewayPingMs === null ? 'n/a' : `${report.gatewayPingMs} ms`}`,
          `${bold('Running since:')} ${time(report.startedAt, TimestampStyles.RelativeTime)}`,
        ].join('\n'),
      ),
    );

  if (report.channels.length === 0) {
    container
      .addSeparatorComponents((separator) => separator.setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents((text) =>
        text.setContent(`No channel is mirrored yet · use ${inlineCode('/pantograph watch')}`),
      );
  }
  const pageCount = Math.max(1, Math.ceil(report.channels.length / CHANNELS_PER_STATUS_PAGE));
  const page = Math.min(Math.max(requestedPage, FIRST_STATUS_PAGE), pageCount - 1);
  const pageStart = page * CHANNELS_PER_STATUS_PAGE;
  for (const channel of report.channels.slice(pageStart, pageStart + CHANNELS_PER_STATUS_PAGE)) {
    container
      .addSeparatorComponents((separator) => separator.setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents((text) => text.setContent(describeChannel(channel)));
  }

  if (report.openIncidents.length > 0) {
    container
      .addSeparatorComponents((separator) => separator.setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents((text) =>
        text.setContent(
          [
            heading('Open incidents', HeadingLevel.Three),
            ...report.openIncidents.map(
              (incident) =>
                `⚠️ ${bold(incident.title)} · ${incident.occurrences}× since ${time(incident.firstSeenAt, TimestampStyles.RelativeTime)}\n${subtext(incident.detail)}`,
            ),
          ].join('\n'),
        ),
      );
  }

  if (pageCount > 1) {
    container
      .addSeparatorComponents((separator) => separator.setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents((text) =>
        text.setContent(
          subtext(`Page ${page + 1} of ${pageCount} · ${report.channels.length} channels`),
        ),
      )
      .addActionRowComponents(buildPageButtons(page, pageCount));
  }
  return container;
}

function buildPageButtons(page: number, pageCount: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${STATUS_PAGE_BUTTON_PREFIX}${page - 1}`)
      .setLabel(PREVIOUS_PAGE_LABEL)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === FIRST_STATUS_PAGE),
    new ButtonBuilder()
      .setCustomId(`${STATUS_PAGE_BUTTON_PREFIX}${page + 1}`)
      .setLabel(NEXT_PAGE_LABEL)
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(page === pageCount - 1),
  );
}

export function buildIncidentView(
  incident: IncidentSummary,
  resolvedAt: Date | null,
): ContainerBuilder {
  const where =
    incident.channelId === null ? [] : [`Channel: ${channelMention(incident.channelId)}`];
  if (resolvedAt !== null) {
    return buildNotice(NoticeTone.Success, `Resolved: ${incident.title}`, [
      ...where,
      `Failed ${incident.occurrences}× between ${time(incident.firstSeenAt, TimestampStyles.ShortTime)} and ${time(resolvedAt, TimestampStyles.ShortTime)}.`,
      subtext(`Last error: ${incident.detail}`),
    ]);
  }
  const occurrenceLine =
    incident.occurrences === 1
      ? `First seen ${time(incident.firstSeenAt, TimestampStyles.RelativeTime)}.`
      : `Still failing · ${incident.occurrences}× since ${time(incident.firstSeenAt, TimestampStyles.RelativeTime)} · last ${time(incident.lastSeenAt, TimestampStyles.RelativeTime)}.`;
  return buildNotice(NoticeTone.Error, incident.title, [
    ...where,
    incident.detail,
    subtext(`${occurrenceLine} This message is updated in place instead of posting again.`),
  ]);
}

function mirrorLink(link: string): string {
  return hideLinkEmbed(link);
}

function describeChannel(channel: ChannelStatus): string {
  const state = channel.paused ? '⏸️ paused' : '▶️ running';
  const lastEvent = channel.lastEventAt
    ? time(channel.lastEventAt, TimestampStyles.RelativeTime)
    : 'none yet';
  return [
    `${bold(channelMention(channel.id))} · ${state}`,
    `${bold('Link:')} ${mirrorLink(channel.link)}`,
    `${bold('Viewers:')} ${channel.viewers} · ${bold('Buffered:')} ${channel.buffered} · ${bold('Last event:')} ${lastEvent}`,
  ].join('\n');
}
