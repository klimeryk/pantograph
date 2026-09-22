import { channelPagePath } from '@pantograph/shared';

export function buildChannelLink(publicUrl: string, key: string): string {
  return `${publicUrl}${channelPagePath(key)}`;
}
