import { createHash } from 'node:crypto';
import type { Guild, RESTPostAPIChatInputApplicationCommandsJSONBody } from 'discord.js';
import { describeError } from '../../errors.ts';
import type { Logger } from '../../logging.ts';
import type { BotStateStore } from '../../state/botState.ts';
import { IncidentKind, type IncidentTracker } from '../incidentTracker.ts';

export type CommandRegistrationDependencies = {
  commandJson: RESTPostAPIChatInputApplicationCommandsJSONBody;
  state: BotStateStore;
  incidents: IncidentTracker;
  logger: Logger;
};

export async function ensureCommandsRegistered(
  guild: Guild,
  dependencies: CommandRegistrationDependencies,
  options: { force: boolean },
): Promise<void> {
  const { commandJson, state, incidents, logger } = dependencies;
  const hash = hashCommand(commandJson);
  if (!options.force && state.registeredCommandHash(guild.id) === hash) {
    return;
  }
  const scope = { guildId: guild.id, channelId: null };
  try {
    await guild.commands.set([commandJson]);
    await state.setRegisteredCommandHash(guild.id, hash);
    incidents.resolve(IncidentKind.CommandRegistrationFailed, scope);
    logger.info({ guild: guild.name }, 'Registered slash commands');
  } catch (error) {
    incidents.report(
      IncidentKind.CommandRegistrationFailed,
      scope,
      `Registering /${commandJson.name} in ${guild.name} failed: ${describeError(error)}`,
    );
  }
}

function hashCommand(commandJson: RESTPostAPIChatInputApplicationCommandsJSONBody): string {
  return createHash('sha256').update(JSON.stringify(commandJson)).digest('hex');
}
