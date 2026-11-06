import type { PageObjectResponse } from "@notionhq/client";
import { Client, isFullPage, iterateAllDataSourceRows } from "@notionhq/client";

const COMPLETED_STATUSES = new Set(["done", "completed", "complete"]);

export interface Task {
  id: string;
  title: string;
  dueDate: Date | null;
  url: string;
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

export async function fetchTasks(): Promise<Task[]> {
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
    if (!isFullPage(row) || isCompleted(row)) continue;

    const dueDate = getDueDate(row);
    if (!dueDate) continue;

    tasks.push({
      id: row.id,
      title: getTitle(row),
      dueDate,
      url: row.url,
    });
  }

  // Overdue first (most overdue at top), then today, then soonest upcoming
  tasks.sort((a, b) => (a.dueDate?.getTime() ?? 0) - (b.dueDate?.getTime() ?? 0));

  return tasks;
}

export async function fetchTopTasks(limit = 5): Promise<Task[]> {
  const tasks = await fetchTasks();
  return tasks.slice(0, limit);
}
