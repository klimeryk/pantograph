export const FAKE_BACKEND_HOST = '127.0.0.1';
export const FAKE_BACKEND_PORT = 3100;
export const FAKE_BACKEND_ORIGIN = `http://${FAKE_BACKEND_HOST}:${FAKE_BACKEND_PORT}`;
export const FAKE_CHANNEL_KEY = 'fake-chan-nel0-0001';
export const FAKE_SECOND_CHANNEL_KEY = 'fake-chan-nel0-0002';
export const FAKE_UNKNOWN_CHANNEL_KEY = 'nope-nope-nope-nope';

const FAKE_CHANNELS_PATH_PREFIX = '/__fake/channels/';

export function fakeChannelEventsPath(key: string): string {
  return `${FAKE_CHANNELS_PATH_PREFIX}${key}/events`;
}

export function fakeChannelClosePath(key: string): string {
  return `${FAKE_CHANNELS_PATH_PREFIX}${key}/close`;
}
