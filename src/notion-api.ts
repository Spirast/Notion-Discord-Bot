import type { PageObjectResponse } from "@notionhq/client";
import { Client, isFullPage, iterateAllDataSourceRows } from "@notionhq/client";

const COMPLETED_STATUSES = new Set(["done", "completed", "complete"]);

export interface Task {
  id: string;
  title: string;
  dueDate: Date | null;
  url: string;
  completed: boolean;
  types: string[];
  lastEditedById: string | null;
}

let notionClient: Client | null = null;

function getNotionClient(): Client {
  if (!notionClient) {
    const auth = process.env.NOTION_TOKEN;
    if (!auth) throw new Error("NOTION_TOKEN is not set");
    notionClient = new Client({ auth });
  }
  return notionClient;
}

async function getDataSourceId(databaseId: string): Promise<string> {
  const notion = getNotionClient();
  const database = await notion.databases.retrieve({
    database_id: databaseId,
  });

  if (!("data_sources" in database) || database.data_sources.length === 0) {
    throw new Error(`Database ${databaseId} has no data sources`);
  }

  const dataSourceId = database.data_sources[0]?.id;
  if (!dataSourceId) {
    throw new Error(`Database ${databaseId} has no data sources`);
  }
  return dataSourceId;
}

function getTitle(page: PageObjectResponse): string {
  for (const prop of Object.values(page.properties)) {
    if (prop.type === "title") {
      const text = prop.title.map((t) => t.plain_text).join("");
      if (text) return text;
    }
  }
  return "Untitled";
}

function getDueDate(page: PageObjectResponse): Date | null {
  for (const prop of Object.values(page.properties)) {
    if (prop.type === "date" && prop.date?.start) {
      const date = new Date(prop.date.start);
      if (!Number.isNaN(date.getTime())) return date;
    }
  }
  return null;
}

function isCompleted(page: PageObjectResponse): boolean {
  for (const prop of Object.values(page.properties)) {
    if (prop.type === "status" && prop.status?.name) {
      return COMPLETED_STATUSES.has(prop.status.name.toLowerCase());
    }
    if (prop.type === "select" && prop.select?.name) {
      return COMPLETED_STATUSES.has(prop.select.name.toLowerCase());
    }
  }
  return false;
}

function getTypes(page: PageObjectResponse): string[] {
  const entries = Object.entries(page.properties);

  const typeEntry =
    entries.find(
      ([name, prop]) =>
        (prop.type === "multi_select" || prop.type === "select") &&
        name.toLowerCase().includes("type"),
    ) ?? entries.find(([, prop]) => prop.type === "multi_select");

  if (!typeEntry) return [];

  const [, typeProp] = typeEntry;
  if (typeProp.type === "multi_select") {
    return typeProp.multi_select.map((option) => option.name);
  }
  if (typeProp.type === "select" && typeProp.select?.name) {
    return [typeProp.select.name];
  }
  return [];
}

export async function fetchAllTasks(): Promise<Task[]> {
  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!databaseId) {
    throw new Error("NOTION_DATABASE_ID is not set");
  }

  const notion = getNotionClient();
  const dataSourceId = await getDataSourceId(databaseId);

  const tasks: Task[] = [];

  for await (const row of iterateAllDataSourceRows(notion, {
    data_source_id: dataSourceId,
  })) {
    if (!isFullPage(row)) continue;

    tasks.push({
      id: row.id,
      title: getTitle(row),
      dueDate: getDueDate(row),
      url: row.url,
      completed: isCompleted(row),
      types: getTypes(row),
      lastEditedById: row.last_edited_by?.id ?? null,
    });
  }

  return tasks;
}

const userNameCache = new Map<string, string | null>();

export async function getNotionUserName(userId: string): Promise<string | null> {
  if (userNameCache.has(userId)) {
    return userNameCache.get(userId) ?? null;
  }

  try {
    const user = await getNotionClient().users.retrieve({ user_id: userId });
    const name = "name" in user ? (user.name ?? null) : null;
    userNameCache.set(userId, name);
    return name;
  } catch (error) {
    console.error(`Failed to resolve Notion user ${userId}:`, error);
    userNameCache.set(userId, null);
    return null;
  }
}

export async function fetchTasks(): Promise<Task[]> {
  const tasks = await fetchAllTasks();

  return tasks
    .filter((task) => !task.completed && task.dueDate)
    .sort((a, b) => (a.dueDate?.getTime() ?? 0) - (b.dueDate?.getTime() ?? 0));
}

export interface TaskTypeStats {
  total: number;
  completed: number;
}

export interface TaskStats {
  total: number;
  completed: number;
  byType: Record<string, TaskTypeStats>;
}

export async function fetchTaskStats(): Promise<TaskStats> {
  const tasks = await fetchAllTasks();

  const stats: TaskStats = { total: tasks.length, completed: 0, byType: {} };

  for (const task of tasks) {
    if (task.completed) stats.completed++;

    const types = task.types.length > 0 ? task.types : ["Uncategorized"];
    for (const type of types) {
      let typeStats = stats.byType[type];
      if (!typeStats) {
        typeStats = { total: 0, completed: 0 };
        stats.byType[type] = typeStats;
      }
      typeStats.total++;
      if (task.completed) typeStats.completed++;
    }
  }

  return stats;
}

export async function fetchTopTasks(limit = 5): Promise<Task[]> {
  const tasks = await fetchTasks();
  return tasks.slice(0, limit);
}
