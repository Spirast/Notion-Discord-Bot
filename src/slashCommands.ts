import {
  type ChatInputCommandInteraction,
  EmbedBuilder,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";
import "dotenv/config";
import { fetchTopTasks } from "./notion-api";

const slashCommands = [
  new SlashCommandBuilder()
    .setName("fetch-tasks")
    .setDescription("Fetch top tasks from the notion database")
    .toJSON(),
];

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
