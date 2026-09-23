import { stickerLottiePath } from '@pantograph/shared';
import type { AnimationItem } from 'lottie-web/build/player/lottie_light';
import { prefersReducedMotion } from './motion.ts';

const LOTTIE_RENDERER = 'svg';
const LOTTIE_LOAD_FAILED_EVENT = 'data_failed';
const SUBFRAME_RENDERING = false;
const INTERSECTION_THRESHOLD = 0;
const VISIBILITY_CHANGE_EVENT = 'visibilitychange';
const HIDDEN_VISIBILITY_STATE: DocumentVisibilityState = 'hidden';
const STICKER_STATE_ATTRIBUTE = 'data-sticker-state';
const StickerState = { Playing: 'playing', Paused: 'paused' } as const;
type StickerState = (typeof StickerState)[keyof typeof StickerState];

type LottieModule = typeof import('lottie-web/build/player/lottie_light').default;

type MountedSticker = {
  animation: AnimationItem;
  stickerItem: Element;
  intersecting: boolean;
};

export class LottieStickerPlayer {
  readonly #observer: IntersectionObserver;
  readonly #mountedByContainer = new Map<Element, MountedSticker>();
  readonly #containersByItem = new WeakMap<Element, Element[]>();
  readonly #discardedItems = new WeakSet<Element>();
  #documentVisible = isDocumentVisible();

  constructor(scrollRoot: Element) {
    this.#observer = new IntersectionObserver((entries) => this.#onIntersection(entries), {
      root: scrollRoot,
      threshold: INTERSECTION_THRESHOLD,
    });
    document.addEventListener(VISIBILITY_CHANGE_EVENT, () => {
      this.#documentVisible = isDocumentVisible();
      for (const mounted of this.#mountedByContainer.values()) {
        this.#syncPlayback(mounted);
      }
    });
  }

  mount(
    item: Element,
    stickerItem: Element,
    container: HTMLElement,
    stickerId: string,
    onFailed: () => void,
  ): void {
    void this.#load(item, stickerItem, container, stickerId, onFailed);
  }

  discard(item: Element): void {
    this.#discardedItems.add(item);
    for (const container of this.#containersByItem.get(item) ?? []) {
      const mounted = this.#mountedByContainer.get(container);
      if (mounted === undefined) {
        continue;
      }
      this.#observer.unobserve(container);
      mounted.animation.destroy();
      this.#mountedByContainer.delete(container);
    }
    this.#containersByItem.delete(item);
  }

  async #load(
    item: Element,
    stickerItem: Element,
    container: HTMLElement,
    stickerId: string,
    onFailed: () => void,
  ): Promise<void> {
    const lottie = await importLottie();
    if (lottie === null) {
      onFailed();
      return;
    }
    if (this.#discardedItems.has(item)) {
      return;
    }
    const animation = lottie.loadAnimation({
      container,
      renderer: LOTTIE_RENDERER,
      loop: true,
      autoplay: false,
      path: stickerLottiePath(stickerId),
    });
    animation.setSubframe(SUBFRAME_RENDERING);
    animation.addEventListener(LOTTIE_LOAD_FAILED_EVENT, onFailed);
    const mounted: MountedSticker = { animation, stickerItem, intersecting: false };
    this.#mountedByContainer.set(container, mounted);
    this.#containersByItem.set(item, [...(this.#containersByItem.get(item) ?? []), container]);
    this.#syncPlayback(mounted);
    this.#observer.observe(container);
  }

  #onIntersection(entries: IntersectionObserverEntry[]): void {
    for (const entry of entries) {
      const mounted = this.#mountedByContainer.get(entry.target);
      if (mounted === undefined) {
        continue;
      }
      mounted.intersecting = entry.isIntersecting;
      this.#syncPlayback(mounted);
    }
  }

  #syncPlayback(mounted: MountedSticker): void {
    const state: StickerState =
      mounted.intersecting && this.#documentVisible && !prefersReducedMotion()
        ? StickerState.Playing
        : StickerState.Paused;
    if (state === StickerState.Playing) {
      mounted.animation.play();
    } else {
      mounted.animation.pause();
    }
    mounted.stickerItem.setAttribute(STICKER_STATE_ATTRIBUTE, state);
  }
}

function isDocumentVisible(): boolean {
  return document.visibilityState !== HIDDEN_VISIBILITY_STATE;
}

async function importLottie(): Promise<LottieModule | null> {
  try {
    return (await import('lottie-web/build/player/lottie_light')).default;
  } catch {
    return null;
  }
}
