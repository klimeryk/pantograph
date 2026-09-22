import { ActivityType, type Client, type PresenceStatusData } from 'discord.js';

const STATUS_ACTIVE: PresenceStatusData = 'online';
const STATUS_PAUSED: PresenceStatusData = 'idle';
const ACTIVITY_PAUSED = 'paused';
const ACTIVITY_UNCONFIGURED = 'nothing yet · /pantograph watch';

export type PresenceState = {
  watchedCount: number;
  pausedCount: number;
  singleChannelName: string | null;
};

export function applyPresence(client: Client<true>, state: PresenceState): void {
  const allPaused = state.watchedCount > 0 && state.pausedCount === state.watchedCount;
  client.user.setPresence({
    status: allPaused ? STATUS_PAUSED : STATUS_ACTIVE,
    activities: [{ type: ActivityType.Watching, name: describeActivity(state) }],
  });
}

function describeActivity(state: PresenceState): string {
  if (state.watchedCount === 0) {
    return ACTIVITY_UNCONFIGURED;
  }
  if (state.watchedCount === 1) {
    const name = state.singleChannelName === null ? '1 channel' : `#${state.singleChannelName}`;
    return state.pausedCount === 1 ? `${name} (${ACTIVITY_PAUSED})` : name;
  }
  const summary = `${state.watchedCount} channels`;
  return state.pausedCount > 0 ? `${summary} (${state.pausedCount} ${ACTIVITY_PAUSED})` : summary;
}
