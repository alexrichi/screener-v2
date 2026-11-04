import { generateText } from 'ai';
import type { ThreadMessageLike } from '@assistant-ui/react';
import { aiModelFor } from './model';
import {
  firstAssistantText,
  firstUserText,
  sanitizeGeneratedTitle,
} from './uiChats';

const MAX_USER_CHARS = 600;
const MAX_ASSISTANT_CHARS = 900;

/**
 * One cheap non-streaming call after the first exchange. The title follows the
 * language of the user's prompt, matching the rest of the conversation.
 */
export async function generateChatTitle(
  messages: readonly ThreadMessageLike[],
  context: string,
  model?: string | null,
  signal?: AbortSignal,
): Promise<string | null> {
  const user = firstUserText(messages).slice(0, MAX_USER_CHARS);
  if (!user) return null;
  const assistant = firstAssistantText(messages).slice(0, MAX_ASSISTANT_CHARS);
  try {
    const result = await generateText({
      model: aiModelFor(model),
      system:
        'Write a short title for this chat in the same language as the user message. ' +
        'Use 3-6 words. No quotes, no trailing period. Describe the topic; include the ' +
        'symbol or timeframe only when the user mentions them.',
      prompt: `Chart: ${context}\n\nUser: ${user}\n\nAssistant: ${assistant}\n\nTitle:`,
      // A reasoning model spends a small output budget entirely on reasoning.
      // The title is metadata, so skip thinking and leave room for the words.
      reasoning: 'none',
      maxOutputTokens: 64,
      temperature: 0.2,
      abortSignal: signal,
    });
    return sanitizeGeneratedTitle(result.text) || null;
  } catch {
    return null;
  }
}
