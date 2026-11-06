import type { DataSourceObjectResponse, PageObjectResponse } from "@notionhq/client";
import { Client, isFullPage, iterateAllDataSourceRows } from "@notionhq/client";

const COMPLETED_STATUSES = new Set(["done", "completed", "complete"]);
const COMPLETED_OPTION_PRIORITY = ["complete", "completed", "done"] as const;
const COMPLETION_PROPERTY_NAME = /\b(?:status|state|complete|completed|done)\b/i;

type DataSourceProperties = DataSourceObjectResponse["properties"];

interface CompletionTarget {
  propertyName: string;
  propertyType: "status" | "select";
  optionName: string;
}

export interface CompleteTaskResult {
  task: Task;
  wasCompleted: boolean;
}

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

function getDatabaseId(): string {
  const databaseId = process.env.NOTION_DATABASE_ID;
  if (!databaseId) {
    throw new Error("NOTION_DATABASE_ID is not set");
  }
  return databaseId;
}

async function getDataSourceIds(): Promise<{ databaseId: string; dataSourceId: string }> {
  const databaseId = getDatabaseId();
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
  return { databaseId, dataSourceId };
}

async function getDataSourceProperties(dataSourceId: string): Promise<DataSourceProperties> {
  const dataSource = await getNotionClient().dataSources.retrieve({
    data_source_id: dataSourceId,
  });
  return dataSource.properties;
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
      if (COMPLETED_STATUSES.has(prop.status.name.toLowerCase())) return true;
    }
    if (prop.type === "select" && prop.select?.name) {
      if (COMPLETED_STATUSES.has(prop.select.name.toLowerCase())) return true;
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

function pageToTask(page: PageObjectResponse): Task {
  return {
    id: page.id,
    title: getTitle(page),
    dueDate: getDueDate(page),
    url: page.url,
    completed: isCompleted(page),
    types: getTypes(page),
    lastEditedById: page.last_edited_by?.id ?? null,
  };
}

function completedOptionName(options: Array<{ name: string }>): string | null {
  const namesByKey = new Map(
    options.map((option) => [option.name.trim().toLowerCase(), option.name]),
  );

  for (const status of COMPLETED_OPTION_PRIORITY) {
    const name = namesByKey.get(status);
    if (name) return name;
  }

  for (const option of options) {
    if (COMPLETED_STATUSES.has(option.name.trim().toLowerCase())) return option.name;
  }
  return null;
}

function findCompletionTarget(properties: DataSourceProperties): CompletionTarget | null {
  const entries = Object.entries(properties).sort(
    (a, b) =>
      Number(COMPLETION_PROPERTY_NAME.test(b[0])) - Number(COMPLETION_PROPERTY_NAME.test(a[0])),
  );

  for (const [propertyName, property] of entries) {
    if (property.type !== "status") continue;
    const optionName = completedOptionName(property.status.options);
    if (optionName) return { propertyName, propertyType: "status", optionName };
  }

  for (const [propertyName, property] of entries) {
    if (property.type !== "select") continue;
    const optionName = completedOptionName(property.select.options);
    if (optionName) return { propertyName, propertyType: "select", optionName };
  }

  return null;
}

function sameNotionId(a: string, b: string): boolean {
  return a.replace(/-/g, "").toLowerCase() === b.replace(/-/g, "").toLowerCase();
}

function isConfiguredTaskPage(
  page: PageObjectResponse,
  databaseId: string,
  dataSourceId: string,
): boolean {
  if (page.parent.type === "data_source_id") {
    return (
      sameNotionId(page.parent.data_source_id, dataSourceId) ||
      sameNotionId(page.parent.database_id, databaseId)
    );
  }
  if (page.parent.type === "database_id") {
    return sameNotionId(page.parent.database_id, databaseId);
  }
  return false;
}

export async function fetchAllTasks(): Promise<Task[]> {
  const { dataSourceId } = await getDataSourceIds();
  const notion = getNotionClient();

  const tasks: Task[] = [];

  for await (const row of iterateAllDataSourceRows(notion, {
    data_source_id: dataSourceId,
  })) {
    if (!isFullPage(row)) continue;
    tasks.push(pageToTask(row));
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

export async function fetchIncompleteTasks(): Promise<Task[]> {
  const tasks = await fetchAllTasks();
  return tasks.filter((task) => !task.completed).sort((a, b) => a.title.localeCompare(b.title));
}

export async function completeTask(taskId: string): Promise<CompleteTaskResult> {
  const notion = getNotionClient();
  const { databaseId, dataSourceId } = await getDataSourceIds();

  const pageResponse = await notion.pages.retrieve({ page_id: taskId });
  if (!isFullPage(pageResponse)) {
    throw new Error("Task not found");
  }
  if (!isConfiguredTaskPage(pageResponse, databaseId, dataSourceId)) {
    throw new Error("Task not found in the configured Notion database");
  }

  const task = pageToTask(pageResponse);
  if (task.completed) {
    return { task, wasCompleted: true };
  }

  const properties = await getDataSourceProperties(dataSourceId);
  const target = findCompletionTarget(properties);
  if (!target) {
    throw new Error("No status or select property with a completed option was found");
  }

  const property =
    target.propertyType === "status"
      ? { status: { name: target.optionName } }
      : { select: { name: target.optionName } };

  const updatedPage = await notion.pages.update({
    page_id: task.id,
    properties: {
      [target.propertyName]: property,
    },
  });

  if (isFullPage(updatedPage)) {
    return { task: pageToTask(updatedPage), wasCompleted: false };
  }

  const refreshedPage = await notion.pages.retrieve({ page_id: task.id });
  if (!isFullPage(refreshedPage)) {
    throw new Error("Task update could not be verified");
  }
  return { task: pageToTask(refreshedPage), wasCompleted: false };
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
