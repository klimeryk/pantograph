import { prefersReducedMotion } from './motion.ts';

const FLAP_ALPHABET = " ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#-_.:/'&()";
const FLAP_STEP_MS = 40;
const FLIP_DURATION_MS = 40;
const FLAP_ROW_ATTRIBUTE = 'data-flap-row';
const FLAP_ATTRIBUTE = 'data-flap';
const FLAP_CHAR_ATTRIBUTE = 'data-char';
const ACCESSIBLE_VALUE_CLASS = 'sr-only';
const BLANK_FLAP = ' ';
const FLIP_KEYFRAMES: Keyframe[] = [
  { transform: 'rotateX(0deg)' },
  { transform: 'rotateX(-90deg)', offset: 0.5 },
  { transform: 'rotateX(0deg)' },
];

export class SplitFlapField {
  readonly #cell: HTMLElement;
  readonly #flaps: HTMLElement[];
  readonly #accessibleValue: HTMLElement;
  #targets: string[];
  #ticker: ReturnType<typeof setInterval> | null = null;
  #ticksSinceRetarget = 0;

  constructor(cell: HTMLElement, flapCount: number) {
    this.#cell = cell;
    this.#flaps = Array.from({ length: flapCount }, createFlap);
    this.#targets = this.#flaps.map(() => BLANK_FLAP);
    const row = document.createElement('span');
    row.setAttribute(FLAP_ROW_ATTRIBUTE, '');
    row.setAttribute('aria-hidden', 'true');
    row.append(...this.#flaps);
    this.#accessibleValue = document.createElement('span');
    this.#accessibleValue.className = ACCESSIBLE_VALUE_CLASS;
    cell.replaceChildren(row, this.#accessibleValue);
  }

  setValue(value: string): void {
    this.#accessibleValue.textContent = value;
    const characters = [...value.toUpperCase()];
    if (characters.length > this.#flaps.length) {
      this.#cell.title = value;
    } else {
      this.#cell.removeAttribute('title');
    }
    const visible = characters.slice(0, this.#flaps.length);
    const padding = Array.from({ length: this.#flaps.length - visible.length }, () => BLANK_FLAP);
    this.#targets = [...visible, ...padding];
    this.#ticksSinceRetarget = 0;
    if (prefersReducedMotion()) {
      this.#stopTicker();
      this.#flaps.forEach((flap, index) => {
        setChar(flap, this.#targets[index] ?? BLANK_FLAP);
      });
      return;
    }
    if (this.#ticker === null) {
      this.#ticker = setInterval(() => this.#tick(), FLAP_STEP_MS);
    }
  }

  #tick(): void {
    let pending = false;
    this.#flaps.forEach((flap, index) => {
      const target = this.#targets[index] ?? BLANK_FLAP;
      const current = charOf(flap);
      if (current === target) {
        return;
      }
      pending = true;
      if (index > this.#ticksSinceRetarget) {
        return;
      }
      setChar(flap, nextChar(current, target));
      flap.animate(FLIP_KEYFRAMES, FLIP_DURATION_MS);
    });
    this.#ticksSinceRetarget += 1;
    if (!pending) {
      this.#stopTicker();
    }
  }

  #stopTicker(): void {
    if (this.#ticker !== null) {
      clearInterval(this.#ticker);
      this.#ticker = null;
    }
  }
}

function createFlap(): HTMLElement {
  const flap = document.createElement('span');
  flap.setAttribute(FLAP_ATTRIBUTE, '');
  setChar(flap, BLANK_FLAP);
  return flap;
}

function charOf(flap: HTMLElement): string {
  return flap.getAttribute(FLAP_CHAR_ATTRIBUTE) ?? BLANK_FLAP;
}

function setChar(flap: HTMLElement, char: string): void {
  flap.setAttribute(FLAP_CHAR_ATTRIBUTE, char);
}

function nextChar(current: string, target: string): string {
  const currentIndex = FLAP_ALPHABET.indexOf(current);
  if (currentIndex === -1 || !FLAP_ALPHABET.includes(target)) {
    return target;
  }
  return FLAP_ALPHABET[(currentIndex + 1) % FLAP_ALPHABET.length] ?? target;
}
