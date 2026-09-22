import { GatewayCloseCodes } from 'discord.js';

const FATAL_CLOSE_CODE_EXPLANATIONS: ReadonlyMap<number, string> = new Map([
  [
    GatewayCloseCodes.AuthenticationFailed,
    'Discord rejected the bot token. Reset the token in the Developer Portal (Bot tab) and update DISCORD_TOKEN in .env.',
  ],
  [
    GatewayCloseCodes.DisallowedIntents,
    'Discord refused the Message Content intent. Enable "Message Content Intent" under Bot → Privileged Gateway Intents in the Developer Portal, then restart.',
  ],
  [
    GatewayCloseCodes.InvalidIntents,
    'Discord rejected the gateway intents this bot requested; this is a bug in the bot.',
  ],
  [
    GatewayCloseCodes.ShardingRequired,
    'Discord requires sharding for this bot; it is in too many servers for a single connection.',
  ],
  [
    GatewayCloseCodes.InvalidAPIVersion,
    'Discord no longer accepts the gateway version used by this discord.js release; upgrade discord.js.',
  ],
]);

export function explainFatalCloseCode(code: number): string | null {
  return FATAL_CLOSE_CODE_EXPLANATIONS.get(code) ?? null;
}
