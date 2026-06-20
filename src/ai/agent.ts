import { ProviderLoopError } from '../types.js';
import type {
  AIProvider, Provider, GenerateReviewInput, GeneratedReview, ReviewIssue,
  CalibrationInput, CalibrationResult, CalibrationRule,
} from '../types.js';

const MAX_TURNS = 8;

const OUTPUT_SHAPE = `Output ONLY a JSON object when done (no prose), matching:
{ "summary": string, "markdown": string, "issues": [ { "severity": "blocking"|"warning"|"suggestion"|"note",
  "category"?: string, "file"?: string, "location"?: string, "message": string, "status": "open"|"resolved" } ] }
"markdown" is the human-facing review body.`;

const SYSTEM = `You are Sentinel, a concise senior code reviewer.
Use the query_knowledge_base tool to check repo-specific rules/constraints before judging the diff.
Be terse and high-signal. ${OUTPUT_SHAPE}
On re-review, set status:"resolved" for prior issues that the new diff fixes.
IMPORTANT: Reviewer guidance is authoritative and OVERRIDES repo-derived rules/constraints. If the guidance
says to ignore or stop flagging something, you MUST NOT raise it as an issue, even if a repo rule suggests otherwise.`;

// Lighter prompt used on second passes (regenerate / resume-after-failure).
// The model EDITS an existing draft instead of re-deriving from scratch, and the
// repo rules are pre-supplied inline so no tool calls are needed — this keeps the
// turn count low and avoids exhausting MAX_TURNS.
const EDIT_SYSTEM = `You are Sentinel, a concise senior code reviewer refining an EXISTING review.
Do not start over — adjust the prior review to satisfy the reviewer guidance and the rules below.
Be terse and high-signal. ${OUTPUT_SHAPE}
Set status:"resolved" for prior issues the new diff fixes.
IMPORTANT: Reviewer guidance is authoritative and OVERRIDES repo-derived rules/constraints. If the guidance
says to ignore or stop flagging something, you MUST NOT raise it as an issue, even if a repo rule suggests otherwise.`;

const CALIBRATE_SYSTEM = `You are Sentinel's calibration assistant. The reviewer is correcting the previous review.
Their instruction is AUTHORITATIVE and overrides repo-derived rules. Decide the effective rule set for the next pass.
Reflect the instruction back so the reviewer can confirm you understood it. If they ask to ignore/stop flagging
something, mark that rule directive:"ignore". Output ONLY a JSON object (no prose), matching:
{ "acknowledgement": string, "rules": [ { "directive": "enforce"|"ignore", "rule": string } ] }
"acknowledgement" is a short plain-language confirmation of what will change. "rules" is the explicit set you will
apply next pass — include rules you are now ignoring (directive:"ignore") so the reviewer sees them dropped.`;

export class AIProviderImpl implements AIProvider {
  constructor(private provider: Provider) {}

  async generateReview(input: GenerateReviewInput): Promise<GeneratedReview> {
    // Second pass when we have a draft to refine and/or rules pre-supplied inline.
    // In edit-mode we don't offer the KB tool (the rules are already in the prompt),
    // which keeps the loop to 1-2 turns and avoids exhausting MAX_TURNS.
    const editMode = Boolean(input.priorReview);
    const usePreloadedKB = Boolean(input.preloadedKB);

    const userParts = [
      `PR #${input.pr.number}: ${input.pr.title}`,
      `Goal (from description):\n${input.pr.body || '(none)'}`,
      input.guidance
        ? `Reviewer guidance (follow this closely; it may calibrate or override defaults):\n${input.guidance}`
        : '',
      usePreloadedKB
        ? `Repo rules/constraints already in effect (do not query for these):\n${input.preloadedKB}`
        : '',
      input.priorReview
        ? `Prior review draft to refine (adjust this — do not start over):\n${input.priorReview}`
        : '',
      input.priorIssues?.length
        ? `Prior issues (reviewed at ${input.priorReviewedSha?.slice(0, 7)}); classify each resolved/open:\n${JSON.stringify(input.priorIssues, null, 2)}`
        : '',
      `Changed files: ${input.changedFiles.map(f => f.path).join(', ')}`,
      `Unified diff:\n${input.diff}`,
    ].filter(Boolean).join('\n\n');

    const system = editMode ? EDIT_SYSTEM : SYSTEM;
    const messages: any[] = [
      { role: 'user', content: `${system}\n\n${userParts}` },
    ];

    // When KB is pre-loaded we withhold the tool so the model can't spend turns
    // querying; otherwise the agent may selectively query as before.
    const tools = usePreloadedKB ? [] : input.tools;
    const toolByName = new Map(tools.map(t => [t.name, t]));

    // Track the best textual response we see so we can salvage a partial draft
    // if we run out of turns instead of throwing away all the work.
    let lastText: string | undefined;

    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const res = await this.provider.complete(messages, tools, input.model);
      if (res.text) lastText = res.text;

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

    // Turn limit reached. Salvage whatever text we last saw as a *partial* draft
    // so the orchestrator can persist it and a resumed run can finish it cheaply.
    const salvaged = salvagePartial(lastText);
    if (salvaged) return { ...salvaged, partial: true };
    throw new ProviderLoopError(`Agent exceeded ${MAX_TURNS} turns without producing a review.`);
  }


