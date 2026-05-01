import { z } from 'zod';

const TS_HOST = 'z1jtlbof42i8dqg0p.a1.typesense.net';
const TS_COLLECTION = 'wp_images';

function getApiKey() {
  const key = process.env.TYPESENSE_SEARCH_API_KEY;
  if (!key) throw new Error('TYPESENSE_SEARCH_API_KEY is not set');
  return key;
}

function fixUrl(url: string | undefined): string {
  return (url || '').replace('cdn.essentiallysports.com', 'image-cdn.essentiallysports.com');
}

export const searchImagesSchema = z.object({
  query: z.string().min(1).describe(
    'Natural language search query. Examples: "LeBron James dunk", "Roger Federer Wimbledon 2023", "Patrick Mahomes Super Bowl"'
  ),
  per_page: z.number().int().min(1).max(50).default(10).describe(
    'Number of results to return (1–50, default 10)'
  ),
  page: z.number().int().min(1).default(1).describe(
    'Page number for pagination (default 1)'
  ),
  type: z.enum(['all', 'agency', 'custom']).default('all').describe(
    '"agency" for licensed photos (Getty, IMAGO, Imagn, AP), "custom" for ES-produced images, "all" for both'
  ),
});

export type SearchImagesInput = z.infer<typeof searchImagesSchema>;

export interface ImageResult {
  id: string;
  wp_id: number;
  image_type: 'agency' | 'custom';
  image_url: string;
  thumb_url?: string;
  title?: string;
  alt_text?: string;
  exif_caption?: string;
  exif_credit?: string;
  folder_names?: string[];
  file_path?: string;
  post_date_ts: number;
}

export interface SearchImagesResult {
  found: number;
  page: number;
  total_pages: number;
  images: ImageResult[];
}

export async function searchImages(input: SearchImagesInput): Promise<SearchImagesResult> {
  const { query, per_page, page, type } = input;

  const filters: string[] = [];
  if (type !== 'all') filters.push(`image_type:=${type}`);

  const params = new URLSearchParams({
    q: query.trim(),
    query_by: 'title,alt_text,exif_caption,keywords',
    query_by_weights: '4,4,3,2',
    sort_by: '_text_match:desc,post_date_ts:desc',
    per_page: String(per_page),
    page: String(page),
    include_fields: 'id,wp_id,title,alt_text,exif_caption,exif_credit,folder_names,image_type,image_url,thumb_url,file_path,post_date_ts',
    highlight_full_fields: 'title,alt_text,exif_caption',
    ...(filters.length ? { filter_by: filters.join(' && ') } : {}),
  });

  const response = await fetch(
    `https://${TS_HOST}/collections/${TS_COLLECTION}/documents/search?${params}`,
    {
      headers: { 'X-TYPESENSE-API-KEY': getApiKey() },
      signal: AbortSignal.timeout(8000),
    }
  );

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Typesense error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const total_pages = Math.ceil((data.found || 0) / per_page);

  const images: ImageResult[] = (data.hits || []).map((hit: { document: ImageResult }) => {
    const doc = hit.document;
    return {
      ...doc,
      image_url: fixUrl(doc.image_url),
      thumb_url: doc.thumb_url ? fixUrl(doc.thumb_url) : undefined,
    };
  });

  return {
    found: data.found || 0,
    page: data.page || page,
    total_pages,
    images,
  };
}
