const notionToken = process.env.NOTION_API_TOKEN;
const providedId =
  process.env.NOTION_DATA_SOURCE_ID ??
  process.env.NOTION_DATABASE_ID ??
  process.env.NOTION_DATABASE_OR_DATA_SOURCE_ID;
const notionVersion = process.env.NOTION_API_VERSION ?? "2026-03-11";
const properties =
  process.argv.slice(2).length > 0
    ? process.argv.slice(2)
    : ["Rating (After)", "Opp Rating (After)"];

if (!notionToken) {
  throw new Error("NOTION_API_TOKEN is required");
}

if (!providedId) {
  throw new Error(
    "Set NOTION_DATA_SOURCE_ID or NOTION_DATABASE_ID (or NOTION_DATABASE_OR_DATA_SOURCE_ID)"
  );
}

function normalizeId(value: string): string {
  const match = value.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  return match?.[0] ?? value.trim();
}

async function notionRequest(
  path: string,
  init: { method?: string; body?: unknown; notionVersionOverride?: string } = {}
) {
  const response = await fetch(`https://api.notion.com/${path}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${notionToken}`,
      "Content-Type": "application/json",
      "Notion-Version": init.notionVersionOverride ?? notionVersion,
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });

  const text = await response.text();
  const data = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  return { response, data, text };
}

async function resolveDataSourceId(id: string): Promise<{ id: string; source: string }> {
  const normalizedId = normalizeId(id);

  const directDataSource = await notionRequest(`v1/data_sources/${normalizedId}`);
  if (directDataSource.response.ok) {
    return { id: normalizedId, source: "data source" };
  }

  const databaseLookup = await notionRequest(`v1/databases/${normalizedId}`);
  if (databaseLookup.response.ok) {
    const dataSources = Array.isArray(databaseLookup.data?.data_sources)
      ? (databaseLookup.data?.data_sources as Array<{ id?: string }>)
      : [];

    if (dataSources.length === 1 && dataSources[0]?.id) {
      return { id: dataSources[0].id, source: "database child data source" };
    }

    if (dataSources.length > 1) {
      throw new Error(
        `Database ${normalizedId} has ${dataSources.length} data sources. Set NOTION_DATA_SOURCE_ID to the exact one you want to update.`
      );
    }
  }

  return { id: normalizedId, source: "legacy database" };
}

const target = await resolveDataSourceId(providedId);
const schemaPatch = Object.fromEntries(properties.map((name) => [name, null]));

let update = await notionRequest(`v1/data_sources/${target.id}`, {
  method: "PATCH",
  body: { properties: schemaPatch },
});

if (!update.response.ok && target.source === "legacy database") {
  update = await notionRequest(`v1/databases/${target.id}`, {
    method: "PATCH",
    notionVersionOverride: "2022-06-28",
    body: { properties: schemaPatch },
  });
}

if (!update.response.ok) {
  throw new Error(`Notion API ${update.response.status}: ${update.text}`);
}

const result = update.data as { id?: string; properties?: Record<string, unknown>; object?: string };
const remaining = Object.keys(result.properties ?? {});

console.log(`Updated ${result.object ?? "resource"} ${result.id ?? target.id}`);
console.log(`Resolved from: ${target.source}`);
console.log(`Removed properties: ${properties.join(", ")}`);
console.log(`Remaining property count: ${remaining.length}`);
