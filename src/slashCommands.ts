import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import "dotenv/config";
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
];

function progressBar(percent: number, length = 20): string {
  const filled = Math.round((percent / 100) * length);
  return `${"█".repeat(filled)}${"░".repeat(length - filled)}`;
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

      const embed = new EmbedBuilder().setTitle("Top Tasks").setColor(0x5865f2).setTimestamp();

      for (const task of tasks) {
        const dueDate = task.dueDate
          ? `<t:${Math.floor(task.dueDate.getTime() / 1000)}:D>`
          : "No due date";
        const overdue = task.dueDate && task.dueDate.getTime() < Date.now() ? " ⚠️ Overdue" : "";

        embed.addFields({
          name: task.title,
          value: `Due: ${dueDate}${overdue}\n[Open in Notion](${task.url})`,
        });
      }

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
          `${progressBar(percent)} **${percent}%** complete\n${completed}/${total} tasks done`,
        )
        .setColor(percent === 100 ? 0x57f287 : 0x5865f2)
        .setTimestamp()
        .addFields({ name: "Remaining", value: `${remaining} task${remaining === 1 ? "" : "s"}` });

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
