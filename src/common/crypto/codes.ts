import { randomBytes } from 'node:crypto';

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function randomHumanCode(groups = 2, groupSize = 4) {
  const bytes = randomBytes(groups * groupSize);
  let offset = 0;
  const parts: string[] = [];
  for (let group = 0; group < groups; group += 1) {
    let part = '';
    for (let index = 0; index < groupSize; index += 1) {
      part += alphabet[bytes[offset++] % alphabet.length];
    }
    parts.push(part);
  }
  return parts.join('-');
}

export function randomSecret(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}
