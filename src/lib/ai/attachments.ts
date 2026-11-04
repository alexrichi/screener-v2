export interface PendingAttachment {
  id: string;
  name: string;
  kind: 'image' | 'text';
  /** Data URL for images, plain text for text files. */
  data: string;
  size: number;
}

export const MAX_ATTACHMENT_BYTES = 8 * 1024 * 1024;
export const MAX_TEXT_CHARS = 60_000;
export const MAX_ATTACHMENTS = 6;

const TEXT_EXTENSIONS = /\.(pine|txt|md|json|csv|log|ts|tsx|js|jsx|ya?ml|toml|ini)$/i;

export function isTextFile(name: string, type: string): boolean {
  return type.startsWith('text/') || TEXT_EXTENSIONS.test(name);
}

export function isImageFile(type: string): boolean {
  return type.startsWith('image/');
}

async function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

export async function readAttachment(file: File): Promise<PendingAttachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`${file.name} is larger than 8 MB`);
  }
  const id = crypto.randomUUID();
  if (isImageFile(file.type)) {
    return {
      id,
      name: file.name || 'image.png',
      kind: 'image',
      data: await readDataUrl(file),
      size: file.size,
    };
  }
  if (isTextFile(file.name, file.type)) {
    const text = await file.text();
    return {
      id,
      name: file.name,
      kind: 'text',
      data: text.slice(0, MAX_TEXT_CHARS),
      size: file.size,
    };
  }
  throw new Error(`${file.name}: attach images or text files (pine, txt, md, csv, json)`);
}

/** Text files ride inside the prompt: chat providers do not accept arbitrary files. */
export function attachmentPrompt(files: Array<{ name: string; text: string }>): string {
  return files
    .map((file) => `--- attached file: ${file.name} ---\n${file.text}\n--- end of ${file.name} ---`)
    .join('\n\n');
}

export function mediaTypeOf(dataUrl: string): string {
  const match = /^data:([^;,]+)[;,]/.exec(dataUrl);
  return match?.[1] ?? 'image/png';
}
