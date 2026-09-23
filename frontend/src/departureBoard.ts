import { requireElement } from './dom.ts';
import { platformNumberFor } from './platform.ts';
import { SplitFlapField } from './splitFlap.ts';
import { ConnectionState } from './streamClient.ts';

export const BoardStatus = {
  Boarding: 'BOARDING',
  OnTime: 'ON TIME',
  Delayed: 'DELAYED',
  HeldAtSignal: 'HELD AT SIGNAL',
  Cancelled: 'CANCELLED',
} as const;

export type BoardStatus = (typeof BoardStatus)[keyof typeof BoardStatus];

export type BoardStatusInputs = {
  unavailable: boolean;
  connection: ConnectionState;
  paused: boolean;
};

const StatusTone = { Ok: 'ok', Warn: 'warn', Bad: 'bad' } as const;
type StatusTone = (typeof StatusTone)[keyof typeof StatusTone];

const TONE_BY_STATUS: Record<BoardStatus, StatusTone> = {
  [BoardStatus.Boarding]: StatusTone.Warn,
  [BoardStatus.OnTime]: StatusTone.Ok,
  [BoardStatus.Delayed]: StatusTone.Warn,
  [BoardStatus.HeldAtSignal]: StatusTone.Warn,
  [BoardStatus.Cancelled]: StatusTone.Bad,
};

const TIME_FLAPS = 5;
const SERVICE_FLAPS = 20;
const PLATFORM_FLAPS = 2;
const STATUS_FLAPS = 14;
const MILLISECONDS_PER_MINUTE = 60_000;
const TONE_ATTRIBUTE = 'data-tone';
const CHANNEL_PREFIX = '#';
const NO_SERVICE = '';
const NO_PLATFORM = '--';

const clockFormatter = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function boardStatusFor(inputs: BoardStatusInputs): BoardStatus {
  if (inputs.unavailable) {
    return BoardStatus.Cancelled;
  }
  if (inputs.connection === ConnectionState.Connecting) {
    return BoardStatus.Boarding;
  }
  if (inputs.connection === ConnectionState.Reconnecting) {
    return BoardStatus.Delayed;
  }
  if (inputs.paused) {
    return BoardStatus.HeldAtSignal;
  }
  return BoardStatus.OnTime;
}

export function isInContact(status: BoardStatus): boolean {
  return status === BoardStatus.OnTime || status === BoardStatus.HeldAtSignal;
}

export class DepartureBoard {
  readonly #root: HTMLElement;
  readonly #time: SplitFlapField;
  readonly #service: SplitFlapField;
  readonly #platform: SplitFlapField;
  readonly #status: SplitFlapField;
  readonly #statusCell: HTMLElement;

  constructor(root: ParentNode) {
    this.#root = requireElement(root, '[data-departure-board]');
    this.#time = new SplitFlapField(requireElement(root, '[data-board-time]'), TIME_FLAPS);
    this.#service = new SplitFlapField(requireElement(root, '[data-channel-name]'), SERVICE_FLAPS);
    this.#platform = new SplitFlapField(
      requireElement(root, '[data-board-platform]'),
      PLATFORM_FLAPS,
    );
    this.#statusCell = requireElement(root, '[data-board-status]');
    this.#status = new SplitFlapField(this.#statusCell, STATUS_FLAPS);
    this.#startClock();
  }

  set hidden(value: boolean) {
    this.#root.hidden = value;
  }

  setService(channelName: string | null): void {
    this.#service.setValue(channelName === null ? NO_SERVICE : `${CHANNEL_PREFIX}${channelName}`);
  }

  setPlatform(channelId: string | null): void {
    const platformNumber = channelId === null ? null : platformNumberFor(channelId);
    this.#platform.setValue(platformNumber === null ? NO_PLATFORM : String(platformNumber));
  }

  setStatus(status: BoardStatus): void {
    this.#status.setValue(status);
    this.#statusCell.setAttribute(TONE_ATTRIBUTE, TONE_BY_STATUS[status]);
  }

  #startClock(): void {
    this.#showTime();
    const untilNextMinute = MILLISECONDS_PER_MINUTE - (Date.now() % MILLISECONDS_PER_MINUTE);
    setTimeout(() => {
      this.#showTime();
      setInterval(() => this.#showTime(), MILLISECONDS_PER_MINUTE);
    }, untilNextMinute);
  }

  #showTime(): void {
    this.#time.setValue(clockFormatter.format(new Date()));
  }
}
