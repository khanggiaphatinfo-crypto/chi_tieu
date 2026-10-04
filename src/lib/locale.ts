export const VI_MESSAGES = {
  scanReceipt: 'Quét hóa đơn',
  insights: 'Phân tích',
  thisWeek: 'Tuần này',
  lastWeek: 'Tuần trước',
  nextWeek: 'Tuần sau',
  weeksAgo: (count: number) => `${count} tuần trước`,
  weeksAhead: (count: number) => `${count} tuần tới`,
} as const;

export function vietnameseWeekLabel(offset: number): string {
  if (offset === 0) return VI_MESSAGES.thisWeek;
  if (offset === -1) return VI_MESSAGES.lastWeek;
  if (offset === 1) return VI_MESSAGES.nextWeek;
  return offset < 0 ? VI_MESSAGES.weeksAgo(-offset) : VI_MESSAGES.weeksAhead(offset);
}

export function preserveDynamicValue(template: string, value: string): string {
  return template.replace('{value}', value);
}
