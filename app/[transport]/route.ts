import { createMcpHandler } from '@vercel/mcp-adapter';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { searchImages, searchImagesSchema, type ImageResult } from '@/tools/search-images';

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

    // Future tools: list_articles, get_article, search_articles
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
