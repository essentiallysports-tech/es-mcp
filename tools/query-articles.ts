import { z } from 'zod';
import { runAthenaQuery } from '@/utilities/athena';

const TABLE = '"dbt_big_tables"."article_big_table"';
const DATABASE = 'dbt_big_tables';

export const queryArticlesSchema = z.object({
  traffic_date: z.string().optional().describe(
    'Single date when traffic occurred, YYYY-MM-DD. Use this for "yesterday", "last Tuesday", etc.'
  ),
  traffic_date_start: z.string().optional().describe('Start of traffic date range, YYYY-MM-DD'),
  traffic_date_end: z.string().optional().describe('End of traffic date range, YYYY-MM-DD (inclusive)'),

  publish_date: z.string().optional().describe('Article publish date, YYYY-MM-DD'),
  publish_date_start: z.string().optional().describe('Publish date range start, YYYY-MM-DD'),
  publish_date_end: z.string().optional().describe('Publish date range end, YYYY-MM-DD'),

  sport: z.string().optional().describe(
    'Filter by sport_name. Examples: "NBA", "NFL", "Golf", "Tennis", "NASCAR", "WNBA", "MMA", "Boxing", "F1", "Olympics/USS". Partial match.'
  ),
  writer: z.string().optional().describe('Filter by writer/author name. Partial match, case-insensitive.'),
  editor: z.string().optional().describe('Filter by editor name. Partial match, case-insensitive.'),
  slug: z.string().optional().describe('Exact article slug.'),
  entity: z.string().optional().describe('Filter by entity/player name. Partial match.'),
  content_type: z.string().optional().describe('Filter by content_type. Examples: "Trend Setting", "Quick Hits", "In-Depth".'),
  keyword: z.string().optional().describe('Filter by focus_keyword. Partial match.'),

  group_by: z.array(
    z.enum(['writer', 'editor', 'sport_name', 'publish_date', 'entity', 'content_type', 'slug'])
  ).optional().describe(
    'Aggregate metrics by these dimensions instead of per-article. ' +
    'E.g. ["writer"] to sum pageviews per author. ["sport_name"] for per-sport totals. ' +
    'Omit for per-article results (default).'
  ),

  min_pageviews: z.number().int().min(0).default(0).describe(
    'Minimum total pageviews threshold. E.g. 1000 to filter low-traffic articles.'
  ),
  min_engage_rate: z.number().min(0).max(100).optional().describe(
    'Minimum engage rate % (% of readers who reached end of paragraph 1). E.g. 90 for highly-read articles.'
  ),
  min_scroll_rate: z.number().min(0).optional().describe(
    'Minimum avg scroll rate. E.g. 25 to find articles readers scrolled deeply through.'
  ),
  min_time_on_page: z.number().min(0).optional().describe(
    'Minimum avg time on page in seconds. E.g. 120 for long-read articles.'
  ),

  order_by: z.enum([
    'total_pageviews', 'publish_date', 'publish_time', 'avg_time_on_page',
    'avg_scroll_rate', 'engage_rate_pct', 'writer', 'sport_name',
    'src_google_search', 'src_google_discover', 'src_google_news',
    'src_beehiiv', 'src_flipboard', 'src_newsbreak',
    'src_facebook', 'src_reddit', 'src_msn', 'src_others',
  ]).default('total_pageviews').describe(
    'Column to sort by. Use publish_time to sort by exact publish timestamp. Use src_* columns to rank by a specific traffic source.'
  ),
  order_dir: z.enum(['asc', 'desc']).default('desc'),
  limit: z.number().int().min(1).max(500).default(50).describe(
    'Max rows to return. Default 50.'
  ),
});

export type QueryArticlesInput = z.infer<typeof queryArticlesSchema>;

export interface ArticleRow {
  slug?: string;
  title?: string;
  sport_name?: string;
  writer?: string;
  editor?: string;
  publish_date?: string;
  publish_time?: string;
  entity?: string;
  content_type?: string;
  total_pageviews: number;
  avg_scroll_rate: number;
  avg_time_on_page: number;
  engage_rate_pct: number;
  src_google_search: number;
  src_google_discover: number;
  src_google_news: number;
  src_facebook: number;
  src_reddit: number;
  src_flipboard: number;
  src_beehiiv: number;
  src_msn: number;
  src_newsbreak: number;
  src_others: number;
  metrics_pending?: boolean;
  [key: string]: unknown;
}

const WP_TABLE = '"es-data-lake"."wp_articles"';
const WP_DATABASE = 'es-data-lake';

