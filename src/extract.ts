import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { KBEntry, PullRequest } from './types.js';

const DOC_FILES = ['README.md', 'AGENTS.md', 'CONTRIBUTING.md', '.sentinel/rules.md'];

// MVP heuristic extraction: capture explicit constraint-like lines + always
// store full docs as 'rule' context. The AI refines via the KB tool at review time.
export function extractRepoEntries(root = process.cwd()): { entries: KBEntry[]; filesRead: string[] } {
  const entries: KBEntry[] = [];
  const filesRead: string[] = [];

  for (const rel of DOC_FILES) {
    const path = join(root, rel);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, 'utf8');
    filesRead.push(rel);

    // Whole-doc context entry (rule).
    entries.push({ category: 'rule', subject: rel, content: truncate(text, 4000), source: rel });

    // Explicit constraint patterns: lines screaming "do not", "never", "must not", "don't touch".
    for (const line of text.split('\n')) {
      if (/\b(do not|don'?t|never|must not|forbidden|do not touch|read[- ]?only)\b/i.test(line)) {
        const clean = line.replace(/^[#>*\-\s]+/, '').trim();
        if (clean.length > 8) entries.push({ category: 'constraint', subject: rel, content: clean, source: rel });
      }
    }
  }
  return { entries, filesRead };
}

// PR goal → 'goal' entry ("reason to be").
export function extractPrGoal(pr: PullRequest): KBEntry {
  const content = `Title: ${pr.title}\n\n${pr.body || '(no description provided)'}`;
  return { category: 'goal', subject: 'pr-intent', content: truncate(content, 3000), source: 'PR' };
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '\n…(truncated)' : s;
}
