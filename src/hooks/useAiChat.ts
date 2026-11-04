import { useCallback, useEffect, useRef, useState } from 'react';
import {
  convertToModelMessages,
  readUIMessageStream,
  stepCountIs,
  streamText,
  toUIMessageStream,
  type ToolSet,
  type UIMessage,
} from 'ai';
import { aiModel, setAiSession } from '../lib/ai/model';
import { attachmentPrompt } from '../lib/ai/attachments';

export interface ChatAttachmentImages {
  url: string;
  mediaType: string;
  name?: string;
}

export interface ChatAttachments {
  images?: ChatAttachmentImages[];
  /** Text files are folded into the prompt; providers reject arbitrary files. */
  files?: Array<{ name: string; text: string }>;
}

export interface AiChat {
  messages: UIMessage[];
  status: 'idle' | 'streaming';
  error: string | null;
  /** True after the user pressed Stop, until the next send. */
  stopped: boolean;
  send: (text: string, attachments?: ChatAttachments) => void;
  stop: () => void;
}

interface Options {
  /** Session whose transcript is on screen; switching resets the hook. */
  sessionId: string;
  initialMessages: UIMessage[];
  /** Called once per finished turn (including stop and errors). */
  onTurnEnd?: (messages: UIMessage[], sessionId: string) => void;
  tools: ToolSet;
  /** Rebuilt per turn so the workspace summary is current. */
  system: () => string;
  /** Cap on model/tool round trips for one prompt. */
  maxSteps?: number;
}

/**
 * One conversation, no transport: `streamText` runs here because the tools need
 * the live editor and chart. The sidecar only proxies the model call.
 */
export function useAiChat({
  sessionId,
  initialMessages,
  onTurnEnd,
  tools,
  system,
  maxSteps = 8,
}: Options): AiChat {
  const [messages, setMessages] = useState<UIMessage[]>(initialMessages);
  const [status, setStatus] = useState<'idle' | 'streaming'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [stopped, setStopped] = useState(false);
  const toolsRef = useRef(tools);
  toolsRef.current = tools;
  const systemRef = useRef(system);
  systemRef.current = system;
  const controllerRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const initialRef = useRef(initialMessages);
  initialRef.current = initialMessages;
  const onTurnEndRef = useRef(onTurnEnd);
  onTurnEndRef.current = onTurnEnd;

  const stop = useCallback(() => {
    setStopped(true);
    controllerRef.current?.abort();
  }, []);

  // Switching sessions swaps the whole transcript; a live turn is stopped
  // first so it cannot append into the wrong one.
  useEffect(() => {
    controllerRef.current?.abort();
    busyRef.current = false;
    setMessages(initialRef.current);
    setError(null);
    setStatus('idle');
  }, [sessionId]);

  const send = useCallback(
    (text: string, attachments?: ChatAttachments) => {
      const files = attachments?.files ?? [];
      const images = attachments?.images ?? [];
      const prompt = [text.trim(), attachmentPrompt(files)].filter(Boolean).join('\n\n');
      if (!prompt || busyRef.current) return;
      busyRef.current = true;
      setError(null);
      setStopped(false);
      setStatus('streaming');
      const controller = new AbortController();
      controllerRef.current = controller;
      const assistantId = crypto.randomUUID();
      setAiSession(sessionId);
      const userParts: UIMessage['parts'] = [{ type: 'text', text: prompt }];
      for (const image of images) {
        userParts.push({
          type: 'file',
          mediaType: image.mediaType,
          filename: image.name ?? 'image.png',
          url: image.url,
        });
      }
      const history: UIMessage[] = [
        // Earlier turns keep their text and tool parts; only the newest image is
        // re-sent, so the payload does not grow with the conversation.
        ...messages.map((message) => ({
          ...message,
          parts: message.parts.filter((part) => part.type !== 'file'),
        })),
        { id: crypto.randomUUID(), role: 'user', parts: userParts },
      ];
      let latest: UIMessage[] = [
        ...history,
        { id: assistantId, role: 'assistant', parts: [] },
      ];
      setMessages(latest);

      void (async () => {
        try {
          const modelMessages = await convertToModelMessages(history, {
            tools: toolsRef.current,
          });
          const result = streamText({
            model: aiModel,
            system: systemRef.current(),
            messages: modelMessages,
            tools: toolsRef.current,
            stopWhen: stepCountIs(maxSteps),
            abortSignal: controller.signal,
          });
          const stream = toUIMessageStream({
            stream: result.fullStream,
            tools: toolsRef.current,
            onError: (cause) => (cause instanceof Error ? cause.message : String(cause)),
          });
          for await (const message of readUIMessageStream({
            stream,
            // Stream errors end the loop instead of throwing; surface them here.
            onError: (cause) => {
              if (!controller.signal.aborted) {
                setError(cause instanceof Error ? cause.message : String(cause));
              }
            },
          })) {
            setMessages((prev) => {
              latest = [...prev.slice(0, -1), { ...message, id: assistantId }];
              return latest;
            });
          }
        } catch (cause) {
          if (!controller.signal.aborted) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        } finally {
          busyRef.current = false;
          controllerRef.current = null;
          setStatus('idle');
          // An abort or a failure can leave the placeholder bubble behind.
          setMessages((prev) => {
            const last = prev[prev.length - 1];
            const empty = last?.role === 'assistant' && last.parts.length === 0;
            latest = empty && prev.length > 1 ? prev.slice(0, -1) : prev;
            return latest;
          });
          onTurnEndRef.current?.(latest, sessionId);
        }
      })();
    },
    [maxSteps, messages, sessionId],
  );

  return { messages, status, error, stopped, send, stop };
}
