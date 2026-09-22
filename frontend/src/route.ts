import { CHANNEL_PAGE_PATH_PREFIX, isChannelKey } from '@pantograph/shared';

export function channelKeyFromLocation(location: Location): string | null {
  if (!location.pathname.startsWith(CHANNEL_PAGE_PATH_PREFIX)) {
    return null;
  }
  const key = location.pathname.slice(CHANNEL_PAGE_PATH_PREFIX.length);
  return isChannelKey(key) ? key : null;
}
