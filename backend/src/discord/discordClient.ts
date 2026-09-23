import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { PANTOGRAPH_PRESENCE } from './presence.ts';

export function createDiscordClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ],
    partials: [Partials.Message],
    presence: PANTOGRAPH_PRESENCE,
  });
}
