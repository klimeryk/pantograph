import {
  compareSnowflakes,
  type MessageView,
  type StreamEvent,
  StreamEventName,
  type SyncStateView,
} from '@pantograph/shared';

export type StoreChange =
  | { kind: 'reset' }
  | { kind: 'upsert'; message: MessageView; evictedIds: string[] }
  | { kind: 'remove'; ids: string[] }
  | { kind: 'syncState' }
  | { kind: 'none' };

const MAX_STORED_MESSAGES = 500;

export class MessageStore {
  readonly #messagesById = new Map<string, MessageView>();
  #syncState: SyncStateView = { paused: false, watchedChannel: null };

  get syncState(): SyncStateView {
    return this.#syncState;
  }

  get messagesOldestFirst(): MessageView[] {
    return [...this.#messagesById.values()].sort((left, right) =>
      compareSnowflakes(left.id, right.id),
    );
  }

  apply(event: StreamEvent): StoreChange {
    switch (event.name) {
      case StreamEventName.Snapshot: {
        this.#messagesById.clear();
        for (const message of event.payload.messages) {
          this.#messagesById.set(message.id, message);
        }
        this.#syncState = event.payload.syncState;
        return { kind: 'reset' };
      }
      case StreamEventName.MessageCreated: {
        this.#messagesById.set(event.payload.id, event.payload);
        return { kind: 'upsert', message: event.payload, evictedIds: this.#trimToLimit() };
      }
      case StreamEventName.MessageUpdated: {
        if (!this.#messagesById.has(event.payload.id)) {
          return { kind: 'none' };
        }
        this.#messagesById.set(event.payload.id, event.payload);
        return { kind: 'upsert', message: event.payload, evictedIds: [] };
      }
      case StreamEventName.MessageDeleted: {
        const removedIds = event.payload.ids.filter((id) => this.#messagesById.delete(id));
        return removedIds.length > 0 ? { kind: 'remove', ids: removedIds } : { kind: 'none' };
      }
      case StreamEventName.SyncStateChanged: {
        this.#syncState = event.payload;
        return { kind: 'syncState' };
      }
    }
  }

  #trimToLimit(): string[] {
    const excess = this.#messagesById.size - MAX_STORED_MESSAGES;
    if (excess <= 0) {
      return [];
    }
    const evicted = this.messagesOldestFirst.slice(0, excess);
    for (const message of evicted) {
      this.#messagesById.delete(message.id);
    }
    return evicted.map((message) => message.id);
  }
}
