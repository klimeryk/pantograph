import {
  type ChatInputCommandInteraction,
  type ContainerBuilder,
  channelMention,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type SlashCommandSubcommandBuilder,
  type SlashCommandSubcommandsOnlyBuilder,
} from 'discord.js';
import { describeError } from '../../errors.ts';
import type { Logger } from '../../logging.ts';
import {
  buildLinkNotice,
  buildNotice,
  buildStatusView,
  NoticeTone,
  type StatusReport,
} from '../statusViews.ts';
import type { BulkResult, SyncController } from '../syncController.ts';
import { WATCHABLE_CHANNEL_TYPES } from '../watchedChannel.ts';

export const PANTOGRAPH_COMMAND_NAME = 'pantograph';

const Subcommand = {
  Status: 'status',
  Watch: 'watch',
  Unwatch: 'unwatch',
  Pause: 'pause',
  Resume: 'resume',
  Rotate: 'rotate',
  Notify: 'notify',
} as const;

const CHANNEL_OPTION = 'channel';

export function buildPantographCommand(): SlashCommandSubcommandsOnlyBuilder {
  return new SlashCommandBuilder()
    .setName(PANTOGRAPH_COMMAND_NAME)
    .setDescription('Mirror channels of this server to web pages')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((subcommand) =>
      withChannelOption(
        subcommand
          .setName(Subcommand.Status)
          .setDescription('Show mirrored channels, their links and how healthy they are'),
        { required: false, description: 'Only show this channel' },
      ),
    )
    .addSubcommand((subcommand) =>
      withChannelOption(
        subcommand.setName(Subcommand.Watch).setDescription('Mirror a channel and get its link'),
        { required: true, description: 'Text or announcement channel to mirror' },
      ),
    )
    .addSubcommand((subcommand) =>
      withChannelOption(
        subcommand
          .setName(Subcommand.Unwatch)
          .setDescription('Stop mirroring a channel; its link stops working'),
        { required: true, description: 'Channel to stop mirroring' },
      ),
    )
    .addSubcommand((subcommand) =>
      withChannelOption(
        subcommand
          .setName(Subcommand.Pause)
          .setDescription('Stop forwarding new messages (all mirrored channels if none given)'),
        { required: false, description: 'Only pause this channel' },
      ),
    )
    .addSubcommand((subcommand) =>
      withChannelOption(
        subcommand
          .setName(Subcommand.Resume)
          .setDescription('Resume forwarding and re-sync recent history'),
        { required: false, description: 'Only resume this channel' },
      ),
    )
    .addSubcommand((subcommand) =>
      withChannelOption(
        subcommand
          .setName(Subcommand.Rotate)
          .setDescription('Replace the link of a channel; the old link stops working'),
        { required: true, description: 'Channel whose link to replace' },
      ),
    )
    .addSubcommand((subcommand) =>
      withChannelOption(
        subcommand
          .setName(Subcommand.Notify)
          .setDescription('Choose the channel where the bot posts problem reports'),
        { required: true, description: 'Channel for operator notices' },
      ),
    );
}

function withChannelOption(
  subcommand: SlashCommandSubcommandBuilder,
  options: { required: boolean; description: string },
): SlashCommandSubcommandBuilder {
  return subcommand.addChannelOption((option) =>
    option
      .setName(CHANNEL_OPTION)
      .setDescription(options.description)
      .addChannelTypes(...WATCHABLE_CHANNEL_TYPES)
      .setRequired(options.required),
  );
}

export type CommandContext = {
  controller: SyncController;
  getStatusReport: (guildId: string, channelId: string | null) => StatusReport;
  logger: Logger;
};

export async function handlePantographCommand(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  try {
    await dispatchSubcommand(interaction, context);
  } catch (error) {
    context.logger.error({ error: describeError(error) }, 'Slash command failed');
    await respond(
      interaction,
      buildNotice(NoticeTone.Error, 'Something went wrong', [describeError(error)]),
    );
  }
}

