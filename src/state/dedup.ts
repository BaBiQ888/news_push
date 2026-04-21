import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

interface DedupRecord {
  id: string;
  /** ISO timestamp when first seen */
  seenAt: string;
}

interface DedupFile {
  records: DedupRecord[];
}

export class DedupStore {
  private records = new Map<string, DedupRecord>();

  constructor(
    private readonly filePath: string,
    private readonly retentionDays = 30,
  ) {
    this.load();
  }

  has(id: string): boolean {
    return this.records.has(id);
  }

  filterUnseen<T extends { id: string }>(items: T[]): T[] {
    return items.filter((it) => !this.records.has(it.id));
  }

  markSeen(ids: string[]): void {
    const now = new Date().toISOString();
    for (const id of ids) {
      if (!this.records.has(id)) {
        this.records.set(id, { id, seenAt: now });
      }
    }
  }

  save(): void {
    this.evictOld();
    mkdirSync(dirname(this.filePath), { recursive: true });
    const file: DedupFile = { records: [...this.records.values()] };
    writeFileSync(this.filePath, JSON.stringify(file, null, 2), 'utf8');
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      const raw = readFileSync(this.filePath, 'utf8');
      const parsed: DedupFile = JSON.parse(raw);
      for (const r of parsed.records ?? []) {
        this.records.set(r.id, r);
      }
    } catch {
      // corrupt file -> start fresh
    }
  }

  private evictOld(): void {
    const cutoff = Date.now() - this.retentionDays * 86_400_000;
    for (const [id, rec] of this.records) {
      if (new Date(rec.seenAt).getTime() < cutoff) {
        this.records.delete(id);
      }
    }
  }
}
