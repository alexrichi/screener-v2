import type { UIMessage } from 'ai';

/**
 * Keep file parts only on the newest user message: older images would be
 * re-sent on every turn. The chart capture rides on the newest message too.
 */
export function withChartImage(messages: UIMessage[], chartUrl: string | null): UIMessage[] {
  const lastUser = [...messages].reverse().find((message) => message.role === 'user');
  return messages.map((message) => {
    if (message !== lastUser) {
      return { ...message, parts: message.parts.filter((part) => part.type !== 'file') };
    }
    if (!chartUrl) return message;
    const chart: UIMessage['parts'][number] = {
      type: 'file',
      mediaType: 'image/png',
      filename: 'chart.png',
      url: chartUrl,
    };
    return { ...message, parts: [chart, ...message.parts] };
  });
}
