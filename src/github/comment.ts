import type { ReviewIssue } from '../types.js';

export const MARKER = '<!-- sentinel-review:v1 -->';

// Machine-readable block embedded in the comment so re-reviews can recover
// prior issues + the last reviewed SHA (OQ-1 + OQ-2). Hidden inside HTML comment.
export interface CommentMeta { reviewedSha: string; issues: ReviewIssue[]; }

export function buildCommentBody(markdown: string, reviewedSha: string, issues: ReviewIssue[]): string {
  const meta: CommentMeta = { reviewedSha, issues };
  const metaBlock = `<!-- sentinel-meta:${Buffer.from(JSON.stringify(meta)).toString('base64')} -->`;
  return `${MARKER}\n${markdown}\n\n---\n*Reviewed by Sentinel · commit \`${reviewedSha.slice(0, 7)}\`*\n${metaBlock}`;
}

export function parseCommentBody(body: string): CommentMeta | null {
  const m = body.match(/<!-- sentinel-meta:([A-Za-z0-9+/=]+) -->/);
  if (!m) return null;
  try { return JSON.parse(Buffer.from(m[1], 'base64').toString('utf8')); }
  catch { return null; }
}

export function hasMarker(body: string): boolean {
  return body.includes(MARKER);
}
