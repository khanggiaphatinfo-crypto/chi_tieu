// Các hàm ngày theo múi giờ địa phương.
// QUAN TRỌNG: không bao giờ suy ra “hôm nay” / khóa tháng / occurred_on từ
// Date.toISOString() — hàm này trả về ngày UTC, tại Argentina (UTC-3) sẽ chuyển sang ngày mai sau 21:00. Hãy dùng các hàm dưới đây.

export function toLocalISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayISO(): string {
  return toLocalISO(new Date());
}

export function monthKey(d: Date = new Date()): string {
  return toLocalISO(d).slice(0, 7);
}

/** Ngày bắt đầu (thứ Hai) và kết thúc (Chủ nhật) theo ISO của tuần chứa `d`. */
export function weekRange(d: Date = new Date()): { start: string; end: string } {
  const daysSinceMonday = (d.getDay() + 6) % 7; // getDay: 0=Sun..6=Sat
  const monday = new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysSinceMonday);
  const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
  return { start: toLocalISO(monday), end: toLocalISO(sunday) };
}

/** Dạng “DD/MM” ngắn để hiển thị (ví dụ chip khoảng tuần). */
export function shortDM(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

const MONTHS_ABBR = ['thg 1', 'thg 2', 'thg 3', 'thg 4', 'thg 5', 'thg 6', 'thg 7', 'thg 8', 'thg 9', 'thg 10', 'thg 11', 'thg 12'];

/** Dạng “D thg M” thân thiện (ví dụ “7 thg 7”), không có số 0 ở đầu ngày. */
export function shortDayMonth(iso: string): string {
  const day = parseInt(iso.slice(8, 10), 10);
  const month = parseInt(iso.slice(5, 7), 10) - 1;
  return `${day} ${MONTHS_ABBR[month] ?? ''}`.trim();
}
