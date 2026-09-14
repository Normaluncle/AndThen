import type { OfficialCandidate } from '../../db/schema.js';
import type { ImportSourceInput } from '../sources/service.js';

/**
 * The official search payload carries an *edit* time, not a publication date.
 * `upstream_updated_at` is therefore stored as-is, while `published_at` stays
 * null until the author declares the original date themselves — inferring it
 * from the edit time would put a fabricated date on the story card.
 */
export function resolveImportInput(url: string, match: OfficialCandidate | undefined): ImportSourceInput {
  return {
    sourceType: 'third_party_link',
    originalUrl: url,
    originalAccountRef: null,
    title: match?.title ?? null,
    materialLevel: 'api_summary',
    body: match?.text ?? null,
    excerpt: null,
    excerptLocation: null,
    publishedAt: null,
    upstreamUpdatedAt: match?.upstream_updated_at ? new Date(match.upstream_updated_at) : null,
    notes: 'Official exact URL resolution; ownership not established',
    provenance: 'official_api',
  };
}
