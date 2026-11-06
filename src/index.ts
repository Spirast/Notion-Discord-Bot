import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";

import { startTaskBroadcast } from "./broadcast";
import { autocompleteHandlers, commandHandlers, RegisterCommands } from "./slashCommands";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

client.on("ready", () => {
  console.log(`Logged in as ${client.user?.tag}!`);
  RegisterCommands();
  startTaskBroadcast(client);
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isAutocomplete()) {
    const handler =
      autocompleteHandlers[interaction.commandName as keyof typeof autocompleteHandlers];
    if (handler) {
      await handler(interaction);
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  const handler = commandHandlers[interaction.commandName as keyof typeof commandHandlers];
  if (handler) {
    await handler(interaction);
  }
});

client.login(process.env.DISCORD_TOKEN);
