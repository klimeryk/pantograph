import { requireElement } from './dom.ts';

const CONTACT_ATTRIBUTE = 'data-contact';
const Contact = { Raised: 'raised', Lowered: 'lowered' } as const;
const ARC_PEAK_OFFSET = 0.2;
const ARC_DURATION_MS = 300;
const ARC_KEYFRAMES: Keyframe[] = [
  { opacity: 0 },
  { opacity: 1, offset: ARC_PEAK_OFFSET },
  { opacity: 0 },
];

export class PantographIndicator {
  readonly #svg: SVGElement;
  readonly #arc: SVGElement;

  constructor(root: ParentNode) {
    this.#svg = requireElement<SVGElement>(root, '[data-pantograph]');
    this.#arc = requireElement<SVGElement>(root, '[data-arc]');
  }

  setRaised(raised: boolean): void {
    this.#svg.setAttribute(CONTACT_ATTRIBUTE, raised ? Contact.Raised : Contact.Lowered);
  }

  spark(): void {
    this.#arc.animate(ARC_KEYFRAMES, ARC_DURATION_MS);
  }
}
