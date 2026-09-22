import {
  compareSnowflakes,
  type MessageView,
  type StreamEvent,
  StreamEventName,
  type SyncStateView,
} from '@pantograph/shared';
import {
  formatEventId,
  parseEventId,
  type StreamFrame,
  serializeStreamFrame,
} from './streamFrame.ts';

export const RECENT_MESSAGE_LIMIT = 50;
const EVENT_LOG_LIMIT = 500;

export type StreamSubscriber = {
  send(frame: StreamFrame): void;
  close(): void;
};

type LoggedFrame = {
  sequence: number;
  frame: StreamFrame;
};

export class MessageStreamHub {
  readonly #epoch: string;
  #sequence = 0;
  readonly #messagesById = new Map<string, MessageView>();
  readonly #eventLog: LoggedFrame[] = [];
  readonly #subscribers = new Set<StreamSubscriber>();
  #syncState: SyncStateView;
  #lastEventAt: Date | null = null;

  constructor(options: { epoch: string; initialSyncState: SyncStateView }) {
    this.#epoch = options.epoch;
    this.#syncState = options.initialSyncState;
  }

  get subscriberCount(): number {
    return this.#subscribers.size;
  }

  get bufferedMessageCount(): number {
    return this.#messagesById.size;
  }

  get lastEventAt(): Date | null {
    return this.#lastEventAt;
  }

  get syncState(): SyncStateView {
    return this.#syncState;
  }

  replaceMessages(messages: readonly MessageView[], syncState: SyncStateView): void {
    this.#syncState = syncState;
    this.#messagesById.clear();
    for (const message of this.#newestFirst(messages).slice(0, RECENT_MESSAGE_LIMIT)) {
      this.#messagesById.set(message.id, message);
    }
    this.#broadcast(this.#snapshotEvent());
  }

  applyMessageCreated(message: MessageView): void {
    this.#messagesById.set(message.id, message);
    this.#trimToLimit();
    this.#broadcast({ name: StreamEventName.MessageCreated, payload: message });
  }

  applyMessageUpdated(message: MessageView): void {
    const buffered = this.#messagesById.get(message.id);
    if (buffered && JSON.stringify(buffered) === JSON.stringify(message)) {
      return;
    }
    if (buffered) {
      this.#messagesById.set(message.id, message);
    }
    this.#broadcast({ name: StreamEventName.MessageUpdated, payload: message });
  }

  applyMessagesDeleted(ids: readonly string[]): void {
    if (ids.length === 0) {
      return;
    }
    for (const id of ids) {
      this.#messagesById.delete(id);
    }
    this.#broadcast({ name: StreamEventName.MessageDeleted, payload: { ids: [...ids] } });
  }

  setSyncState(syncState: SyncStateView): void {
    this.#syncState = syncState;
    this.#broadcast({ name: StreamEventName.SyncStateChanged, payload: syncState });
  }

  disconnectAll(): void {
    for (const subscriber of this.#subscribers) {
      subscriber.close();
    }
    this.#subscribers.clear();
  }

  subscribe(subscriber: StreamSubscriber, lastEventId: string | null): () => void {
    this.#subscribers.add(subscriber);
    const replay = this.#framesAfter(lastEventId);
    if (replay === null) {
      subscriber.send(serializeStreamFrame(this.#currentEventId(), this.#snapshotEvent()));
    } else {
      for (const frame of replay) {
        subscriber.send(frame);
      }
    }
    return () => {
      this.#subscribers.delete(subscriber);
    };
  }

  #framesAfter(lastEventId: string | null): StreamFrame[] | null {
    if (lastEventId === null) {
      return null;
    }
    const parsed = parseEventId(lastEventId);
    if (parsed === null || parsed.epoch !== this.#epoch || parsed.sequence > this.#sequence) {
      return null;
    }
    const oldestLogged = this.#eventLog[0];
    const hasCompleteHistory =
      parsed.sequence === this.#sequence ||
      (oldestLogged !== undefined && oldestLogged.sequence <= parsed.sequence + 1);
    if (!hasCompleteHistory) {
      return null;
    }
    return this.#eventLog
      .filter((logged) => logged.sequence > parsed.sequence)
      .map((logged) => logged.frame);
  }

  #broadcast(event: StreamEvent): void {
    this.#sequence += 1;
    this.#lastEventAt = new Date();
    const frame = serializeStreamFrame(this.#currentEventId(), event);
    this.#eventLog.push({ sequence: this.#sequence, frame });
    if (this.#eventLog.length > EVENT_LOG_LIMIT) {
      this.#eventLog.splice(0, this.#eventLog.length - EVENT_LOG_LIMIT);
    }
    for (const subscriber of this.#subscribers) {
      subscriber.send(frame);
    }
  }

  #currentEventId(): string {
    return formatEventId(this.#epoch, this.#sequence);
  }

  #snapshotEvent(): StreamEvent {
    return {
      name: StreamEventName.Snapshot,
      payload: { messages: this.#messagesOldestFirst(), syncState: this.#syncState },
    };
  }

  #messagesOldestFirst(): MessageView[] {
    return [...this.#messagesById.values()].sort((left, right) =>
      compareSnowflakes(left.id, right.id),
    );
  }

  #newestFirst(messages: readonly MessageView[]): MessageView[] {
    return [...messages].sort((left, right) => compareSnowflakes(right.id, left.id));
  }

  #trimToLimit(): void {
    const excess = this.#messagesById.size - RECENT_MESSAGE_LIMIT;
    if (excess <= 0) {
      return;
    }
    for (const message of this.#messagesOldestFirst().slice(0, excess)) {
      this.#messagesById.delete(message.id);
    }
  }
}
