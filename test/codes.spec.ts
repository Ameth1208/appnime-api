import { randomHumanCode } from '../src/common/crypto/codes';

describe('human codes', () => {
  it('creates grouped TV-friendly codes', () => {
    expect(randomHumanCode(2, 3)).toMatch(/^[A-Z2-9]{3}-[A-Z2-9]{3}$/);
  });
});
