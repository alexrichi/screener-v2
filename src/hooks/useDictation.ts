import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { transcribeAudio } from '../lib/ai/model';

export interface Dictation {
  recording: boolean;
  transcribing: boolean;
  start: () => void;
  stop: () => void;
}

/**
 * Record a short clip, transcribe it through the sidecar, and hand the text to
 * the caller. Both AI composers share it so dictation behaves the same.
 */
export function useDictation(onText: (text: string) => void): Dictation {
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  const stopStream = useCallback(() => {
    for (const track of streamRef.current?.getTracks() ?? []) track.stop();
    streamRef.current = null;
  }, []);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  }, []);

  const start = useCallback(() => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast.error('The microphone is not available');
      return;
    }
    void navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        streamRef.current = stream;
        const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        const chunks: BlobPart[] = [];
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) chunks.push(event.data);
        };
        recorder.onstop = () => {
          stopStream();
          recorderRef.current = null;
          setRecording(false);
          const clip = new Blob(chunks, { type: 'audio/webm' });
          if (clip.size === 0) return;
          setTranscribing(true);
          void transcribeAudio(clip)
            .then((text) => {
              const trimmed = text.trim();
              if (trimmed) onTextRef.current(trimmed);
            })
            .catch((cause) =>
              toast.error('Could not transcribe', {
                description: cause instanceof Error ? cause.message : String(cause),
              }),
            )
            .finally(() => setTranscribing(false));
        };
        recorder.start();
        recorderRef.current = recorder;
        setRecording(true);
      })
      .catch((cause) => {
        stopStream();
        toast.error('Microphone access failed', {
          description: cause instanceof Error ? cause.message : String(cause),
        });
      });
  }, [stopStream]);

  useEffect(
    () => () => {
      const recorder = recorderRef.current;
      recorderRef.current = null;
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      stopStream();
    },
    [stopStream],
  );

  return { recording, transcribing, start, stop };
}
