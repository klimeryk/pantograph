const STORAGE_KEY = 'pantograph.announcements';
const Preference = { On: 'on', Off: 'off' } as const;
type Preference = (typeof Preference)[keyof typeof Preference];

const NOTE_G5_HZ = 783.99;
const NOTE_E5_HZ = 659.25;
const NOTE_C5_HZ = 523.25;
const CHIME_NOTES_HZ = [NOTE_G5_HZ, NOTE_E5_HZ, NOTE_C5_HZ] as const;
const NOTE_SPACING_SECONDS = 0.22;
const NOTE_DURATION_SECONDS = 0.45;
const ATTACK_SECONDS = 0.02;
const PEAK_GAIN = 0.12;
const SILENT_GAIN = 0.0001;
const OSCILLATOR_TYPE: OscillatorType = 'sine';
const RUNNING_STATE: AudioContextState = 'running';
const CHIME_MIN_INTERVAL_MS = 2000;
const NOTE_ENDED_EVENT = 'ended';

export class ArrivalChime {
  #context: AudioContext | null = null;
  #enabled = readPreference() === Preference.On;
  #lastPlayedAt = Number.NEGATIVE_INFINITY;
  #soundingNotes = 0;

  get enabled(): boolean {
    return this.#enabled;
  }

  enable(): void {
    this.#enabled = true;
    writePreference(Preference.On);
    this.#lastPlayedAt = Date.now();
    void this.#playNow();
  }

  disable(): void {
    this.#enabled = false;
    writePreference(Preference.Off);
  }

  play(): void {
    if (!this.#enabled || Date.now() - this.#lastPlayedAt < CHIME_MIN_INTERVAL_MS) {
      return;
    }
    this.#lastPlayedAt = Date.now();
    void this.#playNow();
  }

  async #playNow(): Promise<void> {
    const context = this.#ensureContext();
    if (context === null) {
      return;
    }
    if (context.state !== RUNNING_STATE) {
      try {
        await context.resume();
      } catch {
        return;
      }
    }
    if (context.state !== RUNNING_STATE) {
      return;
    }
    const startAt = context.currentTime;
    CHIME_NOTES_HZ.forEach((frequencyHz, index) => {
      this.#soundingNotes += 1;
      scheduleNote(context, frequencyHz, startAt + index * NOTE_SPACING_SECONDS, () =>
        this.#onNoteEnded(context),
      );
    });
  }

  #onNoteEnded(context: AudioContext): void {
    this.#soundingNotes -= 1;
    if (this.#soundingNotes === 0) {
      context.suspend().catch(() => undefined);
    }
  }

  #ensureContext(): AudioContext | null {
    if (this.#context === null) {
      try {
        this.#context = new AudioContext();
      } catch {
        return null;
      }
    }
    return this.#context;
  }
}

function scheduleNote(
  context: AudioContext,
  frequencyHz: number,
  startAt: number,
  onEnded: () => void,
): void {
  const oscillator = context.createOscillator();
  oscillator.type = OSCILLATOR_TYPE;
  oscillator.frequency.value = frequencyHz;
  const gain = context.createGain();
  gain.gain.setValueAtTime(SILENT_GAIN, startAt);
  gain.gain.linearRampToValueAtTime(PEAK_GAIN, startAt + ATTACK_SECONDS);
  gain.gain.exponentialRampToValueAtTime(SILENT_GAIN, startAt + NOTE_DURATION_SECONDS);
  oscillator.connect(gain).connect(context.destination);
  oscillator.addEventListener(NOTE_ENDED_EVENT, onEnded, { once: true });
  oscillator.start(startAt);
  oscillator.stop(startAt + NOTE_DURATION_SECONDS);
}

function readPreference(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writePreference(preference: Preference): void {
  try {
    localStorage.setItem(STORAGE_KEY, preference);
  } catch {
    return;
  }
}
