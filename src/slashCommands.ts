import {
  ChannelType,
  type ChatInputCommandInteraction,
  EmbedBuilder,
  PermissionFlagsBits,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import "dotenv/config";
import { setBroadcastChannel } from "./broadcast";
import { fetchTaskStats, fetchTopTasks } from "./notion-api";

const slashCommands = [
  new SlashCommandBuilder()
    .setName("fetch-tasks")
    .setDescription("Fetch top tasks from the notion database")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Show task completion progress")
    .toJSON(),
  new SlashCommandBuilder()
    .setName("set-channel")
    .setDescription("Set the channel where task updates are broadcast")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addChannelOption((option) =>
      option
        .setName("channel")
        .setDescription("The channel to broadcast task updates to (defaults to this channel)")
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(false),
    )
    .toJSON(),
];

function progressBar(percent: number, length = 20): string {
  const filled = Math.round((percent / 100) * length);
  return `${"█".repeat(filled)}${"░".repeat(length - filled)}`;
}

const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

function tasksEmbedColor(tasks: { dueDate: Date | null }[]): number {
  const now = Date.now();
  if (tasks.some((t) => t.dueDate && t.dueDate.getTime() < now)) return 0xed4245;
  if (tasks.some((t) => t.dueDate && t.dueDate.getTime() - now < TWO_DAYS_MS)) return 0xfee75c;
  return 0x5865f2;
}

export const commandHandlers: Record<
  string,
  (interaction: ChatInputCommandInteraction) => Promise<void>
> = {
  "fetch-tasks": async (interaction) => {
    await interaction.deferReply();

    try {
      const tasks = await fetchTopTasks();

      if (tasks.length === 0) {
        await interaction.editReply("No tasks found.");
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle("Top Tasks")
        .setColor(tasksEmbedColor(tasks))
        .setTimestamp()
        .setFooter({ text: `${tasks.length} upcoming task${tasks.length === 1 ? "" : "s"}` });

      const lines = tasks.map((task, index) => {
        const dueDate = task.dueDate
          ? `<t:${Math.floor(task.dueDate.getTime() / 1000)}:D>`
          : "No due date";
        const overdue = task.dueDate && task.dueDate.getTime() < Date.now() ? " · **Overdue**" : "";
        const types = task.types.length > 0 ? ` · ${task.types.join(", ")}` : "";
        return `**${index + 1}.** [${task.title}](${task.url})\n   Due ${dueDate}${overdue}${types}`;
      });
      embed.setDescription(lines.join("\n"));

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error("Error fetching tasks:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      await interaction.editReply(`Failed to fetch tasks: ${message}`);
    }
  },
  status: async (interaction) => {
    await interaction.deferReply();

    try {
      const { total, completed, byType } = await fetchTaskStats();

      if (total === 0) {
        await interaction.editReply("No tasks found.");
        return;
      }

      const percent = Math.round((completed / total) * 100);
      const remaining = total - completed;

      const embed = new EmbedBuilder()
        .setTitle("Task Status")
        .setDescription(
          `${progressBar(percent)} **${percent}%** complete\n${completed}/${total} tasks done · ${remaining} remaining`,
        )
        .setColor(percent === 100 ? 0x57f287 : 0x5865f2)
        .setTimestamp()
        .setFooter({ text: "Task completion by type" });

      const types = Object.entries(byType).sort((a, b) => b[1].total - a[1].total);
      for (const [type, stats] of types.slice(0, 25)) {
        const typePercent = Math.round((stats.completed / stats.total) * 100);
        embed.addFields({
          name: type,
          value: `${progressBar(typePercent, 10)} **${typePercent}%** (${stats.completed}/${stats.total})`,
        });
      }

      await interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error("Error fetching task status:", error);
      const message = error instanceof Error ? error.message : "Unknown error";
      await interaction.editReply(`Failed to fetch task status: ${message}`);
    }
  },
  "set-channel": async (interaction) => {
    if (!interaction.guildId) {
      await interaction.reply({
        content: "This command can only be used in a server.",
        ephemeral: true,
      });
      return;
    }

    const channel = interaction.options.getChannel("channel") ?? interaction.channel;
    if (!channel || !("id" in channel)) {
      await interaction.reply({ content: "Could not determine the channel.", ephemeral: true });
      return;
    }

    setBroadcastChannel(interaction.guildId, channel.id);
    await interaction.reply({
      content: `Task updates will now be broadcast to <#${channel.id}>.`,
      ephemeral: true,
    });
  },
};

export async function RegisterCommands() {
  const token = process.env.DISCORD_TOKEN;
  const clientId = process.env.DISCORD_CLIENT_ID;
  const guildId = process.env.DISCORD_GUILD_ID;

  if (!token || !clientId || !guildId) {
    console.error("Missing required environment variables");
    return;
  }

  const rest = new REST().setToken(token);

  try {
    console.log("Registering commands...");

    await rest.put(Routes.applicationCommands(clientId), {
      body: slashCommands,
    });

    console.log("Commands registered successfully");
  } catch (error) {
    console.error("Error registering commands:", error);
  }
}
