import { requireElement } from './dom.ts';
import { MessageStore } from './messageStore.ts';
import { MessageListRenderer } from './renderMessages.ts';
import { channelKeyFromLocation } from './route.ts';
import { type ConnectionState, connectToStream } from './streamClient.ts';
import './styles.css';

const CONNECTION_STATE_LABELS: Record<ConnectionState, string> = {
  connecting: 'Connecting…',
  live: 'Live',
  reconnecting: 'Reconnecting…',
};

const PageMode = {
  Landing: 'landing',
  Unavailable: 'unavailable',
  Stream: 'stream',
} as const;

type PageMode = (typeof PageMode)[keyof typeof PageMode];

const DEFAULT_TITLE = 'Pantograph';

const store = new MessageStore();
const renderer = new MessageListRenderer(document, store);
const channelName = requireElement(document, '[data-channel-name]');
const connectionState = requireElement(document, '[data-connection-state]');
const pausedBanner = requireElement(document, '[data-paused-banner]');
const landingSection = requireElement(document, '[data-landing]');
const unavailableSection = requireElement(document, '[data-unavailable]');
const streamSection = requireElement(document, '[data-stream]');

function showMode(mode: PageMode): void {
  landingSection.hidden = mode !== PageMode.Landing;
  unavailableSection.hidden = mode !== PageMode.Unavailable;
  streamSection.hidden = mode !== PageMode.Stream;
  connectionState.hidden = mode !== PageMode.Stream;
}

function renderSyncState(): void {
  const { paused, watchedChannel } = store.syncState;
  channelName.textContent = watchedChannel ? `#${watchedChannel.name}` : DEFAULT_TITLE;
  document.title = watchedChannel ? `#${watchedChannel.name} · ${DEFAULT_TITLE}` : DEFAULT_TITLE;
  pausedBanner.hidden = !paused;
}

const key = channelKeyFromLocation(window.location);

if (key === null) {
  showMode(PageMode.Landing);
} else {
  showMode(PageMode.Stream);
  connectToStream({
    key,
    onEvent(event) {
      const change = store.apply(event);
      renderer.applyChange(change);
      if (change.kind === 'reset' || change.kind === 'syncState') {
        renderSyncState();
      }
    },
    onConnectionStateChange(state) {
      connectionState.textContent = CONNECTION_STATE_LABELS[state];
    },
    onUnavailable() {
      showMode(PageMode.Unavailable);
    },
  });
}