async function dispatchSubcommand(
  interaction: ChatInputCommandInteraction,
  context: CommandContext,
): Promise<void> {
  if (!interaction.inCachedGuild()) {
    await respond(
      interaction,
      buildNotice(NoticeTone.Error, 'Server only', ['This command only works inside a server.']),
    );
    return;
  }
  const { controller } = context;
  const guildId = interaction.guildId;
  const subcommand = interaction.options.getSubcommand(true);
  const optionalChannelId =
    interaction.options.getChannel(CHANNEL_OPTION, false, WATCHABLE_CHANNEL_TYPES)?.id ?? null;

  switch (subcommand) {
    case Subcommand.Status: {
      await respond(
        interaction,
        buildStatusView(context.getStatusReport(guildId, optionalChannelId)),
      );
      return;
    }
    case Subcommand.Watch: {
      const channel = interaction.options.getChannel(CHANNEL_OPTION, true, WATCHABLE_CHANNEL_TYPES);
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      const result = await controller.watch(guildId, channel.id);
      if (!result.ok) {
        await respond(
          interaction,
          buildNotice(NoticeTone.Error, 'Could not mirror channel', [result.reason]),
        );
        return;
      }
      await respond(
        interaction,
        buildLinkNotice(
          result.syncProblem === null ? NoticeTone.Success : NoticeTone.Warning,
          result.alreadyWatched ? 'Already mirroring' : 'Now mirroring',
          channel.id,
          result.link,
          result.syncProblem === null
            ? ['Recent history was synced.']
            : [`Recent history could not be synced yet: ${result.syncProblem}`],
        ),
      );
      return;
    }
    case Subcommand.Unwatch: {
      const channel = interaction.options.getChannel(CHANNEL_OPTION, true, WATCHABLE_CHANNEL_TYPES);
      const removed = await controller.unwatch(channel.id);
      await respond(
        interaction,
        removed
          ? buildNotice(NoticeTone.Success, 'Stopped mirroring', [
              `${channelMention(channel.id)} is no longer mirrored. Its link stopped working and viewers were disconnected.`,
            ])
          : buildNotice(NoticeTone.Error, 'Not mirrored', [
              `${channelMention(channel.id)} was not being mirrored.`,
            ]),
      );
      return;
    }
    case Subcommand.Pause: {
      const result = await controller.pause(guildId, optionalChannelId);
      await respond(
        interaction,
        describeBulkResult(result, {
          title: 'Sync paused',
          summary:
            'New messages, edits and deletions are no longer forwarded. Use /pantograph resume to continue.',
        }),
      );
      return;
    }
    case Subcommand.Resume: {
      await interaction.deferReply({ flags: [MessageFlags.Ephemeral] });
      const result = await controller.resume(guildId, optionalChannelId);
      await respond(
        interaction,
        describeBulkResult(result, {
          title: 'Sync resumed',
          summary: 'Recent history was re-synced and live forwarding is back on.',
        }),
      );
      return;
    }
    case Subcommand.Rotate: {
      const channel = interaction.options.getChannel(CHANNEL_OPTION, true, WATCHABLE_CHANNEL_TYPES);
      const result = await controller.rotate(channel.id);
      await respond(
        interaction,
        result.ok
          ? buildLinkNotice(NoticeTone.Success, 'New link', channel.id, result.link, [
              'The previous link stopped working and its viewers were disconnected.',
            ])
          : buildNotice(NoticeTone.Error, 'Could not replace link', [result.reason]),
      );
      return;
    }
    case Subcommand.Notify: {
      const channel = interaction.options.getChannel(CHANNEL_OPTION, true, WATCHABLE_CHANNEL_TYPES);
      const botMember = interaction.guild.members.me ?? (await interaction.guild.members.fetchMe());
      if (!channel.permissionsFor(botMember).has(PermissionFlagsBits.SendMessages)) {
        await respond(
          interaction,
          buildNotice(NoticeTone.Error, 'Cannot post there', [
            `The bot is missing Send Messages in ${channelMention(channel.id)}.`,
          ]),
        );
        return;
      }
      await controller.setNotifyChannel(guildId, channel.id);
      await respond(
        interaction,
        buildNotice(NoticeTone.Success, 'Notices channel set', [
          `Problem reports for this server will be posted in ${channelMention(channel.id)}, one message per problem, updated in place.`,
        ]),
      );
      return;
    }
    default: {
      await respond(
        interaction,
        buildNotice(NoticeTone.Error, 'Unknown subcommand', [`"${subcommand}" is not supported.`]),
      );
    }
  }
}

function describeBulkResult(
  result: BulkResult,
  wording: { title: string; summary: string },
): ContainerBuilder {
  if (!result.ok) {
    return buildNotice(NoticeTone.Error, 'Nothing to do', [result.reason]);
  }
  const channelList = result.channelIds.map(channelMention).join(', ');
  const problemLines = result.problems.map(
    (problem) => `${channelMention(problem.channelId)}: ${problem.reason}`,
  );
  return buildNotice(
    problemLines.length === 0 ? NoticeTone.Success : NoticeTone.Warning,
    wording.title,
    [`${channelList}: ${wording.summary}`, ...problemLines],
  );
}

async function respond(
  interaction: ChatInputCommandInteraction,
  view: ContainerBuilder,
): Promise<void> {
  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ components: [view], flags: [MessageFlags.IsComponentsV2] });
    return;
  }
  await interaction.reply({
    components: [view],
    flags: [MessageFlags.Ephemeral, MessageFlags.IsComponentsV2],
  });
}
