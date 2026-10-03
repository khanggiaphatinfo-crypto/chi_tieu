// Pure money-math for ask-morchis — NO runtime imports beyond the shared money
// kernel, so it runs identically under Node/Vitest. index.ts imports everything
// here; the handler keeps the I/O (Supabase queries, Claude calls). All currency
// is normalised to ARS; the only arithmetic Morchi shows comes from these functions.
import { toArs, personalShareArs } from "../_shared/money.ts";

export { toArs };

export const iso = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
export const MONTHLY: Record<string, number> = { weekly: 4.345, biweekly: 2.17, monthly: 1 };
export const norm = (s: string) => (s ?? '').toLowerCase();

export function jwtPayload(token: string): Record<string, unknown> | null {
  try { return JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return null; }
}

export interface Split { payer_profile_id: string; ower_profile_id: string; amount: number }
export interface Debt { transaction_id: string | null; direction: string; amount: number; currency: string }
export interface ExpRow { id: string; profile_id: string; scope: string; is_shared: boolean; amount: number; currency: string; usd_rate_snapshot: number | null; splits: Split[] | null }
export interface ItemParent { occurred_on: string; currency: string; usd_rate_snapshot: number | null; scope: string; is_shared: boolean; profile_id: string; amount: number; splits: Split[] | null }

// Minimal context shapes the pure functions need — the handler's full Ctx
// (with the Supabase client) structurally satisfies these.
export interface MoneyCtx { blue: number; debtByTx: Record<string, Debt[]> }
export interface PrimerCtx { blue: number; pm: Record<string, string>; askerId: string; partnerId: string | null; catNames: string }

export function owedBackArs(txId: string, debtByTx: Record<string, Debt[]>, blue: number): number {
  return (debtByTx[txId] ?? []).filter(d => d.direction === 'owed').reduce((s, d) => s + toArs(d.amount, d.currency, null, blue), 0);
}

// Amount of an expense attributable to a lens, in ARS:
//  - 'everyone'  → full amount (total money the couple spent)
//  - 'household' → only shared/household-scope expenses, full
//  - a profileId → that person's own expenses + their split share of shared ones
//                  (via the shared personalShareArs kernel)
// Money a friend repays (a linked 'owed' debt) is netted out of the real cost.
export function shareForExpense(t: ExpRow, lens: string, ctx: MoneyCtx): number {
  const total = toArs(t.amount, t.currency, t.usd_rate_snapshot, ctx.blue);
  let base: number, owns: boolean;
  if (lens === 'everyone') { base = total; owns = true; }
  else if (lens === 'household') { if (t.scope !== 'household') return 0; base = total; owns = true; }
  else { base = personalShareArs(t, lens, ctx.blue); owns = t.profile_id === lens; }
  if (base <= 0) return 0;
  return owns ? Math.max(0, base - owedBackArs(t.id, ctx.debtByTx, ctx.blue)) : base;
}

// Fraction of a transaction attributable to a lens (0..1), for splitting line items.
export function lensFraction(p: ItemParent, lensTarget: string, blue: number): number {
  const total = toArs(p.amount, p.currency, p.usd_rate_snapshot, blue);
  if (lensTarget === 'everyone') return 1;
  if (lensTarget === 'household') return p.scope === 'household' ? 1 : 0;
  return total > 0 ? personalShareArs(p, lensTarget, blue) / total : 0;
}

export function buildPrimer(ctx: PrimerCtx): string {
  // ARG is UTC-3: compute the local calendar there so "hoy" y los rangos
  // coinciden con lo que ve el usuario, incluso de noche (cuando UTC ya pasó al
  // día siguiente). Todos los rangos van pre-calculados para que el modelo NO
  // tenga que hacer aritmética de fechas (la causa más común de números mal).
  const art = new Date(Date.now() - 3 * 60 * 60 * 1000);
  const y = art.getUTCFullYear(), m = art.getUTCMonth(), d = art.getUTCDate();
  const months = ['tháng Một', 'tháng Hai', 'tháng Ba', 'tháng Tư', 'tháng Năm', 'tháng Sáu', 'tháng Bảy', 'tháng Tám', 'tháng Chín', 'tháng Mười', 'tháng Mười Một', 'tháng Mười Hai'];
  const fmt = (dt: Date) => `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
  const u = (yy: number, mm: number, dd: number) => new Date(Date.UTC(yy, mm, dd));
  const day = 86400000;
  const today = fmt(u(y, m, d));
  const asker = ctx.pm[ctx.askerId] ?? 'người dùng';
  const partner = ctx.partnerId ? (ctx.pm[ctx.partnerId] ?? 'người yêu của họ') : 'người yêu của họ';
  return [
    `Hôm nay là ${today} (${months[m]} năm ${y}).`,
    `Người đang viết cho bạn là ${asker}. Người yêu của họ là ${partner}.`,
    'Các khoảng thời gian ĐÃ ĐƯỢC TÍNH SẴN để dùng nguyên văn trong date_from / date_to (ĐỪNG tự tính lại):',
    `- tháng này: ${fmt(u(y, m, 1))} đến ${today}`,
    `- tháng trước: ${fmt(u(y, m - 1, 1))} đến ${fmt(u(y, m, 0))}`,
    `- năm nay: ${fmt(u(y, 0, 1))} đến ${today}`,
    `- năm ngoái: ${fmt(u(y - 1, 0, 1))} đến ${fmt(u(y - 1, 11, 31))}`,
    `- 7 ngày qua: ${fmt(new Date(u(y, m, d).getTime() - 6 * day))} đến ${today}`,
    `- 30 ngày qua: ${fmt(new Date(u(y, m, d).getTime() - 29 * day))} đến ${today}`,
    'Nếu câu hỏi KHÔNG nêu khoảng thời gian, hãy mặc định là "tháng này" và nói rõ trong câu trả lời (ví dụ: "tháng này...").',
    `Các danh mục chi tiêu hiện có (dùng đúng tên này khi lọc): ${ctx.catNames || 'không có dữ liệu'}.`,
    'Mỗi khoản chi có thể là chi tiêu cá nhân hoặc của hộ gia đình (dùng chung). Với "của tôi" hãy dùng lens="mine"; với người yêu dùng lens="partner"; với phần dùng chung/của hộ gia đình/"cùng nhau" dùng lens="household"; với tổng cộng dùng lens="everyone".',
    'Đơn vị tiền tệ cơ sở là peso Argentina (ARS); các khoản USD đã được công cụ quy đổi sẵn.',
  ].join('\n');
}
