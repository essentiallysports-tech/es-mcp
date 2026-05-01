import { createMcpHandler } from '@vercel/mcp-adapter';
import { searchImages, searchImagesSchema } from '@/tools/search-images';

const handler = createMcpHandler(
  (server) => {
    server.tool(
      'search_images',
      [
        'Search the EssentiallySports media library (~5M+ sports images).',
        'Returns image URLs, alt text, EXIF captions, photographer credits, and folder tags.',
        'Agency images (Getty, IMAGO, Imagn, AP Photo) have rich captions and photographer credits.',
        'Custom images have descriptive alt text and filename-derived keywords.',
        'Results are ranked by relevance then recency.',
      ].join(' '),
      searchImagesSchema.shape,
      async (input) => {
        const parsed = searchImagesSchema.parse(input);
        const result = await searchImages(parsed);

        if (result.images.length === 0) {
          return {
            content: [{
              type: 'text',
              text: `No images found for "${parsed.query}"${parsed.type !== 'all' ? ` (filtered to ${parsed.type} only)` : ''}.`,
            }],
          };
        }

        const lines: string[] = [
          `Found ${result.found.toLocaleString()} image${result.found !== 1 ? 's' : ''} for "${parsed.query}" · page ${result.page} of ${result.total_pages}`,
          '',
        ];

        for (const img of result.images) {
          lines.push(`## ${img.title || img.alt_text || img.file_path?.split('/').pop() || `Image #${img.wp_id}`}`);
          lines.push(`**Type:** ${img.image_type.toUpperCase()}`);
          lines.push(`**URL:** ${img.image_url}`);
          if (img.thumb_url) lines.push(`**Thumbnail:** ${img.thumb_url}`);
          if (img.alt_text) lines.push(`**Alt text:** ${img.alt_text}`);
          if (img.exif_caption) lines.push(`**Caption:** ${img.exif_caption}`);
          if (img.exif_credit) lines.push(`**Credit:** ${img.exif_credit}`);
          if (img.folder_names?.length) lines.push(`**Folders:** ${img.folder_names.join(', ')}`);
          lines.push('');
        }

        return {
          content: [{ type: 'text', text: lines.join('\n') }],
        };
      }
    );

    // Future tools go here:
    // server.tool('list_articles', ...)
    // server.tool('get_article', ...)
    // server.tool('search_articles', ...)
  },
  {
    capabilities: {
      tools: {},
    },
  },
  {
    maxDuration: 60,
    verboseLogs: false,
  }
);

export { handler as GET, handler as POST, handler as DELETE };
