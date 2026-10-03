import { toLocalISO } from '@/lib/date';

// Tính toán lịch lặp dùng chung cho `recurring_rules`. Được tách từ reglas-client để
// dải thanh ghi (các khoản sắp đến hạn) và dự báo dòng tiền dùng cùng logic với màn hình quy tắc và cron.
//
// (Phép tính mili-giây an toàn: Argentina không có DST nên mỗi ngày luôn là 24 giờ.)

export interface RecurrenceLike {
  cadence: string; // 'weekly' | 'biweekly' | 'monthly'
  anchor_day: number | null;
  next_run: string | null;
}

// Ngày trong tháng cho một năm/tháng, giới hạn theo số ngày thực tế của tháng — tương ứng với
// ngày 31 trong tháng 2 sẽ tràn sang tháng 3 và làm lệch lịch. Vì vậy, ngày 31 nghĩa là “ngày cuối tháng”.
export function dayOfMonth(year: number, month: number, day: number): Date {
  const lastDay = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, lastDay));
}

// Số ngày nguyên tính từ đầu hôm nay đến ngày ISO đã cho (âm = quá khứ).
export function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(dateStr + 'T00:00:00');
  return Math.round((d.getTime() - today.getTime()) / 86400000);
}

// Nhãn thân thiện cho số ngày lệch: “Hôm nay” / “Ngày mai” / “Sau N ngày”.
export function whenLabel(d: number): string {
  if (d <= 0) return 'Hôm nay';
  if (d === 1) return 'Ngày mai';
  return `Sau ${d} ngày`;
}

// Đếm số lần một thứ trong tuần (0=CN..6=Thứ Bảy) xuất hiện trong tháng.
export function weekdayOccurrencesInMonth(weekday: number, year: number, month: number): number {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  let count = 0;
  for (let day = 1; day <= daysInMonth; day++) {
    if (new Date(year, month, day).getDay() === weekday) count++;
  }
  return count;
}

// Chuẩn hóa mọi tần suất thành số lần thực tế trong tháng hiện tại để tổng tiền
// phản ánh đúng số lần phát sinh (ví dụ chi hàng tuần vào thứ Năm đếm đúng số thứ Năm
// trong tháng, không lấy trung bình 4,33; chi hai tuần một lần đếm đúng các ngày chu kỳ 14 ngày
// (có thể từ 1–3 lần).
export function monthlyEquivalent(amount: number, cadence: string, anchorDay: number | null, nextRun: string | null): number {
  if (cadence === 'weekly') {
    const now = new Date();
    const weekday = anchorDay != null ? ((anchorDay % 7) + 7) % 7 : now.getDay();
    return amount * weekdayOccurrencesInMonth(weekday, now.getFullYear(), now.getMonth());
  }
  if (cadence === 'biweekly') {
    if (!nextRun) return amount * 2;
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const step = 14 * 86400000;
    const monthStart = new Date(year, month, 1).getTime();
    let t = new Date(nextRun + 'T00:00:00').getTime();
    while (t - step >= monthStart) t -= step;
    while (t < monthStart) t += step;
    let count = 0;
    for (let d = new Date(t); d.getFullYear() === year && d.getMonth() === month; d = new Date(d.getTime() + step)) {
      count++;
    }
    return amount * count;
  }
  return amount;
}

// Tăng ngày thêm một chu kỳ theo tần suất của quy tắc. Tương ứng với cron
// (+7 / +14 / cùng ngày neo ở tháng sau, giới hạn theo số ngày trong tháng).
export function advanceOccurrence(dateISO: string, rule: RecurrenceLike): string {
  const base = new Date(dateISO + 'T00:00:00');
  if (rule.cadence === 'weekly') return toLocalISO(new Date(base.getTime() + 7 * 86400000));
  if (rule.cadence === 'biweekly') return toLocalISO(new Date(base.getTime() + 14 * 86400000));
  const anchor = rule.anchor_day ?? base.getDate();
  return toLocalISO(dayOfMonth(base.getFullYear(), base.getMonth() + 1, anchor));
}

// Tăng next_run của chính quy tắc thêm một chu kỳ nhưng KHÔNG tạo giao dịch — dùng để bỏ qua
// một lần phát sinh trên màn hình quy tắc.
export function advanceNextRun(rule: RecurrenceLike): string {
  return advanceOccurrence(rule.next_run ?? toLocalISO(new Date()), rule);
}

// Mở rộng các ngày phát sinh tương lai (ISO) trong [fromISO, toISO]
// bao gồm cả hai đầu, bắt đầu từ next_run. Giới hạn số vòng lặp để an toàn.
export function expandOccurrences(rule: RecurrenceLike, fromISO: string, toISO: string): string[] {
  if (!rule.next_run) return [];
  const out: string[] = [];
  let cur = rule.next_run;
// Bỏ nhanh đến đầu khoảng thời gian nếu next_run nằm trước khoảng đó.
  let guard = 0;
  while (cur < fromISO && guard++ < 1000) cur = advanceOccurrence(cur, rule);
  while (cur <= toISO && guard++ < 1000) {
    if (cur >= fromISO) out.push(cur);
    cur = advanceOccurrence(cur, rule);
  }
  return out;
}
