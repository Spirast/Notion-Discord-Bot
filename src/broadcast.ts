import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Client, EmbedBuilder, type TextChannel } from "discord.js";
import { fetchAllTasks } from "./notion-api";

const STORAGE_FILE = join(import.meta.dir, "..", "broadcast-channels.json");
const POLL_INTERVAL_MS = 3000;

type ChannelMap = Record<string, string>;

interface SnapshotEntry {
  title: string;
  completed: boolean;
  url: string;
}

type Snapshot = Map<string, SnapshotEntry>;

interface TaskEvent {
  type: "added" | "completed" | "deleted";
  title: string;
  url?: string;
}

const EVENT_LABELS: Record<TaskEvent["type"], string> = {
  added: "Task added",
  completed: "Task completed",
  deleted: "Task deleted",
};

const channelMap: ChannelMap = loadChannelMap();
let previousSnapshot: Snapshot | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function loadChannelMap(): ChannelMap {
  try {
    return JSON.parse(readFileSync(STORAGE_FILE, "utf8")) as ChannelMap;
  } catch {
    return {};
  }
}

function saveChannelMap() {
  writeFileSync(STORAGE_FILE, JSON.stringify(channelMap, null, 2));
}

export function setBroadcastChannel(guildId: string, channelId: string) {
  channelMap[guildId] = channelId;
  saveChannelMap();
}

function diffSnapshots(previous: Snapshot, current: Snapshot): TaskEvent[] {
  const events: TaskEvent[] = [];

  for (const [id, task] of current) {
    const prev = previous.get(id);
    if (!prev) {
      events.push({ type: "added", title: task.title, url: task.url });
    } else if (!prev.completed && task.completed) {
      events.push({ type: "completed", title: task.title, url: task.url });
    }
  }

  for (const [id, prev] of previous) {
    if (!current.has(id)) {
      events.push({ type: "deleted", title: prev.title, url: prev.url });
    }
  }

  return events;
}

async function broadcastEvents(client: Client, events: TaskEvent[]) {
  const channelIds = new Set(Object.values(channelMap));

  const embed = new EmbedBuilder().setTitle("Task Updates").setTimestamp();
  for (const event of events) {
    const value = event.url ? `[Open in Notion](${event.url})` : "No link available";
    embed.addFields({
      name: EVENT_LABELS[event.type],
      value: `${event.title}\n${value}`,
    });
  }
  embed.setColor(events.some((e) => e.type === "deleted") ? 0xed4245 : 0x5865f2);

  for (const channelId of channelIds) {
    try {
      const channel = await client.channels.fetch(channelId);
      if (channel && "send" in channel) {
        await (channel as TextChannel).send({ embeds: [embed] });
      }
    } catch (error) {
      console.error(`Failed to broadcast to channel ${channelId}:`, error);
    }
  }
}

async function pollTasks(client: Client) {
  try {
    const tasks = await fetchAllTasks();
    const current: Snapshot = new Map(
      tasks.map((task) => [
        task.id,
        { title: task.title, completed: task.completed, url: task.url },
      ]),
    );

    if (!previousSnapshot) {
      previousSnapshot = current;
      return;
    }

    const events = diffSnapshots(previousSnapshot, current);
    previousSnapshot = current;

    if (events.length > 0) {
      await broadcastEvents(client, events);
    }
  } catch (error) {
    console.error("Error polling tasks for changes:", error);
  }
}

export function startTaskBroadcast(client: Client) {
  if (pollTimer) return;
  pollTimer = setInterval(() => void pollTasks(client), POLL_INTERVAL_MS);
}
