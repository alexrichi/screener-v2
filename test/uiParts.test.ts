import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { uiPartsToAssistant } from '../src/lib/ai/uiParts';

function parts(values: unknown[]): UIMessage['parts'] {
  return values as UIMessage['parts'];
}

describe('uiPartsToAssistant', () => {
  it('turns step narration into reasoning and keeps the answer after the last tool', () => {
    const out = uiPartsToAssistant(
      parts([
        { type: 'text', text: 'Смотрю код.' },
        { type: 'reasoning', text: 'Ищу FVG.' },
        {
          type: 'tool-get_script',
          toolCallId: 'call-1',
          state: 'output-available',
          input: { from: 1 },
          output: { chars: 10 },
        },
        { type: 'text', text: 'Готово.' },
      ]),
    );

    expect(out).toEqual([
      { type: 'reasoning', text: 'Смотрю код.' },
      { type: 'reasoning', text: 'Ищу FVG.' },
      {
        type: 'tool-call',
        toolCallId: 'call-1',
        toolName: 'get_script',
        args: { from: 1 },
        argsText: '{"from":1}',
        result: { chars: 10 },
      },
      { type: 'text', text: 'Готово.' },
    ]);
  });

  it('keeps text when the run had no tools', () => {
    expect(
      uiPartsToAssistant(
        parts([
          { type: 'text', text: 'Первый абзац.' },
          { type: 'text', text: 'Второй абзац.' },
        ]),
      ),
    ).toEqual([
      { type: 'text', text: 'Первый абзац.' },
      { type: 'text', text: 'Второй абзац.' },
    ]);
  });

  it('turns a failed tool part into an error result', () => {
    const [tool] = uiPartsToAssistant(
      parts([
        {
          type: 'tool-run_script',
          toolCallId: 'call-2',
          state: 'output-error',
          input: { source: 'x' },
          errorText: 'boom',
        },
      ]),
    );

    expect(tool).toMatchObject({
      type: 'tool-call',
      toolName: 'run_script',
      result: { error: 'boom' },
    });
  });

  it('skips parts the kit does not render', () => {
    expect(
      uiPartsToAssistant(
        parts([
          { type: 'source-url', sourceId: 's', url: 'https://example.com', title: 'x' },
          { type: 'text', text: 'answer' },
        ]),
      ),
    ).toEqual([{ type: 'text', text: 'answer' }]);
  });
});
