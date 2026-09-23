import { ActivityType, type PresenceData } from 'discord.js';

const ACTIVITY_NAME = 'the departure board';

export const PANTOGRAPH_PRESENCE: PresenceData = {
  status: 'online',
  activities: [{ type: ActivityType.Watching, name: ACTIVITY_NAME }],
};
