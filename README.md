# notion-discord-bot

A Discord bot that fetches tasks from a Notion database and replies to `/fetch-tasks` with a Discord embed.

## Requirements

- [Bun](https://bun.sh)
- A Discord application with a bot user
- A Notion integration connected to your tasks database

## Quickstart

### 1. Install dependencies

```bash
bun install
```

### 2. Configure environment variables

Create a `.env` file in the project root:

```bash
DISCORD_TOKEN=your-discord-bot-token
DISCORD_CLIENT_ID=your-discord-application-id
DISCORD_GUILD_ID=your-discord-server-id
NOTION_TOKEN=your-notion-integration-secret
NOTION_DATABASE_ID=your-notion-database-id
```

Where to find these values:

- `DISCORD_TOKEN`: Discord Developer Portal → your application → **Bot** → **Token**
- `DISCORD_CLIENT_ID`: Discord Developer Portal → your application → **General Information** → **Application ID**
- `DISCORD_GUILD_ID`: Discord server ID. Enable **Developer Mode** in Discord settings, then right-click the server and choose **Copy Server ID**
- `NOTION_TOKEN`: Notion → **My integrations** → your integration → **Internal Integration Secret**
- `NOTION_DATABASE_ID`: The database ID from the Notion database URL

### 3. Prepare Discord

1. In the Discord Developer Portal, open your application.
2. Under **Bot**, enable the **Message Content Intent**.
3. Invite the bot to your server using the OAuth2 URL generator with the `bot` and `applications.commands` scopes.
4. Restart the bot after changing environment variables.

### 4. Prepare Notion

1. Create an internal integration in Notion and copy its secret.
2. Open your tasks database in Notion.
3. Add the integration under the database's **Connections** settings.
4. Make sure the database has:
   - A title property for the task name
   - A date property for the due date
   - Optionally, a status or select property; statuses named `done`, `completed`, or `complete` are excluded

Tasks without a due date are not shown.

### 5. Run the bot

Development mode with automatic reload:

```bash
bun run dev
```

Normal run:

```bash
bun run start
```

When the bot starts, it registers slash commands and logs in to Discord. Use `/fetch-tasks` in a channel where the bot is available.

## Commands

| Command | Description |
| --- | --- |
| `/fetch-tasks` | Shows the top 5 open Notion tasks by due date, with overdue tasks marked |
| `/status` | Shows task completion progress |
| `/set-channel` | Sets the channel where task updates are broadcast (requires Manage Server; defaults to the channel the command is run in) |

## Task update broadcasts

The bot polls the Notion database every 30 seconds. When tasks are added, completed, or deleted in Notion, a "Task Updates" embed is posted to the channel configured with `/set-channel`. The configured channel is stored per server in `broadcast-channels.json`. On startup the current task list is used as the baseline, so existing tasks are not broadcast as new.

## Other scripts

```bash
bun run typecheck  # Type-check TypeScript
bun run check      # Run Biome checks
bun run lint       # Run Biome lint
bun run format     # Format files with Biome
```

## Troubleshooting

- **Missing environment variables:** Make sure `.env` exists in the project root and contains all five variables.
- **Bot does not appear in Discord:** Check that the invite URL includes `applications.commands` and that the bot was added to the correct server.
- **Slash command is missing:** Restart the bot and wait a moment; global slash commands can take time to propagate.
- **Notion request fails:** Verify `NOTION_TOKEN`, `NOTION_DATABASE_ID`, and that the database is shared with the integration.
