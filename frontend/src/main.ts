import { ArrivalAnnouncer } from './arrivalAnnouncer.ts';
import { ArrivalChime } from './arrivalChime.ts';
import { boardStatusFor, DepartureBoard, isInContact } from './departureBoard.ts';
import { requireElement } from './dom.ts';
import { MessageStore } from './messageStore.ts';
import { PantographIndicator } from './pantographIndicator.ts';
import { MessageListRenderer } from './renderMessages.ts';
import { channelKeyFromLocation } from './route.ts';
import { ConnectionState, connectToStream } from './streamClient.ts';
import './styles.css';

const PageMode = {
  Landing: 'landing',
  Unavailable: 'unavailable',
  Stream: 'stream',
} as const;

type PageMode = (typeof PageMode)[keyof typeof PageMode];

const DEFAULT_TITLE = 'Pantograph';
const ANNOUNCEMENTS_LABELS = { on: 'Announcements on', off: 'Announcements off' } as const;
const PRESSED_ATTRIBUTE = 'aria-pressed';

const store = new MessageStore();
const renderer = new MessageListRenderer(document, store);
const board = new DepartureBoard(document);
const pantograph = new PantographIndicator(document);
const chime = new ArrivalChime();
const announcer = new ArrivalAnnouncer(document);
const announcementsToggle = requireElement<HTMLButtonElement>(document, '[data-announcements]');
const pausedBanner = requireElement(document, '[data-paused-banner]');
const landingSection = requireElement(document, '[data-landing]');
const unavailableSection = requireElement(document, '[data-unavailable]');
const streamSection = requireElement(document, '[data-stream]');

let mode: PageMode = PageMode.Landing;
let connection: ConnectionState = ConnectionState.Connecting;

function showMode(nextMode: PageMode): void {
  mode = nextMode;
  landingSection.hidden = mode !== PageMode.Landing;
  unavailableSection.hidden = mode !== PageMode.Unavailable;
  streamSection.hidden = mode !== PageMode.Stream;
  board.hidden = mode === PageMode.Landing;
}

function renderBoard(): void {
  const { paused, watchedChannel } = store.syncState;
  const status = boardStatusFor({
    unavailable: mode === PageMode.Unavailable,
    connection,
    paused,
  });
  board.setStatus(status);
  board.setService(watchedChannel?.name ?? null);
  board.setPlatform(watchedChannel?.id ?? null);
  pantograph.setRaised(isInContact(status));
  pausedBanner.hidden = !paused;
  document.title = watchedChannel ? `#${watchedChannel.name} · ${DEFAULT_TITLE}` : DEFAULT_TITLE;
}

function renderAnnouncementsToggle(): void {
  announcementsToggle.setAttribute(PRESSED_ATTRIBUTE, String(chime.enabled));
  announcementsToggle.textContent = chime.enabled
    ? ANNOUNCEMENTS_LABELS.on
    : ANNOUNCEMENTS_LABELS.off;
}

announcementsToggle.addEventListener('click', () => {
  if (chime.enabled) {
    chime.disable();
  } else {
    chime.enable();
  }
  renderAnnouncementsToggle();
});
renderAnnouncementsToggle();

const key = channelKeyFromLocation(window.location);

if (key === null) {
  showMode(PageMode.Landing);
} else {
  showMode(PageMode.Stream);
  renderBoard();
  connectToStream({
    key,
    onEvent(event) {
      const change = store.apply(event);
      const arrival = renderer.applyChange(change);
      if (arrival !== null) {
        announcer.announce(arrival);
        pantograph.spark();
        chime.play();
      }
      if (change.kind === 'reset' || change.kind === 'syncState') {
        renderBoard();
      }
    },
    onConnectionStateChange(state) {
      connection = state;
      renderBoard();
    },
    onUnavailable() {
      showMode(PageMode.Unavailable);
      renderBoard();
    },
  });
}
