export const FAKE_BACKEND_HOST = '127.0.0.1';
export const FAKE_BACKEND_PORT = 3100;
export const FAKE_BACKEND_ORIGIN = `http://${FAKE_BACKEND_HOST}:${FAKE_BACKEND_PORT}`;
export const FAKE_CHANNEL_KEY = 'fake-chan-nel0-0001';
export const FAKE_SECOND_CHANNEL_KEY = 'fake-chan-nel0-0002';
export const FAKE_UNKNOWN_CHANNEL_KEY = 'nope-nope-nope-nope';

export const FAKE_STICKER_JSON_BASE_URL = `${FAKE_BACKEND_ORIGIN}/__fake/stickers/`;
export const FAKE_LOTTIE_STICKER_ID = '1552081214045822976';
export const FAKE_IMAGE_STICKER_ID = '1552081214045822977';

const FAKE_CHANNELS_PATH_PREFIX = '/__fake/channels/';
const FAKE_STICKERS_PATH_PREFIX = '/__fake/stickers/';

export function fakeStickerJsonPath(id: string): string {
  return `${FAKE_STICKERS_PATH_PREFIX}${id}.json`;
}

export function fakeChannelEventsPath(key: string): string {
  return `${FAKE_CHANNELS_PATH_PREFIX}${key}/events`;
}

export function fakeChannelClosePath(key: string): string {
  return `${FAKE_CHANNELS_PATH_PREFIX}${key}/close`;
}
