import { addMonths, addYears } from '../src/common/dates/date-math';

describe('date math', () => {
  it('uses calendar months instead of 30 day blocks', () => {
    expect(addMonths(new Date('2026-01-31T12:00:00Z'), 1).toISOString()).toBe('2026-02-28T12:00:00.000Z');
  });

  it('handles leap year annual renewal', () => {
    expect(addYears(new Date('2024-02-29T12:00:00Z'), 1).toISOString()).toBe('2025-02-28T12:00:00.000Z');
  });
});
