import type { StreamEvent } from '@pantograph/shared';

export type StreamFrame = {
  id: string;
  text: string;
};

export const HEARTBEAT_FRAME_TEXT = ': ping\n\n';

const RETRY_HINT_MS = 3000;
export const RETRY_HINT_FRAME_TEXT = `retry: ${RETRY_HINT_MS}\n\n`;

const EVENT_ID_SEPARATOR = ':';

export function formatEventId(epoch: string, sequence: number): string {
  return `${epoch}${EVENT_ID_SEPARATOR}${sequence}`;
}

export function parseEventId(raw: string): { epoch: string; sequence: number } | null {
  const separatorIndex = raw.lastIndexOf(EVENT_ID_SEPARATOR);
  if (separatorIndex <= 0) {
    return null;
  }
  const epoch = raw.slice(0, separatorIndex);
  const sequence = Number.parseInt(raw.slice(separatorIndex + 1), 10);
  if (!Number.isSafeInteger(sequence) || sequence < 0) {
    return null;
  }
  return { epoch, sequence };
}

export function serializeStreamFrame(id: string, event: StreamEvent): StreamFrame {
  const data = JSON.stringify(event.payload);
  return { id, text: `id: ${id}\nevent: ${event.name}\ndata: ${data}\n\n` };
}
