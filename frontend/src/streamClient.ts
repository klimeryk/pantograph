import {
  channelInfoPath,
  channelStreamPath,
  type StreamEvent,
  StreamEventName,
} from '@pantograph/shared';

export const ConnectionState = {
  Connecting: 'connecting',
  Live: 'live',
  Reconnecting: 'reconnecting',
} as const;

export type ConnectionState = (typeof ConnectionState)[keyof typeof ConnectionState];

export type StreamClientOptions = {
  key: string;
  onEvent(event: StreamEvent): void;
  onConnectionStateChange(state: ConnectionState): void;
  onUnavailable(): void;
};

const RETRY_AFTER_CLOSE_MS = 5000;
const NOT_FOUND_STATUS = 404;

export function connectToStream(options: StreamClientOptions): () => void {
  let source: EventSource | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let disconnected = false;

  const verifyThenOpen = async (): Promise<void> => {
    options.onConnectionStateChange(ConnectionState.Connecting);
    let response: Response;
    try {
      response = await fetch(channelInfoPath(options.key));
    } catch {
      scheduleRetry();
      return;
    }
    if (disconnected) {
      return;
    }
    if (response.status === NOT_FOUND_STATUS) {
      options.onUnavailable();
      return;
    }
    if (!response.ok) {
      scheduleRetry();
      return;
    }
    openSource();
  };

  const openSource = (): void => {
    source = new EventSource(channelStreamPath(options.key));
    for (const name of Object.values(StreamEventName)) {
      source.addEventListener(name, (messageEvent: MessageEvent<string>) => {
        options.onEvent({ name, payload: JSON.parse(messageEvent.data) } as StreamEvent);
      });
    }
    source.onopen = () => options.onConnectionStateChange(ConnectionState.Live);
    source.onerror = () => {
      if (source?.readyState === EventSource.CLOSED) {
        scheduleRetry();
      }
      options.onConnectionStateChange(ConnectionState.Reconnecting);
    };
  };

  const scheduleRetry = (): void => {
    source?.close();
    source = null;
    if (disconnected || retryTimer !== null) {
      return;
    }
    retryTimer = setTimeout(() => {
      retryTimer = null;
      void verifyThenOpen();
    }, RETRY_AFTER_CLOSE_MS);
  };

  void verifyThenOpen();

  return () => {
    disconnected = true;
    if (retryTimer !== null) {
      clearTimeout(retryTimer);
    }
    source?.close();
  };
}
