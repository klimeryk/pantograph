import type { SSEStreamingApi } from 'hono/streaming';
import type { StreamSubscriber } from '../stream/messageStreamHub.ts';
import {
  HEARTBEAT_FRAME_TEXT,
  RETRY_HINT_FRAME_TEXT,
  type StreamFrame,
} from '../stream/streamFrame.ts';

const HEARTBEAT_INTERVAL_MS = 25_000;
const MAX_PENDING_FRAMES = 100;

export class SseClient implements StreamSubscriber {
  readonly #stream: SSEStreamingApi;
  readonly #pendingFrameTexts: string[] = [RETRY_HINT_FRAME_TEXT];
  #wakeWriter: (() => void) | null = null;
  #closed = false;
  readonly #onOverflow: () => void;

  constructor(stream: SSEStreamingApi, options: { onOverflow: () => void }) {
    this.#stream = stream;
    this.#onOverflow = options.onOverflow;
  }

  send(frame: StreamFrame): void {
    this.#enqueue(frame.text);
  }

  close(): void {
    this.#closed = true;
    this.#wakeWriter?.();
  }

  async run(): Promise<void> {
    const heartbeat = setInterval(() => this.#enqueue(HEARTBEAT_FRAME_TEXT), HEARTBEAT_INTERVAL_MS);
    try {
      while (!this.#closed && !this.#stream.aborted) {
        const nextFrameText = this.#pendingFrameTexts.shift();
        if (nextFrameText === undefined) {
          await this.#waitForFrames();
          continue;
        }
        await this.#stream.write(nextFrameText);
      }
    } finally {
      clearInterval(heartbeat);
    }
  }

  #enqueue(frameText: string): void {
    if (this.#closed) {
      return;
    }
    if (this.#pendingFrameTexts.length >= MAX_PENDING_FRAMES) {
      this.close();
      this.#onOverflow();
      return;
    }
    this.#pendingFrameTexts.push(frameText);
    this.#wakeWriter?.();
  }

  #waitForFrames(): Promise<void> {
    return new Promise((resolve) => {
      this.#wakeWriter = () => {
        this.#wakeWriter = null;
        resolve();
      };
    });
  }
}
