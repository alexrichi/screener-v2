import { getToolName, isToolUIPart, type UIMessage } from 'ai';
import type { ChatModelRunResult } from '@assistant-ui/react';

type AssistantPart = NonNullable<ChatModelRunResult['content']>[number];

/**
 * The AI SDK already parses a multi-step run into UIMessage parts (text,
 * reasoning, tool calls). This maps them to assistant-ui's content, so the kit
 * renders reasoning collapsed and tools as their cards instead of us rebuilding
 * the stream by hand.
 */
export function uiPartsToAssistant(parts: UIMessage['parts']): AssistantPart[] {
  const out: AssistantPart[] = [];
  const lastTool = parts.reduce(
    (last, part, index) => (isToolUIPart(part) ? index : last),
    -1,
  );
  for (const [index, part] of parts.entries()) {
    if (part.type === 'text') {
      // Text before the last tool call is step narration ("смотрю код…").
      // The kit collapses it as a Thought; the answer is the text after the
      // final tool and stays visible.
      const narration = lastTool >= 0 && index < lastTool;
      out.push({ type: narration ? 'reasoning' : 'text', text: part.text } as AssistantPart);
    } else if (part.type === 'reasoning') {
      out.push({ type: 'reasoning', text: part.text } as AssistantPart);
    } else if (isToolUIPart(part)) {
      const result =
        part.state === 'output-available'
          ? part.output
          : part.state === 'output-error'
            ? { error: part.errorText }
            : undefined;
      out.push({
        type: 'tool-call',
        toolCallId: part.toolCallId,
        toolName: getToolName(part),
        args: part.input,
        argsText: JSON.stringify(part.input ?? {}),
        ...(result !== undefined ? { result } : {}),
      } as unknown as AssistantPart);
    }
  }
  return out;
}