  async calibrate(input: CalibrationInput): Promise<CalibrationResult> {
    const rulesList = input.rules.length
      ? input.rules.map(r => `- [${r.category}${r.subject ? `:${r.subject}` : ''}] ${r.content}`).join('\n')
      : '(no explicit repo rules extracted)';

    const userParts = [
      `PR #${input.pr.number}: ${input.pr.title}`,
      `Current rules/constraints in effect:\n${rulesList}`,
      input.priorIssues?.length
        ? `Issues raised in the last review:\n${JSON.stringify(input.priorIssues, null, 2)}`
        : '',
      `Reviewer's correction (authoritative):\n${input.message}`,
    ].filter(Boolean).join('\n\n');

    const messages: any[] = [
      { role: 'user', content: `${CALIBRATE_SYSTEM}\n\n${userParts}` },
    ];

    // Calibration is a single, tool-free turn; nudge once if JSON is malformed.
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.provider.complete(messages, [], input.model);
      const parsed = extractJson(res.text ?? '');
      if (parsed) {
        const rules: CalibrationRule[] = Array.isArray(parsed.rules)
          ? parsed.rules
              .filter((r: any) => r && typeof r.rule === 'string')
              .map((r: any) => ({
                directive: r.directive === 'ignore' ? 'ignore' : 'enforce',
                rule: String(r.rule),
              }))
          : [];
        return {
          acknowledgement: typeof parsed.acknowledgement === 'string'
            ? parsed.acknowledgement
            : 'Understood — applying your changes on the next pass.',
          rules,
        };
      }
      messages.push({ role: 'assistant', content: res.text ?? '' });
      messages.push({ role: 'user', content: 'Respond ONLY with the JSON object described.' });
    }
    // Graceful fallback: still let the regenerate proceed even if parsing failed.
    return {
      acknowledgement: 'Understood — applying your changes on the next pass.',
      rules: [{ directive: 'enforce', rule: input.message }],
    };
  }
}


export function extractJson(text: string): any | null {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1] : text;
  const start = raw.indexOf('{'); const end = raw.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return null; }
}

// Best-effort recovery of a usable review from the model's last (non-JSON) text
// when we hit the turn limit. Prefers valid/partial JSON; otherwise treats the
// raw text as the markdown body. Returns null only when there's nothing at all.
export function salvagePartial(text: string | undefined): Omit<GeneratedReview, 'partial'> | null {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return null;
  const parsed = extractJson(trimmed);
  if (parsed && (parsed.markdown || parsed.summary || parsed.issues)) {
    return {
      markdown: parsed.markdown ?? trimmed,
      summary: parsed.summary ?? '',
      issues: Array.isArray(parsed.issues) ? (parsed.issues as ReviewIssue[]) : [],
    };
  }
  // No parseable JSON — keep the prose so a resumed run can finish formatting it.
  return { markdown: trimmed, summary: '', issues: [] };
}

