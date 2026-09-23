const PLATFORM_COUNT = 19n;
const FIRST_PLATFORM = 1n;
const DIGITS_ONLY_PATTERN = /^\d+$/;

export function platformNumberFor(channelId: string): number | null {
  if (!DIGITS_ONLY_PATTERN.test(channelId)) {
    return null;
  }
  return Number((BigInt(channelId) % PLATFORM_COUNT) + FIRST_PLATFORM);
}
