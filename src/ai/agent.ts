import { ProviderLoopError } from '../types.js';
import type { AIProvider, Provider, GenerateReviewInput, GeneratedReview, ReviewIssue } from '../types.js';

const MAX_TURNS = 8;

const SYSTEM = `You are Sentinel, a concise senior code reviewer.
Use the query_knowledge_base tool to check repo-specific rules/constraints before judging the diff.
Be terse and high-signal. Output ONLY a JSON object when done (no prose), matching:
{ "summary": string, "markdown": string, "issues": [ { "severity": "blocking"|"warning"|"suggestion"|"note",
  "category"?: string, "file"?: string, "location"?: string, "message": string, "status": "open"|"resolved" } ] }
"markdown" is the human-facing review body. On re-review, set status:"resolved" for prior issues that the new diff fixes.`;

export class AIProviderImpl implements AIProvider {
  constructor(private provider: Provider) {}

  async generateReview(input: GenerateReviewInput): Promise<GeneratedReview> {
    const userParts = [
      `PR #${input.pr.number}: ${input.pr.title}`,
      `Goal (from description):\n${input.pr.body || '(none)'}`,
      input.priorIssues?.length
        ? `Prior issues (reviewed at ${input.priorReviewedSha?.slice(0, 7)}); classify each resolved/open:\n${JSON.stringify(input.priorIssues, null, 2)}`
        : '',
      `Changed files: ${input.changedFiles.map(f => f.path).join(', ')}`,
      `Unified diff:\n${input.diff}`,
    ].filter(Boolean).join('\n\n');

    const messages: any[] = [
      { role: 'user', content: `${SYSTEM}\n\n${userParts}` },
    ];

    const toolByName = new Map(input.tools.map(t => [t.name, t]));

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const res = await this.provider.complete(messages, input.tools, input.model);

      if (res.toolCalls?.length) {
        // Echo assistant tool_use turn, then provide tool results.
        messages.push({ role: 'assistant', content: res.toolCalls.map(tc => ({
          type: 'tool_use', id: tc.id, name: tc.name, input: tc.input })) });
        const results = [];
        for (const tc of res.toolCalls) {
          const tool = toolByName.get(tc.name);
          const out = tool ? await tool.handler(tc.input) : `Unknown tool ${tc.name}`;
          results.push({ type: 'tool_result', tool_use_id: tc.id, content: String(out) });
        }
        messages.push({ role: 'user', content: results });
        continue;
      }

      // No tool calls → expect final JSON.
      const parsed = extractJson(res.text ?? '');
      if (parsed) {
        return {
          markdown: parsed.markdown ?? '(no review body)',
          summary: parsed.summary ?? '',
          issues: (parsed.issues ?? []) as ReviewIssue[],
        };
      }
      // If not valid JSON, nudge once more by asking for JSON.
      messages.push({ role: 'assistant', content: res.text ?? '' });
      messages.push({ role: 'user', content: 'Respond ONLY with the JSON object described.' });
    }
    throw new ProviderLoopError(`Agent exceeded ${MAX_TURNS} turns without producing a review.`);
  }
}

export function extractJson(text: string): any | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1] : text;
  const start = raw.indexOf('{'); const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}
