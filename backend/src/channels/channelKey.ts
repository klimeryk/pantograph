import { randomInt } from 'node:crypto';

const KEY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const KEY_CHARACTER_COUNT = 16;
const KEY_GROUP_SIZE = 4;
const KEY_GROUP_SEPARATOR = '-';

export function generateChannelKey(): string {
  const characters: string[] = [];
  for (let position = 0; position < KEY_CHARACTER_COUNT; position += 1) {
    characters.push(KEY_ALPHABET.charAt(randomInt(KEY_ALPHABET.length)));
  }
  const groups: string[] = [];
  for (let start = 0; start < characters.length; start += KEY_GROUP_SIZE) {
    groups.push(characters.slice(start, start + KEY_GROUP_SIZE).join(''));
  }
  return groups.join(KEY_GROUP_SEPARATOR);
}
