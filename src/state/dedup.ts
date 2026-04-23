import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

interface DedupRecord {
  id: string;
  /** ISO timestamp when first seen */
  seenAt: string;
  /** Normalized URL (lowercased host, stripped tracking params, trailing slash). */
  urlNorm?: string;
  /** Lowercased, stopword-stripped title tokens, kept for similarity comparison. */
  titleTokens?: string[];
}

interface DedupFile {
  records: DedupRecord[];
}

interface ItemLike {
  id: string;
  url?: string;
  title: string;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'in', 'on', 'to', 'for',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'do', 'does', 'did',
  'with', 'from', 'as', 'at', 'by', 'about', 'into', 'over', 'under',
  'how', 'why', 'what', 'when', 'where', 'who', 'which',
  'this', 'that', 'these', 'those', 'it', 'its',
  'i', 'we', 'you', 'they', 'he', 'she', 'them', 'us',
  'show', 'hn', 'ask', // HN-specific noise
]);

const TRACKING_PARAMS = new Set([
  'ref', 'ref_src', 'source', 'fbclid', 'gclid',
  'mc_cid', 'mc_eid', 'igshid', 'spm',
]);

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, '');
    const params = new URLSearchParams();
    const sortedKeys = [...u.searchParams.keys()].sort();
    for (const k of sortedKeys) {
      const lower = k.toLowerCase();
      if (lower.startsWith('utm_') || TRACKING_PARAMS.has(lower)) continue;
      const v = u.searchParams.get(k);
      if (v !== null) params.append(k, v);
    }
    const path = (u.pathname || '/').replace(/\/+$/, '') || '/';
    const qs = params.toString();
    return `${u.protocol}//${u.hostname}${path}${qs ? '?' + qs : ''}`;
  } catch {
    return url.toLowerCase().trim();
  }
}

export function tokenizeTitle(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 2 && !STOPWORDS.has(w));
}

export function jaccardSimilarity(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const w of a) if (b.has(w)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface DedupOptions {
  /** Title Jaccard similarity above which items are considered duplicates. Default 0.7. */
  titleSimilarityThreshold?: number;
}

export interface DedupStats {
  /** Blocked because exact id was seen previously. */
  blockedById: number;
  /** Blocked because normalized URL was seen previously. */
  blockedByUrl: number;
  /** Blocked because title is highly similar to a previously seen title. */
  blockedByTitle: number;
  /** Blocked because url/title duplicates a peer accepted earlier in the same batch. */
  blockedInBatch: number;
}

interface FilterResult<T> {
  kept: T[];
  stats: DedupStats;
}

export class DedupStore {
  private byId = new Map<string, DedupRecord>();
  private byUrl = new Map<string, DedupRecord>();
  /** Title token sets cached for similarity comparison. */
  private titleSets: { id: string; tokens: Set<string> }[] = [];

  private readonly threshold: number;

  constructor(
    private readonly filePath: string,
    private readonly retentionDays = 30,
    options: DedupOptions = {},
  ) {
    this.threshold = options.titleSimilarityThreshold ?? 0.7;
    this.load();
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  /**
   * Filter incoming items against persistent state AND within this batch.
   * Returns kept items plus reason-coded stats for logging.
   */
  filterUnseen<T extends ItemLike>(items: T[]): FilterResult<T> {
    const stats: DedupStats = {
      blockedById: 0,
      blockedByUrl: 0,
      blockedByTitle: 0,
      blockedInBatch: 0,
    };
    const kept: T[] = [];
    const acceptedUrls = new Set<string>();
    const acceptedTitleSets: Set<string>[] = [];

    for (const item of items) {
      if (this.byId.has(item.id)) {
        stats.blockedById++;
        continue;
      }
      const urlNorm = item.url ? normalizeUrl(item.url) : undefined;
      if (urlNorm && this.byUrl.has(urlNorm)) {
        stats.blockedByUrl++;
        continue;
      }
      if (urlNorm && acceptedUrls.has(urlNorm)) {
        stats.blockedInBatch++;
        continue;
      }

      const tokens = new Set(tokenizeTitle(item.title));
      let blocked = false;

      if (tokens.size > 0) {
        for (const stored of this.titleSets) {
          if (jaccardSimilarity(tokens, stored.tokens) >= this.threshold) {
            stats.blockedByTitle++;
            blocked = true;
            break;
          }
        }
        if (!blocked) {
          for (const accepted of acceptedTitleSets) {
            if (jaccardSimilarity(tokens, accepted) >= this.threshold) {
              stats.blockedInBatch++;
              blocked = true;
              break;
            }
          }
        }
      }
      if (blocked) continue;

      kept.push(item);
      if (urlNorm) acceptedUrls.add(urlNorm);
      if (tokens.size > 0) acceptedTitleSets.push(tokens);
    }

    return { kept, stats };
  }

  markSeen<T extends ItemLike>(items: T[]): void {
    const now = new Date().toISOString();
    for (const it of items) {
      if (this.byId.has(it.id)) continue;
      const urlNorm = it.url ? normalizeUrl(it.url) : undefined;
      const tokens = tokenizeTitle(it.title);
      const rec: DedupRecord = { id: it.id, seenAt: now };
      if (urlNorm) rec.urlNorm = urlNorm;
      if (tokens.length > 0) rec.titleTokens = tokens;
      this.byId.set(it.id, rec);
      if (urlNorm) this.byUrl.set(urlNorm, rec);
      if (tokens.length > 0) this.titleSets.push({ id: it.id, tokens: new Set(tokens) });
    }
  }

  save(): void {
    this.evictOld();
    mkdirSync(dirname(this.filePath), { recursive: true });
    const file: DedupFile = { records: [...this.byId.values()] };
    // Atomic write: tmp file + rename. POSIX rename is atomic, so a crash mid-write
    // can never leave the live file half-written.
    const tmpPath = `${this.filePath}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(file, null, 2), 'utf8');
    renameSync(tmpPath, this.filePath);
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed: DedupFile = JSON.parse(raw);
      for (const r of parsed.records ?? []) {
        this.byId.set(r.id, r);
        if (r.urlNorm) this.byUrl.set(r.urlNorm, r);
        if (r.titleTokens && r.titleTokens.length > 0) {
          this.titleSets.push({ id: r.id, tokens: new Set(r.titleTokens) });
        }
      }
    } catch {
      // corrupt -> start fresh
    }
  }

  private evictOld(): void {
    const cutoff = Date.now() - this.retentionDays * 86_400_000;
    for (const [id, rec] of this.byId) {
      if (new Date(rec.seenAt).getTime() < cutoff) {
        this.byId.delete(id);
        if (rec.urlNorm) this.byUrl.delete(rec.urlNorm);
      }
    }
    this.titleSets = this.titleSets.filter((t) => this.byId.has(t.id));
  }
}
