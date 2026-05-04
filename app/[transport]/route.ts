import { createMcpHandler } from '@vercel/mcp-adapter';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { searchImages, searchImagesSchema, type ImageResult } from '@/tools/search-images';
import { queryArticles, queryArticlesSchema, type ArticleRow } from '@/tools/query-articles';

const IMAGE_PREVIEW_LIMIT = 5;

async function fetchAsBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return null;
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const mimeType = contentType.split(';')[0].trim();
    const buffer = await res.arrayBuffer();
    return { data: Buffer.from(buffer).toString('base64'), mimeType };
  } catch {
    return null;
  }
}

function imageMetaText(img: ImageResult): string {
  const lines: string[] = [];
  lines.push(`**${img.title || img.alt_text || img.file_path?.split('/').pop() || `Image #${img.wp_id}`}**`);
  lines.push(`Type: ${img.image_type.toUpperCase()} · URL: ${img.image_url}`);
  if (img.exif_caption) lines.push(`Caption: ${img.exif_caption}`);
  if (img.exif_credit) lines.push(`Credit: ${img.exif_credit}`);
  if (img.alt_text && img.exif_caption) lines.push(`Alt: ${img.alt_text}`);
  if (img.folder_names?.length) lines.push(`Folders: ${img.folder_names.join(', ')}`);
  return lines.join('\n');
}

const handler = createMcpHandler(
  (server) => {
    server.tool(
      'search_images',
      [
        'Search the EssentiallySports media library (~5M+ sports images).',
        'Returns rendered image previews alongside URLs, alt text, EXIF captions, photographer credits, and folder tags.',
        'Agency images (Getty, IMAGO, Imagn, AP Photo) have rich captions and photographer credits.',
        'Custom images have descriptive alt text and filename-derived keywords.',
        'Results are ranked by relevance then recency.',
      ].join(' '),
      searchImagesSchema.shape,
      async (input): Promise<CallToolResult> => {
        const parsed = searchImagesSchema.parse(input);
        const result = await searchImages(parsed);

        if (result.images.length === 0) {
          return {
            content: [{
              type: 'text' as const,
              text: `No images found for "${parsed.query}"${parsed.type !== 'all' ? ` (filtered to ${parsed.type} only)` : ''}.`,
            }],
          };
        }

        const header = `Found ${result.found.toLocaleString()} image${result.found !== 1 ? 's' : ''} for "${parsed.query}" · page ${result.page} of ${result.total_pages}`;

        const previewImages = result.images.slice(0, IMAGE_PREVIEW_LIMIT);
        const restImages = result.images.slice(IMAGE_PREVIEW_LIMIT);

        const thumbnails = await Promise.all(
          previewImages.map(img => {
            const url = img.thumb_url || img.image_url;
            return url ? fetchAsBase64(url) : Promise.resolve(null);
          })
        );

        const content: CallToolResult['content'] = [
          { type: 'text' as const, text: header },
        ];

        for (let i = 0; i < previewImages.length; i++) {
          const img = previewImages[i];
          const thumb = thumbnails[i];
          if (thumb) {
            content.push({
              type: 'image' as const,
              data: thumb.data,
              mimeType: thumb.mimeType,
            });
          }
          content.push({ type: 'text' as const, text: imageMetaText(img) });
        }

        if (restImages.length > 0) {
          content.push({
            type: 'text' as const,
            text: restImages.map(img => imageMetaText(img)).join('\n\n'),
          });
        }

        return { content };
      }
    );

    server.tool(
      'query_articles',
      [
        'Query EssentiallySports article performance data from the article_big_table (dbt_big_tables).',
        'Answers questions like: "latest NBA article published", "top articles yesterday by pageviews",',
        '"total pageviews per author this week", "all Golf articles with >1000 views on 2026-05-03",',
        '"average time on page for articles by writer X", "which sport drove the most Beehiiv traffic".',
        'Each row includes: slug, title, sport_name, writer, editor, publish_date, entity, content_type,',
        'total_pageviews, avg_scroll_rate (%), avg_time_on_page (seconds), engage_rate_pct (% reaching para1),',
        'and per-source pageviews: src_google_search, src_google_discover, src_google_news,',
        'src_facebook, src_reddit, src_flipboard, src_beehiiv, src_msn, src_newsbreak, src_others.',
        'Use traffic_date to filter when views happened. Use publish_date to filter when articles were published.',
        'Use group_by to aggregate across dimensions (e.g. ["writer"] for per-author totals).',
        'Athena-backed — expect 3–15s response time.',
      ].join(' '),
      queryArticlesSchema.shape,
      async (input): Promise<CallToolResult> => {
        const parsed = queryArticlesSchema.parse(input);
        const rows = await queryArticles(parsed);

        if (rows.length === 0) {
          return { content: [{ type: 'text', text: 'No articles found matching those filters.' }] };
        }

        const lines = rows.map((r: ArticleRow) => {
          const sources = [
            r.src_google_search > 0 && `Google Search: ${r.src_google_search.toLocaleString()}`,
            r.src_google_discover > 0 && `Discover: ${r.src_google_discover.toLocaleString()}`,
            r.src_google_news > 0 && `Google News: ${r.src_google_news.toLocaleString()}`,
            r.src_beehiiv > 0 && `Beehiiv: ${r.src_beehiiv.toLocaleString()}`,
            r.src_flipboard > 0 && `Flipboard: ${r.src_flipboard.toLocaleString()}`,
            r.src_newsbreak > 0 && `Newsbreak: ${r.src_newsbreak.toLocaleString()}`,
            r.src_facebook > 0 && `Facebook: ${r.src_facebook.toLocaleString()}`,
            r.src_reddit > 0 && `Reddit: ${r.src_reddit.toLocaleString()}`,
            r.src_msn > 0 && `MSN: ${r.src_msn.toLocaleString()}`,
            r.src_others > 0 && `Others: ${r.src_others.toLocaleString()}`,
          ].filter(Boolean).join(' · ');

          const meta = [
            r.sport_name && `Sport: ${r.sport_name}`,
            r.writer && `Writer: ${r.writer}`,
            r.editor && `Editor: ${r.editor}`,
            r.publish_date && `Published: ${r.publish_date}`,
            r.entity && r.entity !== '-' && `Entity: ${r.entity}`,
            r.content_type && `Type: ${r.content_type}`,
          ].filter(Boolean).join(' | ');

          const metrics = [
            `PVs: ${r.total_pageviews.toLocaleString()}`,
            r.avg_time_on_page > 0 && `Time: ${r.avg_time_on_page}s`,
            r.avg_scroll_rate > 0 && `Scroll: ${r.avg_scroll_rate}%`,
            r.engage_rate_pct > 0 && `Engage: ${r.engage_rate_pct}%`,
          ].filter(Boolean).join(' · ');

          const url = r.slug ? `https://www.essentiallysports.com/${r.slug}/` : null;
          const titleLine = r.title && url
            ? `**[${r.title}](${url})**`
            : r.title
            ? `**${r.title}**`
            : url
            ? url
            : '';

          const parts = [
            titleLine,
            meta,
            metrics,
            sources && `Sources: ${sources}`,
          ].filter(Boolean);

          return parts.join('\n');
        });

        const header = `${rows.length} result${rows.length !== 1 ? 's' : ''}`;
        return {
          content: [{ type: 'text', text: `${header}\n\n${lines.join('\n\n')}` }],
        };
      }
    );
  },
  {
    capabilities: { tools: {} },
  },
  {
    maxDuration: 60,
    verboseLogs: false,
  }
);

export { handler as GET, handler as POST, handler as DELETE };
