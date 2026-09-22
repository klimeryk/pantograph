import { type Client, type ContainerBuilder, type Message, MessageFlags } from 'discord.js';
import { describeError } from '../errors.ts';
import type { Logger } from '../logging.ts';
import { MILLISECONDS_PER_MINUTE } from '../time.ts';
import { buildIncidentView } from './statusViews.ts';

export const IncidentKind = {
  ChannelInaccessible: 'channel-inaccessible',
  HistoryFetchFailed: 'history-fetch-failed',
  CommandRegistrationFailed: 'command-registration-failed',
} as const;

export type IncidentKind = (typeof IncidentKind)[keyof typeof IncidentKind];

const INCIDENT_TITLES: Record<IncidentKind, string> = {
  'channel-inaccessible': 'Mirrored channel is not accessible',
  'history-fetch-failed': 'Could not load channel history',
  'command-registration-failed': 'Could not register slash commands',
};

const INCIDENT_EDIT_MIN_INTERVAL_MINUTES = 5;
const INCIDENT_EDIT_MIN_INTERVAL_MS = INCIDENT_EDIT_MIN_INTERVAL_MINUTES * MILLISECONDS_PER_MINUTE;
const INCIDENT_ID_SEPARATOR = ':';

export type IncidentScope = {
  guildId: string;
  channelId: string | null;
};

export type IncidentSummary = IncidentScope & {
  kind: IncidentKind;
  title: string;
  detail: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  occurrences: number;
};

type OpenIncident = IncidentSummary & {
  noticeMessage: Message | null;
  noticeUpdatedAt: Date | null;
  noticeChain: Promise<void>;
};

export type IncidentTrackerDependencies = {
  client: Client;
  getNotifyChannelId: (guildId: string) => string | null;
  logger: Logger;
};

export class IncidentTracker {
  readonly #client: Client;
  readonly #getNotifyChannelId: (guildId: string) => string | null;
  readonly #logger: Logger;
  readonly #openIncidents = new Map<string, OpenIncident>();

  constructor(dependencies: IncidentTrackerDependencies) {
    this.#client = dependencies.client;
    this.#getNotifyChannelId = dependencies.getNotifyChannelId;
    this.#logger = dependencies.logger;
  }

  get openIncidents(): IncidentSummary[] {
    return [...this.#openIncidents.values()].map(toSummary);
  }

  openIncidentsIn(guildId: string): IncidentSummary[] {
    return this.openIncidents.filter((incident) => incident.guildId === guildId);
  }

  report(kind: IncidentKind, scope: IncidentScope, detail: string): void {
    const now = new Date();
    const id = incidentId(kind, scope);
    const existing = this.#openIncidents.get(id);
    if (existing) {
      existing.occurrences += 1;
      existing.lastSeenAt = now;
      existing.detail = detail;
      this.#logger.warn({ incident: id, occurrences: existing.occurrences }, detail);
      if (isDue(existing.noticeUpdatedAt, now)) {
        this.#queueNoticeUpdate(existing, null);
      }
      return;
    }
    const incident: OpenIncident = {
      kind,
      guildId: scope.guildId,
      channelId: scope.channelId,
      title: INCIDENT_TITLES[kind],
      detail,
      firstSeenAt: now,
      lastSeenAt: now,
      occurrences: 1,
      noticeMessage: null,
      noticeUpdatedAt: null,
      noticeChain: Promise.resolve(),
    };
    this.#openIncidents.set(id, incident);
    this.#logger.error({ incident: id }, detail);
    this.#queueNoticeUpdate(incident, null);
  }

  resolve(kind: IncidentKind, scope: IncidentScope): void {
    this.#resolveById(incidentId(kind, scope));
  }

  resolveAllForChannel(channelId: string): void {
    for (const [id, incident] of this.#openIncidents) {
      if (incident.channelId === channelId) {
        this.#resolveById(id);
      }
    }
  }

  async postNotice(guildId: string, view: ContainerBuilder): Promise<Message | null> {
    const channelId = this.#getNotifyChannelId(guildId);
    if (channelId === null || !this.#client.isReady()) {
      return null;
    }
    try {
      const channel = await this.#client.channels.fetch(channelId);
      if (channel === null || !channel.isSendable()) {
        this.#logger.warn({ channelId }, 'Notify channel is not a channel the bot can post in');
        return null;
      }
      return await channel.send({ components: [view], flags: [MessageFlags.IsComponentsV2] });
    } catch (error) {
      this.#logger.warn({ channelId, error: describeError(error) }, 'Could not post notice');
      return null;
    }
  }

  #resolveById(id: string): void {
    const incident = this.#openIncidents.get(id);
    if (!incident) {
      return;
    }
    this.#openIncidents.delete(id);
    this.#logger.info({ incident: id, occurrences: incident.occurrences }, 'Incident resolved');
    this.#queueNoticeUpdate(incident, new Date());
  }

  #queueNoticeUpdate(incident: OpenIncident, resolvedAt: Date | null): void {
    incident.noticeChain = incident.noticeChain.then(() =>
      this.#updateNotice(incident, resolvedAt),
    );
  }

  async #updateNotice(incident: OpenIncident, resolvedAt: Date | null): Promise<void> {
    const view = buildIncidentView(toSummary(incident), resolvedAt);
    if (incident.noticeMessage === null) {
      incident.noticeMessage = await this.postNotice(incident.guildId, view);
      incident.noticeUpdatedAt = incident.noticeMessage ? new Date() : null;
      return;
    }
    try {
      await incident.noticeMessage.edit({
        components: [view],
        flags: [MessageFlags.IsComponentsV2],
      });
      incident.noticeUpdatedAt = new Date();
    } catch (error) {
      this.#logger.warn({ error: describeError(error) }, 'Could not update incident notice');
    }
  }
}

function incidentId(kind: IncidentKind, scope: IncidentScope): string {
  return `${kind}${INCIDENT_ID_SEPARATOR}${scope.channelId ?? scope.guildId}`;
}

function isDue(lastUpdatedAt: Date | null, now: Date): boolean {
  return (
    lastUpdatedAt === null ||
    now.getTime() - lastUpdatedAt.getTime() >= INCIDENT_EDIT_MIN_INTERVAL_MS
  );
}

function toSummary(incident: OpenIncident): IncidentSummary {
  return {
    kind: incident.kind,
    guildId: incident.guildId,
    channelId: incident.channelId,
    title: incident.title,
    detail: incident.detail,
    firstSeenAt: incident.firstSeenAt,
    lastSeenAt: incident.lastSeenAt,
    occurrences: incident.occurrences,
  };
}
