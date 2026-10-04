import { describe, expect, it } from 'vitest';
import { VI_MESSAGES, vietnameseWeekLabel } from './locale';

describe('Vietnamese locale helpers', () => {
  it('uses Vietnamese labels for receipt scanning and insights', () => {
    expect(VI_MESSAGES.scanReceipt).toBe('Quét hóa đơn');
    expect(VI_MESSAGES.insights).toBe('Phân tích');
  });

  it('formats relative week labels', () => {
    expect(vietnameseWeekLabel(0)).toBe('Tuần này');
    expect(vietnameseWeekLabel(-1)).toBe('Tuần trước');
    expect(vietnameseWeekLabel(2)).toBe('2 tuần tới');
    expect(vietnameseWeekLabel(-3)).toBe('3 tuần trước');
  });
});
