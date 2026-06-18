import Anthropic from '@anthropic-ai/sdk';
import { ProviderAuthError, ProviderError } from '../types.js';
import type { Provider, ProviderTurn, AgentTool } from '../types.js';

export const DEFAULT_MODEL = 'claude-3-5-sonnet-latest';

export class AnthropicProvider implements Provider {
  name = 'anthropic';
  private client: Anthropic;

  constructor(apiKey = process.env.ANTHROPIC_API_KEY) {
    if (!apiKey) throw new ProviderAuthError('Set ANTHROPIC_API_KEY to use the Anthropic provider.');
    this.client = new Anthropic({ apiKey });
  }

  async complete(messages: any[], tools: AgentTool[], model = DEFAULT_MODEL): Promise<ProviderTurn> {
    try {
      const resp = await this.client.messages.create({
        model, max_tokens: 4096, messages,
        tools: tools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema as any })),
      });
      const toolCalls = resp.content
        .filter((b: any) => b.type === 'tool_use')
        .map((b: any) => ({ id: b.id, name: b.name, input: b.input }));
      const text = resp.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('\n');
      return { toolCalls: toolCalls.length ? toolCalls : undefined, text: text || undefined };
    } catch (err: any) {
      throw new ProviderError(err?.message ?? 'Anthropic request failed');
    }
  }
}
