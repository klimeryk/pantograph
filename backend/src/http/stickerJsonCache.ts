const STICKER_FETCH_TIMEOUT_MS = 5000;
const MAX_STICKER_JSON_CHARACTERS = 2_000_000;
const MAX_CACHED_CHARACTERS = 20_000_000;
const FAILURE_RETRY_AFTER_MS = 60_000;
const MAX_REMEMBERED_FAILURES = 1000;
const CONTENT_LENGTH_HEADER = 'Content-Length';
const JSON_EXTENSION = '.json';

export class StickerJsonCache {
  readonly #baseUrl: string;
  readonly #animationsById = new Map<string, string>();
  readonly #inFlightById = new Map<string, Promise<string | null>>();
  readonly #failedAtById = new Map<string, number>();
  #cachedCharacters = 0;

  constructor(baseUrl: string) {
    this.#baseUrl = baseUrl;
  }

  get(stickerId: string): Promise<string | null> {
    const cached = this.#animationsById.get(stickerId);
    if (cached !== undefined) {
      this.#animationsById.delete(stickerId);
      this.#animationsById.set(stickerId, cached);
      return Promise.resolve(cached);
    }
    if (this.#failedRecently(stickerId)) {
      return Promise.resolve(null);
    }
    const inFlight = this.#inFlightById.get(stickerId);
    if (inFlight !== undefined) {
      return inFlight;
    }
    const request = this.#fetchAndRemember(stickerId);
    this.#inFlightById.set(stickerId, request);
    return request;
  }

  async #fetchAndRemember(stickerId: string): Promise<string | null> {
    try {
      const animation = await fetchStickerJson(this.#baseUrl, stickerId);
      if (animation === null) {
        this.#rememberFailure(stickerId);
      } else {
        this.#store(stickerId, animation);
      }
      return animation;
    } finally {
      this.#inFlightById.delete(stickerId);
    }
  }

  #failedRecently(stickerId: string): boolean {
    const failedAt = this.#failedAtById.get(stickerId);
    if (failedAt === undefined) {
      return false;
    }
    if (Date.now() - failedAt < FAILURE_RETRY_AFTER_MS) {
      return true;
    }
    this.#failedAtById.delete(stickerId);
    return false;
  }

  #rememberFailure(stickerId: string): void {
    if (this.#failedAtById.size >= MAX_REMEMBERED_FAILURES) {
      const oldestId = this.#failedAtById.keys().next().value;
      if (oldestId !== undefined) {
        this.#failedAtById.delete(oldestId);
      }
    }
    this.#failedAtById.set(stickerId, Date.now());
  }

  #store(stickerId: string, animation: string): void {
    for (const [cachedId, cachedAnimation] of this.#animationsById) {
      if (this.#cachedCharacters + animation.length <= MAX_CACHED_CHARACTERS) {
        break;
      }
      this.#animationsById.delete(cachedId);
      this.#cachedCharacters -= cachedAnimation.length;
    }
    this.#animationsById.set(stickerId, animation);
    this.#cachedCharacters += animation.length;
  }
}

async function fetchStickerJson(baseUrl: string, stickerId: string): Promise<string | null> {
  try {
    const response = await fetch(new URL(`${stickerId}${JSON_EXTENSION}`, baseUrl), {
      signal: AbortSignal.timeout(STICKER_FETCH_TIMEOUT_MS),
    });
    if (!response.ok || declaredLength(response) > MAX_STICKER_JSON_CHARACTERS) {
      return null;
    }
    const animation = await response.text();
    return animation.length > MAX_STICKER_JSON_CHARACTERS ? null : animation;
  } catch {
    return null;
  }
}

function declaredLength(response: Response): number {
  const header = response.headers.get(CONTENT_LENGTH_HEADER);
  const length = header === null ? 0 : Number(header);
  return Number.isFinite(length) ? length : 0;
}
