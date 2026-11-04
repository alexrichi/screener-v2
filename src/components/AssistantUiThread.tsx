import { useEffect, useMemo, useRef } from 'react';
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type AttachmentAdapter,
  type ChatModelAdapter,
  type ChatModelRunResult,
  type CompleteAttachment,
  type PendingAttachment,
  type ThreadMessage,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import type { ThreadComponents } from './assistant-ui/elements/thread.aui';
import {
  convertToModelMessages,
  readUIMessageStream,
  stepCountIs,
  streamText,
  toUIMessageStream,
  type ToolSet,
  type UIMessage,
} from 'ai';
import { Thread } from './assistant-ui/elements/thread.aui';
import { withChartImage } from '../lib/ai/chatImages';
import { uiPartsToAssistant } from '../lib/ai/uiParts';
import { aiModelFor, setAiSession, type AiReasoning } from '../lib/ai/model';

interface Props {
  tools: ToolSet;
  system: () => string;
  sessionId: string;
  initialMessages: ThreadMessageLike[];
  onSave: (messages: readonly ThreadMessage[]) => void;
  components?: ThreadComponents;
  /** Concrete model id, or null for the sidecar's configured model. */
  model?: string | null;
  reasoning?: AiReasoning;
  /** Attach the active chart PNG to every message. */
  withChart?: boolean;
  screenshot?: () => string | null;
}


const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
const MAX_TEXT_CHARS = 60_000;
const TEXT_EXTENSIONS = /\.(pine|txt|md|json|csv|log|ts|tsx|js|jsx|ya?ml|toml|ini)$/i;

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

/** Mirrors the app sidebar: images as image parts, text files folded into the prompt. */
const attachmentAdapter: AttachmentAdapter = {
  accept: 'image/*,.pine,.txt,.md,.json,.csv,.log,.ts,.tsx,.js,.jsx,.yaml,.yml,.toml,.ini',
  async add({ file }: { file: File }): Promise<PendingAttachment> {
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(`${file.name} is larger than 8 MB`);
    }
    const image = file.type.startsWith('image/');
    const text = file.type.startsWith('text/') || TEXT_EXTENSIONS.test(file.name);
    if (!image && !text) {
      throw new Error(`${file.name}: attach images or text files`);
    }
    return {
      id: crypto.randomUUID(),
      type: image ? 'image' : 'file',
      name: file.name,
      file,
      status: { type: 'requires-action', reason: 'composer-send' },
    };
  },
  async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    if (attachment.type === 'image') {
      const url = await readDataUrl(attachment.file);
      return {
        ...attachment,
        status: { type: 'complete' },
        content: [{ type: 'image', image: url }],
      };
    }
    const text = (await attachment.file.text()).slice(0, MAX_TEXT_CHARS);
    return {
      ...attachment,
      status: { type: 'complete' },
      content: [
        {
          type: 'text',
          text: `--- attached file: ${attachment.name} ---\n${text}\n--- end of ${attachment.name} ---`,
        },
      ],
    };
  },
  async remove() {
    /* nothing to clean up: the file lives in memory */
  },
};

function toUiMessages(
  messages: readonly {
    id: string;
    role: string;
    content: readonly unknown[];
    attachments?: readonly {
      name?: string;
      contentType?: string;
      content?: readonly { type?: string; image?: string; text?: string }[];
    }[];
  }[],
): UIMessage[] {
  return messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => {
      const parts: UIMessage['parts'] = [];
      // assistant-ui keeps composer attachments on the message, not in content.
      for (const attachment of message.attachments ?? []) {
        for (const raw of attachment.content ?? []) {
          if (raw.type === 'image' && typeof raw.image === 'string') {
            parts.push({
              type: 'file',
              mediaType: attachment.contentType ?? 'image/png',
              filename: attachment.name ?? 'image.png',
              url: raw.image,
            });
          } else if (raw.type === 'text' && typeof raw.text === 'string') {
            parts.push({ type: 'text', text: raw.text });
          }
        }
      }
      for (const raw of message.content) {
        const part = raw as { type?: string; text?: string; image?: string };
        if (part.type === 'text' && typeof part.text === 'string') {
          parts.push({ type: 'text', text: part.text });
        } else if (part.type === 'image' && typeof part.image === 'string') {
          parts.push({
            type: 'file',
            mediaType: 'image/png',
            filename: 'image.png',
            url: part.image,
          });
        }
      }
      return {
        id: message.id,
        role: message.role as 'user' | 'assistant',
        parts,
      };
    })
    .filter((message) => message.parts.length > 0);
}

/**
 * assistant-ui's Thread driven by the same model and tools as the app sidebar.
 * The sidebar owns the transcript: it passes the initial messages and receives
 * every settled run, so one component can switch between stored chats.
 */
export function AssistantUiThread({
  tools,
  system,
  sessionId,
  initialMessages,
  onSave,
  components,
  model = null,
  reasoning = 'auto',
  withChart = false,
  screenshot,
}: Props) {
  const withChartRef = useRef(withChart);
  withChartRef.current = withChart;
  const screenshotRef = useRef(screenshot);
  screenshotRef.current = screenshot;

  const adapter = useMemo<ChatModelAdapter>(
    () => ({
      async *run({ messages, abortSignal }): AsyncGenerator<ChatModelRunResult> {
        if (abortSignal.aborted) return;
        setAiSession(sessionId);
        const chart = withChartRef.current ? (screenshotRef.current?.() ?? null) : null;
        const modelMessages = await convertToModelMessages(
          withChartImage(toUiMessages(messages), chart),
          { tools },
        );
        const result = streamText({
          model: aiModelFor(model),
          system: system(),
          messages: modelMessages,
          tools,
          ...(reasoning !== 'auto' ? { reasoning } : {}),
          // Large scripts need several read/probe/edit rounds before a final answer.
          stopWhen: stepCountIs(24),
          abortSignal,
        });
        // The same SDK stream the app chat uses: it owns step boundaries,
        // reasoning parts and tool results; assistant-ui only maps the parts.
        let failure: unknown = null;
        const stream = toUIMessageStream({
          stream: result.fullStream,
          tools,
          onError: (cause) => (cause instanceof Error ? cause.message : String(cause)),
        });
        for await (const message of readUIMessageStream({
          stream,
          onError: (cause) => {
            failure = cause;
          },
        })) {
          yield { content: uiPartsToAssistant(message.parts) };
        }
        if (failure !== null && !abortSignal.aborted) {
          throw failure instanceof Error ? failure : new Error(String(failure));
        }
      },
    }),
    [model, reasoning, sessionId, system, tools],
  );

  const runtime = useLocalRuntime(adapter, {
    initialMessages,
    adapters: { attachments: attachmentAdapter },
  });

  useEffect(() => {
    const persist = () => {
      const state = runtime.thread.getState();
      if (state.isRunning) return;
      onSave(state.messages);
    };
    persist();
    return runtime.thread.subscribe(persist);
  }, [onSave, runtime]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread autoFocus={false} components={components} />
    </AssistantRuntimeProvider>
  );
}
