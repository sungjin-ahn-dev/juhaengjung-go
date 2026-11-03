/** Node 전용 SQLite 저장소 (node:sqlite) — 문서형 테이블 하나. 쓰기는 BEGIN IMMEDIATE 트랜잭션. */
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Collection, Store } from "./infra.ts";

// vite/vitest가 "node:sqlite"를 "sqlite"로 바꿔 버리는 문제를 피해 require로 불러온다
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
type DatabaseSync = InstanceType<typeof DatabaseSync>;

export class SqliteStore implements Store {
  private db: DatabaseSync;
  private depth = 0;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
    this.db.exec("CREATE TABLE IF NOT EXISTS docs (col TEXT NOT NULL, id TEXT NOT NULL, json TEXT NOT NULL, PRIMARY KEY (col, id))");
  }

  get<T>(col: Collection, id: string): T | undefined {
    const row = this.db.prepare("SELECT json FROM docs WHERE col = ? AND id = ?").get(col, id) as { json: string } | undefined;
    return row ? (JSON.parse(row.json) as T) : undefined;
  }

  put<T extends { id: string }>(col: Collection, doc: T): T {
    this.db.prepare("INSERT INTO docs (col, id, json) VALUES (?, ?, ?) ON CONFLICT(col, id) DO UPDATE SET json = excluded.json").run(col, doc.id, JSON.stringify(doc));
    return doc;
  }

  list<T>(col: Collection, pred?: (d: T) => boolean): T[] {
    const rows = this.db.prepare("SELECT json FROM docs WHERE col = ?").all(col) as { json: string }[];
    const out: T[] = [];
    for (const r of rows) {
      const d = JSON.parse(r.json) as T;
      if (!pred || pred(d)) out.push(d);
    }
    return out;
  }

  remove(col: Collection, id: string): void {
    this.db.prepare("DELETE FROM docs WHERE col = ? AND id = ?").run(col, id);
  }

  tx<R>(fn: () => R): R {
    if (this.depth > 0) return fn();
    this.db.exec("BEGIN IMMEDIATE");
    this.depth++;
    try {
      const r = fn();
      this.db.exec("COMMIT");
      return r;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    } finally {
      this.depth--;
    }
  }

  clear(): void {
    this.db.exec("DELETE FROM docs WHERE col != 'config'");
  }
}