export async function queryArticles(input: QueryArticlesInput): Promise<ArticleRow[]> {
  const parsed = queryArticlesSchema.parse(input);
  const sql = buildSQL(parsed);
  const rows = await runAthenaQuery(sql, DATABASE);
  const primary = rows.map(parseRow);

  // Supplement with wp_articles when filtering by publish date or slug —
  // the pipeline lag means recently published articles may not be in article_big_table yet.
  const needsFallback =
    parsed.publish_date || parsed.publish_date_start || parsed.publish_date_end || parsed.slug;

  if (!needsFallback) return primary;

  const existingSlugs = new Set(primary.map(r => r.slug).filter(Boolean));
  const wpSql = buildWpSQL(parsed);
  const wpRows = await runAthenaQuery(wpSql, WP_DATABASE);
  const wpPrimary = wpRows
    .map(parseWpRow)
    .filter(r => r.slug && !existingSlugs.has(r.slug));

  return [...primary, ...wpPrimary];
}

function sanitize(s: string): string {
  return s.replace(/'/g, "''");
}

function buildSQL(input: QueryArticlesInput): string {
  const {
    traffic_date, traffic_date_start, traffic_date_end,
    publish_date, publish_date_start, publish_date_end,
    sport, writer, editor, slug, entity, content_type, keyword,
    group_by, min_pageviews, min_engage_rate, min_scroll_rate, min_time_on_page,
    order_by, order_dir, limit,
  } = input;

  const defaultDims = ['slug', 'title', 'sport_name', 'writer', 'editor', 'publish_date', 'entity', 'content_type'];
  const groupDims = group_by && group_by.length > 0 ? group_by : defaultDims;

  const conditions: string[] = [];

  if (traffic_date) {
    conditions.push(`DATE(timegroup_10) = DATE '${sanitize(traffic_date)}'`);
  } else if (traffic_date_start || traffic_date_end) {
    if (traffic_date_start) conditions.push(`DATE(timegroup_10) >= DATE '${sanitize(traffic_date_start)}'`);
    if (traffic_date_end) conditions.push(`DATE(timegroup_10) <= DATE '${sanitize(traffic_date_end)}'`);
  }

  if (publish_date) {
    conditions.push(`publish_date = DATE '${sanitize(publish_date)}'`);
  } else if (publish_date_start || publish_date_end) {
    if (publish_date_start) conditions.push(`publish_date >= DATE '${sanitize(publish_date_start)}'`);
    if (publish_date_end) conditions.push(`publish_date <= DATE '${sanitize(publish_date_end)}'`);
  }

  if (sport) conditions.push(`LOWER(sport_name) LIKE LOWER('%${sanitize(sport)}%')`);
  if (writer) conditions.push(`LOWER(writer) LIKE LOWER('%${sanitize(writer)}%')`);
  if (editor) conditions.push(`LOWER(editor) LIKE LOWER('%${sanitize(editor)}%')`);
  if (slug) conditions.push(`slug = '${sanitize(slug)}'`);
  if (entity) conditions.push(`LOWER(entity) LIKE LOWER('%${sanitize(entity)}%')`);
  if (content_type) conditions.push(`LOWER(content_type) LIKE LOWER('%${sanitize(content_type)}%')`);
  if (keyword) conditions.push(`LOWER(focus_keyword) LIKE LOWER('%${sanitize(keyword)}%')`);

  const where = conditions.length > 0 ? `WHERE ${conditions.join('\n  AND ')}` : '';

  const havingClauses: string[] = [];
  if (min_pageviews > 0) havingClauses.push(`SUM(pageload) >= ${min_pageviews}`);
  if (min_engage_rate != null) havingClauses.push(
    `ROUND((SUM(end_of_para1) / NULLIF(SUM(pageload), 0)) * 100, 2) >= ${min_engage_rate}`
  );
  if (min_scroll_rate != null) havingClauses.push(
    `ROUND(SUM(pageload * scroll_rate) / NULLIF(SUM(pageload), 0), 2) >= ${min_scroll_rate}`
  );
  if (min_time_on_page != null) havingClauses.push(
    `ROUND(SUM(pageload * avg_read_time_in_scroll_window) / NULLIF(SUM(pageload), 0), 2) >= ${min_time_on_page}`
  );
  const having = havingClauses.length > 0 ? `HAVING ${havingClauses.join('\n  AND ')}` : '';

  const srcCols = new Set([
    'src_google_search', 'src_google_discover', 'src_google_news',
    'src_beehiiv', 'src_flipboard', 'src_newsbreak',
    'src_facebook', 'src_reddit', 'src_msn', 'src_others',
  ]);
  const orderCol = order_by === 'publish_date' ? 'MAX(publish_date)'
    : order_by === 'publish_time' ? 'MAX(publish_time)'
    : order_by === 'writer' ? 'writer'
    : order_by === 'sport_name' ? 'sport_name'
    : srcCols.has(order_by) ? order_by
    : order_by;

  return `
SELECT
  ${groupDims.join(',\n  ')},
  MAX(publish_time) AS publish_time,
  SUM(pageload) AS total_pageviews,
  ROUND(SUM(pageload * scroll_rate) / NULLIF(SUM(pageload), 0), 2) AS avg_scroll_rate,
  ROUND(SUM(pageload * avg_read_time_in_scroll_window) / NULLIF(SUM(pageload), 0), 2) AS avg_time_on_page,
  ROUND((SUM(end_of_para1) / NULLIF(SUM(pageload), 0)) * 100, 2) AS engage_rate_pct,
  SUM(scroll_pageview_google_search) AS src_google_search,
  SUM(scroll_pageview_google_discover) AS src_google_discover,
  SUM(scroll_pageview_google_news) AS src_google_news,
  SUM(scroll_pageview_facebook) AS src_facebook,
  SUM(scroll_pageview_reddit) AS src_reddit,
  SUM(scroll_pageview_flipboard) AS src_flipboard,
  SUM(scroll_pageview_beehiiv) AS src_beehiiv,
  SUM(scroll_pageview_msn) AS src_msn,
  SUM(scroll_pageview_newsbreak_nl) AS src_newsbreak,
  SUM(scroll_pageview_others) AS src_others
FROM ${TABLE}
${where}
GROUP BY ${groupDims.join(', ')}
${having}
ORDER BY ${orderCol} ${order_dir.toUpperCase()}
LIMIT ${limit}`.trim();
}

function buildWpSQL(input: QueryArticlesInput): string {
  const {
    publish_date, publish_date_start, publish_date_end,
    slug, sport, writer,
    order_dir, limit,
  } = input;

  const conditions: string[] = [`post_status = 'publish'`];

  if (publish_date) {
    conditions.push(`publish_date = DATE '${sanitize(publish_date)}'`);
  } else if (publish_date_start || publish_date_end) {
    if (publish_date_start) conditions.push(`publish_date >= DATE '${sanitize(publish_date_start)}'`);
    if (publish_date_end) conditions.push(`publish_date <= DATE '${sanitize(publish_date_end)}'`);
  }

  if (slug) conditions.push(`post_name = '${sanitize(slug)}'`);
  if (sport) conditions.push(`LOWER(sports) LIKE LOWER('%${sanitize(sport)}%')`);
  if (writer) conditions.push(`LOWER(post_author) LIKE LOWER('%${sanitize(writer)}%')`);

  const where = `WHERE ${conditions.join('\n  AND ')}`;

  return `
SELECT
  post_name AS slug,
  post_title AS title,
  sports AS sport_name,
  publish_date,
  CAST(published AS VARCHAR) AS publish_time
FROM ${WP_TABLE}
${where}
ORDER BY publish_date ${order_dir.toUpperCase()}, published ${order_dir.toUpperCase()}
LIMIT ${limit}`.trim();
}

function parseWpRow(row: Record<string, string>): ArticleRow {
  return {
    slug: row.slug || undefined,
    title: row.title || undefined,
    sport_name: row.sport_name || undefined,
    publish_date: row.publish_date || undefined,
    publish_time: row.publish_time || undefined,
    total_pageviews: 0,
    avg_scroll_rate: 0,
    avg_time_on_page: 0,
    engage_rate_pct: 0,
    src_google_search: 0,
    src_google_discover: 0,
    src_google_news: 0,
    src_facebook: 0,
    src_reddit: 0,
    src_flipboard: 0,
    src_beehiiv: 0,
    src_msn: 0,
    src_newsbreak: 0,
    src_others: 0,
    metrics_pending: true,
  };
}

function parseRow(row: Record<string, string>): ArticleRow {
  const num = (k: string) => parseFloat(row[k] || '0') || 0;
  return {
    ...row,
    total_pageviews: num('total_pageviews'),
    avg_scroll_rate: num('avg_scroll_rate'),
    avg_time_on_page: num('avg_time_on_page'),
    engage_rate_pct: num('engage_rate_pct'),
    src_google_search: num('src_google_search'),
    src_google_discover: num('src_google_discover'),
    src_google_news: num('src_google_news'),
    src_facebook: num('src_facebook'),
    src_reddit: num('src_reddit'),
    src_flipboard: num('src_flipboard'),
    src_beehiiv: num('src_beehiiv'),
    src_msn: num('src_msn'),
    src_newsbreak: num('src_newsbreak'),
    src_others: num('src_others'),
  };
}
