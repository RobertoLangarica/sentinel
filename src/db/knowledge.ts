import type Database from 'better-sqlite3';
import type { KnowledgeBase, KBEntry, KBQuery, KBCategory, AgentTool } from '../types.js';
import { ValidationError } from '../types.js';

const CATEGORIES: KBCategory[] = ['constraint', 'pattern', 'rule', 'goal'];

export class KnowledgeBaseImpl implements KnowledgeBase {
  constructor(private db: Database.Database) {}

  addEntry(runId: string, e: KBEntry): void {
    this.db.prepare(
      `INSERT INTO kb_entry (run_id, category, subject, content, source, weight)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(runId, e.category, e.subject ?? null, e.content, e.source ?? null, e.weight ?? 1);
  }

  addEntries(runId: string, entries: KBEntry[]): void {
    const tx = this.db.transaction((rows: KBEntry[]) => rows.forEach(r => this.addEntry(runId, r)));
    tx(entries);
  }

  // Strengthen an existing matching entry (same category+content) or insert.
  reinforce(runId: string, e: KBEntry): void {
    const existing: any = this.db.prepare(
      `SELECT id, weight FROM kb_entry WHERE run_id = ? AND category = ? AND content = ?`
    ).get(runId, e.category, e.content);
    if (existing) {
      this.db.prepare(`UPDATE kb_entry SET weight = weight + 1 WHERE id = ?`).run(existing.id);
    } else {
      this.addEntry(runId, { ...e, source: e.source ?? 'user-guidance' });
    }
  }

  query(runId: string, q: KBQuery): KBEntry[] {
    if (q.category && !CATEGORIES.includes(q.category)) throw new ValidationError(`Bad category ${q.category}`);
    const clauses = ['run_id = ?']; const params: any[] = [runId];
    if (q.category) { clauses.push('category = ?'); params.push(q.category); }
    if (q.keyword) {
      clauses.push('(subject LIKE ? OR content LIKE ?)');
      params.push(`%${q.keyword}%`, `%${q.keyword}%`);
    }
    const rows: any[] = this.db.prepare(
      `SELECT * FROM kb_entry WHERE ${clauses.join(' AND ')} ORDER BY weight DESC LIMIT ?`
    ).all(...params, q.limit ?? 20);
    return rows.map(toEntry);
  }

  all(runId: string): KBEntry[] {
    return (this.db.prepare(`SELECT * FROM kb_entry WHERE run_id = ? ORDER BY category, weight DESC`)
      .all(runId) as any[]).map(toEntry);
  }

  getQueryTool(runId: string): AgentTool {
    return {
      name: 'query_knowledge_base',
      description:
        'Query the learned repository knowledge (rules, constraints, patterns, goals). ' +
        'Use this to check repo-specific constraints before commenting on the diff.',
      inputSchema: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: CATEGORIES, description: 'Optional category filter' },
          keyword: { type: 'string', description: 'Optional keyword to match subject/content' },
        },
      },
      handler: (input: { category?: KBCategory; keyword?: string }) => {
        const results = this.query(runId, { category: input?.category, keyword: input?.keyword });
        if (results.length === 0) return 'No matching knowledge entries.';
        return results.map(r => `- [${r.category}${r.subject ? `:${r.subject}` : ''}] ${r.content}`).join('\n');
      },
    };
  }
}

function toEntry(r: any): KBEntry {
  return { id: r.id, category: r.category, subject: r.subject ?? undefined,
    content: r.content, source: r.source ?? undefined, weight: r.weight };
}
