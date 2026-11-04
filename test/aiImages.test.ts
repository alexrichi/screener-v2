import { describe, expect, it } from 'vitest';
import type { UIMessage } from 'ai';
import { withChartImage } from '../src/lib/ai/chatImages';

function message(role: 'user' | 'assistant', parts: unknown[]): UIMessage {
  return { id: `${role}-${parts.length}`, role, parts } as unknown as UIMessage;
}

const text = { type: 'text', text: 'hello' };
const image = (url: string) => ({ type: 'file', mediaType: 'image/png', filename: 'x.png', url });

describe('withChartImage', () => {
  it('adds the chart to the newest user message and drops older files', () => {
    const messages = [
      message('user', [{ type: 'text', text: 'old' }, image('old.png')]),
      message('assistant', [image('assistant.png')]),
      message('user', [text, image('attached.png')]),
    ];

    const out = withChartImage(messages, 'chart.png');

    expect(out[0].parts).toEqual([{ type: 'text', text: 'old' }]);
    expect(out[1].parts).toEqual([]);
    expect(out[2].parts).toEqual([
      { type: 'file', mediaType: 'image/png', filename: 'chart.png', url: 'chart.png' },
      text,
      image('attached.png'),
    ]);
  });

  it('keeps the newest user attachments when no chart is requested', () => {
    const messages = [
      message('user', [image('old.png')]),
      message('user', [text, image('attached.png')]),
    ];

    const out = withChartImage(messages, null);

    expect(out[0].parts).toEqual([]);
    expect(out[1].parts).toEqual([text, image('attached.png')]);
  });

  it('does not mutate the input', () => {
    const messages = [message('user', [image('a.png')])];
    withChartImage(messages, 'chart.png');
    expect(messages[0].parts).toEqual([image('a.png')]);
  });
});
