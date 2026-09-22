import {
  bold,
  ContainerBuilder,
  channelMention,
  HeadingLevel,
  heading,
  hyperlink,
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
const MAX_CHANNELS_IN_STATUS = 10;

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
    `${channelMention(channelId)} is mirrored at ${hyperlink(link, link)}`,
    ...extraLines,
    subtext(LINK_SHARING_HINT),
  ]);
}

export function buildStatusView(report: StatusReport): ContainerBuilder {
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
  for (const channel of report.channels.slice(0, MAX_CHANNELS_IN_STATUS)) {
    container
      .addSeparatorComponents((separator) => separator.setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents((text) => text.setContent(describeChannel(channel)));
  }
  const hiddenCount = report.channels.length - MAX_CHANNELS_IN_STATUS;
  if (hiddenCount > 0) {
    container.addTextDisplayComponents((text) =>
      text.setContent(
        subtext(
          `and ${hiddenCount} more · use ${inlineCode('/pantograph status channel:')} for one channel`,
        ),
      ),
    );
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
  return container;
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

function describeChannel(channel: ChannelStatus): string {
  const state = channel.paused ? '⏸️ paused' : '▶️ running';
  const lastEvent = channel.lastEventAt
    ? time(channel.lastEventAt, TimestampStyles.RelativeTime)
    : 'none yet';
  return [
    `${bold(channelMention(channel.id))} · ${state}`,
    `${bold('Link:')} ${hyperlink(channel.link, channel.link)}`,
    `${bold('Viewers:')} ${channel.viewers} · ${bold('Buffered:')} ${channel.buffered} · ${bold('Last event:')} ${lastEvent}`,
  ].join('\n');
}
