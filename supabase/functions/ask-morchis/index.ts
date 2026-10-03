import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import Anthropic from "npm:@anthropic-ai/sdk";
import { createClient, SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { iso, MONTHLY, norm, toArs, jwtPayload, shareForExpense, lensFraction, buildPrimer } from "./math.ts";
import type { Debt, ExpRow, ItemParent } from "./math.ts";
import { computeProjection } from "../_shared/projection.ts";

// "Preguntale a Morchi" — an agent that can answer ANY question about the
// household finances. Claude has tools to query the database; every tool runs a
// deterministic TypeScript aggregation (USD normalised to ARS). The model only
// decides what to query and writes the answer — it never does arithmetic.
//
// The `lens` of aggregate_transactions mirrors the coach: it distinguishes a
// person's own share (personal + their split of shared, minus what a friend
// repays) from the household's shared spending, so the chat can tell apart
// "mis gastos" from "gastos del hogar" based on the question.

interface Ctx {
  admin: SupabaseClient; hid: string; blue: number;
  pm: Record<string, string>; askerId: string; partnerId: string | null;
  debtByTx: Record<string, Debt[]>; catNames: string;
}

// ── tool executors (all money math lives here) ───────────────────────────────
interface AggInput { type?: string; lens?: string; group_by?: string; category?: string; merchant?: string; date_from?: string; date_to?: string; limit?: number }
async function aggregateTransactions(ctx: Ctx, input: AggInput) {
  const type = input.type === 'income' ? 'income' : 'expense';
  const lensParam = input.lens ?? 'everyone';
  const lensTarget = lensParam === 'mine' ? ctx.askerId : lensParam === 'partner' ? (ctx.partnerId ?? '__none__') : lensParam; // 'household' | 'everyone' | profileId
  let q = ctx.admin.from('transactions')
    .select('id,categories(name),profile_id,scope,is_shared,amount,currency,usd_rate_snapshot,merchant,occurred_on,splits(payer_profile_id,ower_profile_id,amount)')
    .eq('household_id', ctx.hid).eq('type', type).eq('exclude_from_stats', false);
  if (input.date_from) q = q.gte('occurred_on', input.date_from);
  if (input.date_to) q = q.lte('occurred_on', input.date_to);
  const { data } = await q;
  let rows = ((data ?? []) as (ExpRow & { categories: { name: string } | null; merchant: string | null; occurred_on: string })[]);
  if (input.category) rows = rows.filter(r => norm(r.categories?.name ?? '').includes(norm(input.category!)));
  if (input.merchant) rows = rows.filter(r => norm(r.merchant ?? '').includes(norm(input.merchant!)));

  // income has no shares/scope: a person's income = what they received; household/everyone = all.
  const contrib = (t: typeof rows[number], lens: string): number => {
    if (type === 'income') {
      const total = toArs(t.amount, t.currency, t.usd_rate_snapshot, ctx.blue);
      return (lens === 'everyone' || lens === 'household') ? total : (t.profile_id === lens ? total : 0);
    }
    return shareForExpense(t, lens, ctx);
  };

  const gb = input.group_by && input.group_by !== 'none' ? input.group_by : null;

  if (gb === 'person') {
    // each person's own share (ignores lens; this IS the per-person split)
    const people = Object.entries(ctx.pm);
    const groups = people.map(([pid, name]) => ({ key: name, total_ars: Math.round(rows.reduce((s, t) => s + contrib(t, pid), 0)), count: rows.filter(t => contrib(t, pid) > 0).length }))
      .filter(g => g.total_ars > 0).sort((a, b) => b.total_ars - a.total_ars);
    return { type, lens: 'por persona', total_ars: groups.reduce((s, g) => s + g.total_ars, 0), group_by: 'person', groups };
  }

  if (lensTarget === '__none__') return { type, note: 'Không tìm thấy người đó trong hộ gia đình.', total_ars: 0, groups: [] };

  const withShare = rows.map(t => ({ t, ars: contrib(t, lensTarget) })).filter(x => x.ars > 0);
  const total = withShare.reduce((s, x) => s + x.ars, 0);
  let groups: { key: string; total_ars: number; count: number }[] = [];
  if (gb) {
    const map: Record<string, { total: number; count: number }> = {};
    for (const { t, ars } of withShare) {
      const k = gb === 'category' ? (t.categories?.name ?? 'Chưa phân loại') : gb === 'merchant' ? (t.merchant || '(không có cửa hàng)') : gb === 'month' ? (t.occurred_on || '').slice(0, 7) : (t.scope ?? '?');
      if (!map[k]) map[k] = { total: 0, count: 0 };
      map[k].total += ars; map[k].count++;
    }
    groups = Object.entries(map).map(([key, v]) => ({ key, total_ars: Math.round(v.total), count: v.count }))
      .sort((a, b) => gb === 'month' ? a.key.localeCompare(b.key) : b.total_ars - a.total_ars).slice(0, input.limit || 12);
  }
  const lensLabel = lensParam === 'mine' ? `${ctx.pm[ctx.askerId] ?? 'bạn'} (phần của bạn)` : lensParam === 'partner' ? `${ctx.partnerId ? ctx.pm[ctx.partnerId] : 'người yêu'} (phần của họ)` : lensParam === 'household' ? 'hộ gia đình / dùng chung' : 'toàn bộ hộ gia đình (gộp chung)';
  return { type, lens: lensLabel, total_ars: Math.round(total), count: withShare.length, group_by: gb ?? 'none', groups, note: withShare.length === 0 ? 'Không có giao dịch phù hợp với các bộ lọc đó.' : undefined };
}

async function getBalances(ctx: Ctx) {
  const todayStr = new Date().toISOString().slice(0, 10);
  const [{ data: accts }, { data: atx }] = await Promise.all([
    ctx.admin.from('accounts').select('id,name,type,currency,initial_balance').eq('household_id', ctx.hid).eq('archived', false),
    ctx.admin.from('transactions').select('account_id,transfer_account_id,type,amount,occurred_on').eq('household_id', ctx.hid).not('account_id', 'is', null),
  ]);
  const tx = (atx ?? []) as { account_id: string | null; transfer_account_id: string | null; type: string; amount: number; occurred_on: string }[];
  const balOf = (id: string, initial: number) => tx.reduce((s, t) => {
    if (t.occurred_on > todayStr) return s;
    if (t.account_id === id) { if (t.type === 'income') return s + t.amount; if (t.type === 'expense' || t.type === 'transfer') return s - t.amount; return s; }
    if (t.type === 'transfer' && t.transfer_account_id === id) return s + t.amount;
    return s;
  }, initial);
  let netWorth = 0;
  const accounts = ((accts ?? []) as { id: string; name: string; type: string; currency: string; initial_balance: number }[]).map(a => {
    const bal = balOf(a.id, a.initial_balance ?? 0);
    const balArs = a.currency === 'USD' ? bal * ctx.blue : bal;
    if (a.type !== 'credit') netWorth += balArs;
    return { name: a.name, type: a.type, currency: a.currency, balance: Math.round(bal), balance_ars: Math.round(balArs) };
  });
  return { accounts, net_worth_ars: Math.round(netWorth), note: 'Tài sản ròng không bao gồm thẻ tín dụng.' };
}

async function getBudgets(ctx: Ctx) {
  const now = new Date(); const y = now.getFullYear(), m = now.getMonth();
  // Envelope model: a category's "budget" is its monthly target (category_targets).
  const [{ data: buds }, { data: exp }] = await Promise.all([
    ctx.admin.from('category_targets').select('target_amount,currency,profile_id,categories(name)').eq('household_id', ctx.hid),
    ctx.admin.from('transactions').select('id,categories(name),profile_id,scope,is_shared,amount,currency,usd_rate_snapshot,splits(payer_profile_id,ower_profile_id,amount)').eq('household_id', ctx.hid).eq('type', 'expense').eq('exclude_from_stats', false).gte('occurred_on', iso(y, m, 1)).lt('occurred_on', iso(y, m + 1, 1)),
  ]);
  const rows = (exp ?? []) as (ExpRow & { categories: { name: string } | null })[];
  return {
    budgets: ((buds ?? []) as { target_amount: number; currency: string; profile_id: string | null; categories: { name: string } | null }[]).map(b => {
      const name = b.categories?.name ?? '';
      const limit = b.currency === 'USD' ? b.target_amount * ctx.blue : b.target_amount;
      const lens = b.profile_id ?? ctx.askerId;
      const spent = rows.filter(t => (t.categories?.name ?? '') === name).reduce((s, t) => s + shareForExpense(t, lens, ctx), 0);
      return { category: name, scope: 'personal', owner: b.profile_id ? (ctx.pm[b.profile_id] ?? null) : null, spent_ars: Math.round(spent), limit_ars: Math.round(limit), pct: limit > 0 ? Math.round(spent / limit * 100) : 0 };
    }),
  };
}

async function getGoals(ctx: Ctx) {
  // Savings goals are is_goal categories with a target; progress = Σ assigned to date.
  const [{ data: cats }, { data: tgts }, { data: bm }] = await Promise.all([
    ctx.admin.from('categories').select('id,name').eq('household_id', ctx.hid).eq('is_goal', true),
    ctx.admin.from('category_targets').select('category_id,target_amount,currency,target_date,profile_id').eq('household_id', ctx.hid),
    ctx.admin.from('budget_months').select('category_id,assigned,currency').eq('household_id', ctx.hid),
  ]);
  const targets = (tgts ?? []) as { category_id: string; target_amount: number; currency: string; target_date: string | null; profile_id: string | null }[];
  const assigned = (bm ?? []) as { category_id: string; assigned: number; currency: string }[];
  return {
    goals: ((cats ?? []) as { id: string; name: string }[]).map(c => {
      const t = targets.find(x => x.category_id === c.id);
      if (!t) return null;
      const current = assigned.filter(a => a.category_id === c.id).reduce((s, a) => s + (a.currency === 'USD' ? a.assigned * ctx.blue : a.assigned), 0);
      const target = t.currency === 'USD' ? t.target_amount * ctx.blue : t.target_amount;
      return { name: c.name, scope: 'personal', owner: t.profile_id ? (ctx.pm[t.profile_id] ?? null) : null, current: Math.round(current), target: Math.round(target), currency: 'ARS', pct: target > 0 ? Math.round(current / target * 100) : 0, deadline: t.target_date };
    }).filter(Boolean),
  };
}

async function getDebts(ctx: Ctx) {
  const { data } = await ctx.admin.from('debts').select('counterparty,direction,amount,currency,note').eq('household_id', ctx.hid).eq('settled', false);
  return { debts: ((data ?? []) as { counterparty: string; direction: string; amount: number; currency: string; note: string | null }[]).map(d => ({ counterparty: d.counterparty, direction: d.direction === 'owe' ? 'debemos' : 'nos deben', amount: Math.round(d.amount), currency: d.currency, note: d.note })) };
}

async function getRecurring(ctx: Ctx) {
  const { data } = await ctx.admin.from('recurring_rules').select('label,amount,currency,cadence,direction,scope,profile_id,categories(name)').eq('household_id', ctx.hid).eq('active', true);
  const rows = ((data ?? []) as { label: string; amount: number; currency: string; cadence: string; direction: string; scope: string; profile_id: string; categories: { name: string } | null }[]).map(r => ({
    label: r.label, direction: r.direction, category: r.categories?.name ?? null, scope: r.scope, owner: ctx.pm[r.profile_id] ?? null,
    monthly_ars: Math.round((r.currency === 'USD' ? r.amount * ctx.blue : r.amount) * (MONTHLY[r.cadence] ?? 1)), cadence: r.cadence,
  }));
  const expTotal = rows.filter(r => r.direction === 'expense').reduce((s, r) => s + r.monthly_ars, 0);
  return { rules: rows, fixed_expense_monthly_ars: Math.round(expTotal) };
}

// Analyse the line ITEMS inside scanned receipts (transaction_items): what was
// actually bought, grouped by type or product name. Amounts are in the parent
// transaction's currency → normalised to ARS, and split by lens proportionally.
interface ItemAggInput { lens?: string; group?: string; group_by?: string; date_from?: string; date_to?: string; limit?: number }
async function aggregateItems(ctx: Ctx, input: ItemAggInput) {
  const lensParam = input.lens ?? 'everyone';
  const lensTarget = lensParam === 'mine' ? ctx.askerId : lensParam === 'partner' ? (ctx.partnerId ?? '__none__') : lensParam;
  if (lensTarget === '__none__') return { note: 'Không tìm thấy người đó.', total_ars: 0, groups: [] };
  let q = ctx.admin.from('transaction_items')
    .select('item_group,name,line_total,transactions!inner(occurred_on,currency,usd_rate_snapshot,scope,is_shared,profile_id,amount,type,splits(payer_profile_id,ower_profile_id,amount))')
    .eq('household_id', ctx.hid).eq('transactions.type', 'expense').eq('transactions.exclude_from_stats', false);
  if (input.date_from) q = q.gte('transactions.occurred_on', input.date_from);
  if (input.date_to) q = q.lte('transactions.occurred_on', input.date_to);
  const { data } = await q;
  type Row = { item_group: string; name: string; line_total: number; transactions: ItemParent };
  let rows = (data ?? []) as unknown as Row[];
  if (input.group) rows = rows.filter(r => norm(r.item_group ?? '').includes(norm(input.group!)));
  const withArs = rows.map(r => ({ r, ars: toArs(r.line_total, r.transactions.currency, r.transactions.usd_rate_snapshot, ctx.blue) * lensFraction(r.transactions, lensTarget, ctx.blue) })).filter(x => x.ars > 0);
  const total = withArs.reduce((s, x) => s + x.ars, 0);
  const gb = input.group_by === 'name' ? 'name' : 'item_group';
  const map: Record<string, { total: number; count: number }> = {};
  for (const { r, ars } of withArs) { const k = gb === 'name' ? r.name : (r.item_group || 'otros'); if (!map[k]) map[k] = { total: 0, count: 0 }; map[k].total += ars; map[k].count++; }
  const groups = Object.entries(map).map(([key, v]) => ({ key, total_ars: Math.round(v.total), count: v.count })).sort((a, b) => b.total_ars - a.total_ars).slice(0, input.limit || 12);
  return { total_ars: Math.round(total), items_count: withArs.length, group_by: gb, groups, note: withArs.length === 0 ? 'Không có mặt hàng trên hóa đơn phù hợp với các bộ lọc đó (mặt hàng được thêm khi quét hóa đơn).' : undefined };
}

// End-of-month projection for the whole household, with optional purchase sim.
interface ProjInput { purchase_amount?: number; purchase_currency?: string; installments?: number }
async function projectMonth(ctx: Ctx, input: ProjInput) {
  const artNow = new Date(Date.now() - 3 * 60 * 60 * 1000); // ARG (UTC-3)
  const y = artNow.getUTCFullYear(), m = artNow.getUTCMonth();
  const ms = `${y}-${String(m + 1).padStart(2, '0')}-01`;
  const dim = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const me = `${y}-${String(m + 1).padStart(2, '0')}-${String(dim).padStart(2, '0')}`;
  const [{ data: txRows }, { data: ruleRows }] = await Promise.all([
    ctx.admin.from('transactions').select('type,amount,currency,usd_rate_snapshot,occurred_on').eq('household_id', ctx.hid).eq('exclude_from_stats', false).gte('occurred_on', ms).lte('occurred_on', me),
    ctx.admin.from('recurring_rules').select('direction,amount,currency,next_run,active,cadence').eq('household_id', ctx.hid).eq('active', true),
  ]);
  const txs = ((txRows ?? []) as { type: string; amount: number; currency: string; usd_rate_snapshot: number | null; occurred_on: string }[])
    .map(t => ({ type: t.type, amount: toArs(t.amount, t.currency, t.usd_rate_snapshot, ctx.blue), occurred_on: t.occurred_on }));
  const rules = ((ruleRows ?? []) as { direction: string; amount: number; currency: string; next_run: string | null; active: boolean; cadence: string | null }[])
    .map(r => ({ direction: r.direction, amount: toArs(r.amount, r.currency, null, ctx.blue), next_run: r.next_run, active: r.active, cadence: r.cadence }));
  const proj = computeProjection(txs, rules, artNow);
  let purchase: { amount_ars: number; installments: number | null; monthly_cost_ars: number; projected_end_balance_after_ars: number } | undefined;
  const amt = Number(input.purchase_amount);
  if (amt && amt > 0) {
    const ars = input.purchase_currency === 'USD' ? amt * ctx.blue : amt;
    const inst = Number(input.installments);
    const monthly = inst && inst > 1 ? Math.round(ars / inst) : Math.round(ars);
    purchase = { amount_ars: Math.round(ars), installments: inst > 1 ? inst : null, monthly_cost_ars: monthly, projected_end_balance_after_ars: Math.round(proj.projectedBalance - monthly) };
  }
  return {
    scope: 'toàn bộ hộ gia đình',
    expenses_so_far_ars: Math.round(proj.expensesSoFar),
    remaining_fixed_ars: Math.round(proj.remainingFixed),
    remaining_income_ars: Math.round(proj.remainingIncome),
    projected_end_balance_ars: Math.round(proj.projectedBalance),
    projected_total_income_ars: Math.round(proj.totalIncome),
    projected_savings_rate_pct: proj.totalIncome > 0 ? Math.round(proj.projectedBalance / proj.totalIncome * 100) : null,
    purchase,
  };
}

const TOOLS = [
  {
    name: 'aggregate_transactions',
    description: 'Cộng và nhóm các giao dịch thực tế của hộ gia đình (chi tiêu hoặc thu nhập), đã quy đổi sang ARS. Đây là công cụ chính cho các câu hỏi "bao nhiêu / vào việc gì / khi nào / ai". Hãy chọn lens phù hợp với câu hỏi. LƯU Ý: nếu không truyền date_from/date_to, công cụ sẽ cộng TOÀN BỘ lịch sử (thường KHÔNG phải điều người dùng muốn); để giới hạn thời gian, hãy sao chép một khoảng trong CONTEXT và mặc định dùng "tháng này".',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['expense', 'income'], description: 'chi tiêu (mặc định) hoặc thu nhập' },
        lens: { type: 'string', enum: ['mine', 'partner', 'household', 'everyone'], description: 'Góc nhìn: "mine"=phần của người hỏi (chi tiêu cá nhân + phần của họ trong khoản dùng chung, sau khi trừ tiền bạn bè hoàn lại); "partner"=phần của người yêu; "household"=chỉ phần dùng chung/của hộ gia đình; "everyone"=toàn bộ tiền cặp đôi đã chi (mặc định). Chọn theo câu hỏi ("chi tiêu của tôi"→mine, "của hộ gia đình/cùng nhau"→household, "tổng chúng ta đã chi"→everyone).' },
        group_by: { type: 'string', enum: ['none', 'category', 'merchant', 'month', 'person', 'scope'], description: 'phân rã. "person" trả về phần thực tế của từng thành viên (bỏ qua lens).' },
        category: { type: 'string', description: 'lọc theo tên danh mục (một phần)' },
        merchant: { type: 'string', description: 'lọc theo cửa hàng (một phần)' },
        date_from: { type: 'string', description: 'từ ngày (bao gồm) YYYY-MM-DD' },
        date_to: { type: 'string', description: 'đến ngày (bao gồm) YYYY-MM-DD' },
        limit: { type: 'number', description: 'số nhóm tối đa (mặc định 12)' },
      },
      required: [],
    },
  },
  { name: 'get_balances', description: 'Số dư hiện tại của từng tài khoản (theo loại tiền và ARS) và tài sản ròng của hộ gia đình.', input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'get_budgets', description: 'Các ngân sách đang hoạt động (với scope cá nhân/hộ gia đình và chủ sở hữu), cùng chi tiêu tháng này so với giới hạn, dùng phần tương ứng của mỗi người.', input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'get_goals', description: 'Các mục tiêu tiết kiệm cùng tiến độ, scope và chủ sở hữu.', input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'get_debts', description: 'Các khoản nợ chưa tất toán (họ nợ ai hoặc ai nợ họ).', input_schema: { type: 'object', properties: {}, required: [] } },
  { name: 'get_recurring', description: 'Các khoản chi cố định và gói đăng ký đang hoạt động (với scope và chủ sở hữu, quy đổi hàng tháng sang ARS), cùng thu nhập định kỳ.', input_schema: { type: 'object', properties: {}, required: [] } },
  {
    name: 'aggregate_items',
    description: 'Phân tích các MẶT HÀNG trong hóa đơn đã quét (đã mua gì), nhóm theo loại (thực phẩm, đồ uống, đồ ăn vặt, vệ sinh, chăm sóc cá nhân, gia đình, thú cưng, khác) hoặc theo tên sản phẩm. Dùng cho "siêu thị tốn vào đâu?", "đã chi bao nhiêu cho đồ ăn vặt/đồ uống?", "mua gì nhiều nhất?". Tuân theo lens giống aggregate_transactions.',
    input_schema: {
      type: 'object',
      properties: {
        lens: { type: 'string', enum: ['mine', 'partner', 'household', 'everyone'], description: 'góc nhìn (giống aggregate_transactions)' },
        group: { type: 'string', description: 'lọc theo loại mặt hàng (ví dụ: đồ ăn vặt, đồ uống, vệ sinh)' },
        group_by: { type: 'string', enum: ['item_group', 'name'], description: 'nhóm theo loại mặt hàng (mặc định) hoặc theo tên sản phẩm' },
        date_from: { type: 'string', description: 'từ ngày (bao gồm) YYYY-MM-DD' },
        date_to: { type: 'string', description: 'đến ngày (bao gồm) YYYY-MM-DD' },
        limit: { type: 'number', description: 'số nhóm tối đa (mặc định 12)' },
      },
      required: [],
    },
  },
  {
    name: 'project_month',
    description: 'Dự báo cuối tháng của HỘ GIA ĐÌNH: chi tiêu đến hôm nay, các khoản chi cố định và thu nhập còn lại, số dư dự kiến cuối tháng theo nhịp hiện tại. Tùy chọn: mô phỏng một khoản mua (purchase_amount, trả góp) để xem tác động. Dùng cho "có đủ tiền đến cuối tháng không?", "có thể mua X không?", "còn dư bao nhiêu?".',
    input_schema: {
      type: 'object',
      properties: {
        purchase_amount: { type: 'number', description: 'số tiền của một khoản mua giả định cần mô phỏng (tùy chọn)' },
        purchase_currency: { type: 'string', enum: ['ARS', 'USD'], description: 'loại tiền của khoản mua (mặc định ARS)' },
        installments: { type: 'number', description: 'số kỳ trả góp của khoản mua (tùy chọn)' },
      },
      required: [],
    },
  },
  {
    name: 'record_transaction',
    description: 'XEM TRƯỚC việc ghi một khoản chi tiêu hoặc thu nhập cá nhân của người đang viết (chưa ghi cho đến khi người dùng xác nhận bằng nút). Dùng khi họ yêu cầu "ghi/đăng ký/thêm khoản chi/thu nhập".',
    input_schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['expense', 'income'], description: 'chi tiêu (mặc định) hoặc thu nhập' },
        amount: { type: 'number', description: 'số tiền dương theo loại tiền đã chỉ định' },
        currency: { type: 'string', enum: ['ARS', 'USD'], description: 'ARS (mặc định) hoặc USD' },
        category: { type: 'string', description: 'tên danh mục (sẽ được khớp với danh mục hiện có gần nhất; tùy chọn)' },
        merchant: { type: 'string', description: 'cửa hàng/mô tả (tùy chọn)' },
        date: { type: 'string', description: 'ngày YYYY-MM-DD (mặc định hôm nay)' },
      },
      required: ['amount'],
    },
  },
  {
    name: 'settle_debt',
    description: 'XEM TRƯỚC việc đánh dấu các khoản nợ chưa tất toán với một người là đã trả (chưa ghi cho đến khi người dùng xác nhận).',
    input_schema: { type: 'object', properties: { counterparty: { type: 'string', description: 'tên người trong khoản nợ' } }, required: ['counterparty'] },
  },
  {
    name: 'set_category_budget',
    description: 'XEM TRƯỚC việc đặt ngân sách (target của phong bì) cho một danh mục chi tiêu của người đang viết (chưa ghi cho đến khi xác nhận).',
    input_schema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: 'nombre de la categoría de gasto' },
        amount: { type: 'number', description: 'monto del presupuesto, positivo' },
        currency: { type: 'string', enum: ['ARS', 'USD'], description: 'ARS (mặc định) hoặc USD' },
        cadence: { type: 'string', enum: ['monthly', 'weekly'], description: 'mensual (default) o semanal' },
      },
      required: ['category', 'amount'],
    },
  },
];

async function runTool(name: string, input: Record<string, unknown>, ctx: Ctx): Promise<unknown> {
  switch (name) {
    case 'aggregate_transactions': return await aggregateTransactions(ctx, input as AggInput);
    case 'get_balances': return await getBalances(ctx);
    case 'get_budgets': return await getBudgets(ctx);
    case 'get_goals': return await getGoals(ctx);
    case 'get_debts': return await getDebts(ctx);
    case 'get_recurring': return await getRecurring(ctx);
    case 'aggregate_items': return await aggregateItems(ctx, input as ItemAggInput);
    case 'project_month': return await projectMonth(ctx, input as ProjInput);
    default: return { error: 'herramienta desconocida' };
  }
}

// ── write actions ───────────────────────────────────────────────────────────
// Morchi never writes on its own. A write tool only PREVIEWS: it validates and
// resolves a PendingAction that the client renders as a confirm card. The DB
// write happens later, when the client re-calls with `confirm: <action>` and
// executeAction runs — re-deriving household/owner from the JWT so the
// service-role client can't be tricked into touching another household.
const WRITE_TOOLS = new Set(['record_transaction', 'settle_debt', 'set_category_budget']);
interface PendingAction { kind: string; payload: Record<string, unknown>; summary: string }
const todayISO = () => new Date().toISOString().slice(0, 10);
const arsFmt = (n: number) => '$' + Math.round(n).toLocaleString('vi-VN');

async function resolveCategory(ctx: Ctx, name: unknown, kind: 'expense' | 'income'): Promise<{ id: string | null; name: string | null }> {
  const q = (name ?? '').toString().trim();
  if (!q) return { id: null, name: null };
  const { data } = await ctx.admin.from('categories').select('id,name').eq('household_id', ctx.hid).eq('kind', kind);
  const cats = (data ?? []) as { id: string; name: string }[];
  const n = norm(q);
  const hit = cats.find(c => norm(c.name) === n) ?? cats.find(c => norm(c.name).includes(n) || n.includes(norm(c.name)));
  return hit ? { id: hit.id, name: hit.name } : { id: null, name: null };
}

// Validate + resolve a tool call into a PendingAction (no write). Returns {error} on bad input.
async function buildAction(ctx: Ctx, kind: string, input: Record<string, unknown>): Promise<PendingAction | { error: string }> {
  if (kind === 'record_transaction') {
    const type = input.type === 'income' ? 'income' : 'expense';
    const amount = Number(input.amount);
    if (!amount || amount <= 0) return { error: 'El monto tiene que ser un número positivo.' };
    const currency = input.currency === 'USD' ? 'USD' : 'ARS';
    const occurred_on = (typeof input.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(input.date)) ? input.date : todayISO();
    const cat = await resolveCategory(ctx, input.category, type);
    const merchant = (input.merchant ?? '').toString().trim() || null;
    const payload = {
      household_id: ctx.hid, profile_id: ctx.askerId, type, amount, currency,
      usd_rate_snapshot: currency === 'USD' ? ctx.blue : null, category_id: cat.id,
      account_id: null, merchant, occurred_on, scope: 'personal', is_shared: false,
      is_fixed: false, flag: null, source: 'manual',
    };
    const amountTxt = currency === 'USD' ? `US$${amount}` : arsFmt(amount);
    const summary = `${type === 'income' ? 'Ingreso' : 'Gasto'} de ${amountTxt}${cat.name ? ` en ${cat.name}` : ''}${merchant ? ` (${merchant})` : ''}${occurred_on !== todayISO() ? ` el ${occurred_on}` : ''}`;
    return { kind, payload, summary };
  }
  if (kind === 'settle_debt') {
    const who = (input.counterparty ?? '').toString().trim();
    if (!who) return { error: 'Decime con quién es la deuda.' };
    const { data } = await ctx.admin.from('debts').select('id,counterparty,amount,currency').eq('household_id', ctx.hid).eq('settled', false);
    const debts = (data ?? []) as { id: string; counterparty: string; amount: number; currency: string }[];
    const matches = debts.filter(d => norm(d.counterparty).includes(norm(who)) || norm(who).includes(norm(d.counterparty)));
    if (matches.length === 0) return { error: `No encontré deudas sin saldar con "${who}".` };
    const total = matches.reduce((s, d) => s + (d.currency === 'USD' ? d.amount * ctx.blue : d.amount), 0);
    const summary = `Saldar ${matches.length} deuda${matches.length > 1 ? 's' : ''} con ${matches[0].counterparty} (≈ ${arsFmt(total)})`;
    return { kind, payload: { ids: matches.map(d => d.id) }, summary };
  }
  if (kind === 'set_category_budget') {
    const cat = await resolveCategory(ctx, input.category, 'expense');
    if (!cat.id) return { error: `No encontré la categoría "${(input.category ?? '').toString()}".` };
    const amount = Number(input.amount);
    if (!amount || amount <= 0) return { error: 'El monto tiene que ser un número positivo.' };
    const currency = input.currency === 'USD' ? 'USD' : 'ARS';
    const cadence = input.cadence === 'weekly' ? 'weekly' : 'monthly';
    const amountTxt = currency === 'USD' ? `US$${amount}` : arsFmt(amount);
    const summary = `Presupuesto ${cadence === 'weekly' ? 'semanal' : 'mensual'} de ${amountTxt} para ${cat.name}`;
    return { kind, payload: { category_id: cat.id, target_amount: amount, currency, cadence }, summary };
  }
  return { error: 'Acción desconocida.' };
}

// Execute a confirmed action. Re-derives household/owner from ctx (never trusts
// client-supplied ids for ownership) and re-checks that referenced rows are this
// household's.
async function executeAction(ctx: Ctx, action: PendingAction): Promise<string> {
  if (action.kind === 'record_transaction') {
    const p = { ...action.payload, household_id: ctx.hid, profile_id: ctx.askerId, scope: 'personal', is_shared: false, source: 'manual' };
    const { error } = await ctx.admin.from('transactions').insert(p);
    if (error) throw error;
    return `Listo, lo anoté: ${action.summary}. ✅`;
  }
  if (action.kind === 'settle_debt') {
    const wanted = (action.payload.ids as string[]) ?? [];
    const { data } = await ctx.admin.from('debts').select('id').eq('household_id', ctx.hid).eq('settled', false).in('id', wanted);
    const ids = ((data ?? []) as { id: string }[]).map(d => d.id);
    if (ids.length === 0) throw new Error('no matching debts');
    const { error } = await ctx.admin.from('debts').update({ settled: true }).in('id', ids);
    if (error) throw error;
    return `Listo, marqué como saldada${ids.length > 1 ? 's' : ''} ${ids.length} deuda${ids.length > 1 ? 's' : ''}. ✅`;
  }
  if (action.kind === 'set_category_budget') {
    const p = action.payload as { category_id: string; target_amount: number; currency: string; cadence: string };
    const { data: cat } = await ctx.admin.from('categories').select('id').eq('household_id', ctx.hid).eq('id', p.category_id).maybeSingle();
    if (!cat) throw new Error('category not in household');
    const { data: existing } = await ctx.admin.from('category_targets').select('id').eq('household_id', ctx.hid).eq('profile_id', ctx.askerId).eq('category_id', p.category_id).maybeSingle();
    if (existing) {
      const { error } = await ctx.admin.from('category_targets').update({ target_amount: p.target_amount, currency: p.currency, cadence: p.cadence }).eq('id', (existing as { id: string }).id);
      if (error) throw error;
    } else {
      const { error } = await ctx.admin.from('category_targets').insert({ household_id: ctx.hid, profile_id: ctx.askerId, category_id: p.category_id, target_amount: p.target_amount, currency: p.currency, cadence: p.cadence });
      if (error) throw error;
    }
    return `Listo, ${action.summary.charAt(0).toLowerCase()}${action.summary.slice(1)}. ✅`;
  }
  if (action.kind === 'record_receipt') {
    // Confirmed from the photo flow: the client parsed a receipt (parse-receipt)
    // and the user tapped Confirmar. Insert the expense + its line items.
    const r = action.payload.receipt as { merchant?: string; date?: string; total: number; currency: string; suggested_category?: string; items?: { name: string; qty?: number; line_total: number; group?: string }[] };
    const amount = Number(r?.total);
    if (!amount || amount <= 0) throw new Error('bad receipt total');
    const currency = r.currency === 'USD' ? 'USD' : 'ARS';
    const occurred_on = (typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) ? r.date : todayISO();
    const cat = await resolveCategory(ctx, r.suggested_category, 'expense');
    const { data: tx, error } = await ctx.admin.from('transactions').insert({
      household_id: ctx.hid, profile_id: ctx.askerId, type: 'expense', amount, currency,
      usd_rate_snapshot: currency === 'USD' ? ctx.blue : null, category_id: cat.id, account_id: null,
      merchant: r.merchant || 'Compra', occurred_on, scope: 'personal', is_shared: false, is_fixed: false, flag: null, source: 'receipt',
    }).select('id').single();
    if (error || !tx) throw error ?? new Error('insert failed');
    const items = Array.isArray(r.items) ? r.items : [];
    const rows = items.filter(it => it && it.name && Number(it.line_total) > 0)
      .map(it => ({ household_id: ctx.hid, transaction_id: (tx as { id: string }).id, name: String(it.name).slice(0, 200), qty: Number(it.qty) || 1, line_total: Number(it.line_total), item_group: it.group || 'otros' }));
    if (rows.length) await ctx.admin.from('transaction_items').insert(rows);
    return `Listo, cargué el ticket: ${action.summary}. ✅`;
  }
  throw new Error('unknown action');
}

const SYSTEM = 'Bạn là Morchi, trợ lý tài chính của cặp đôi Lucas và Sofi trong ứng dụng Morchis (vi-VN, giọng thân thiện và động viên). Bạn có CÔNG CỤ để truy vấn cơ sở dữ liệu tài chính thực tế của họ. Với BẤT KỲ câu hỏi nào về số tiền, chi tiêu, thu nhập, cửa hàng, danh mục, tháng, số dư, ngân sách, mục tiêu hoặc khoản nợ, HÃY dùng công cụ để lấy số liệu chính xác trước khi trả lời. QUAN TRỌNG: phân biệt chi tiêu cá nhân với chi tiêu của hộ gia đình theo câu hỏi và chọn lens phù hợp trong aggregate_transactions (mine/partner/household/everyone). Nếu câu hỏi mơ hồ giữa "của tôi" và "của cả hai", hãy nói rõ ngắn gọn hoặc hỏi lại. Quy tắc: (1) Không bao giờ bịa hoặc ước tính số tiền: số liệu luôn lấy từ công cụ; nếu không có dữ liệu, hãy nói rõ. (2) Với ngày tháng, LUÔN dùng các khoảng đã tính sẵn trong CONTEXT (date_from/date_to) — không tự tính ngày. Nếu câu hỏi không nêu khoảng thời gian, mặc định là "tháng này" và nói rõ. (3) Hiển thị số tiền theo định dạng $1.234.567. (4) Ngắn gọn nhưng hữu ích: 2 đến 4 câu. Không dùng bảng markdown hoặc tiêu đề; nếu liệt kê, dùng vài dòng ngắn với dấu gạch ngang (-). Dùng **in đậm** để nhấn mạnh. (5) Đừng chỉ trả lời một con số: khi hữu ích, thêm MỘT dữ kiện bối cảnh đã truy vấn hoặc có thể truy vấn nhanh (so với tháng trước, % tổng, so với ngân sách hoặc một lời khuyên hành động ngắn). Thà dùng thêm một công cụ để trả lời đầy đủ còn hơn trả lời sơ sài. (6) Trước khi nói "không có dữ liệu", hãy xác nhận đã thử đúng lens và khoảng thời gian; nếu truy vấn đầu tiên rỗng, hãy thử mở rộng khoảng thời gian hoặc đổi lens. TRIẾT LÝ YNAB VÀ NGÂN SÁCH: Morchis dùng phương pháp YNAB với các phong bì (envelopes), và bạn biết cách giải thích. 4 quy tắc: (1) Giao nhiệm vụ cho từng đồng tiền: phân bổ TOÀN BỘ tiền có sẵn vào các danh mục cho đến khi "Cần phân bổ" bằng 0; tiền không mất đi, nó có mục đích. (2) Chấp nhận các khoản chi thực tế: các khoản lớn không hàng tháng (bảo hiểm, quà, kỳ nghỉ, phí xe) được chia thành mục tiêu nhỏ hàng tháng để không bất ngờ. (3) Xử lý linh hoạt: nếu vượt một danh mục, chuyển tiền từ danh mục còn dư, không tự trách và không phá ngân sách. (4) Làm cho tiền cũ dần: mục tiêu là tiêu tiền đã vào tài khoản hơn 30 ngày (đó là "tuổi của tiền" trong Phân tích); càng nhiều ngày càng có đệm. Trong /presupuestos, "Cần phân bổ" = tiền mặt on-budget trừ số tiền đã giữ trong các phong bì; mục tiêu là đưa về 0 ("mỗi đồng tiền có một nhiệm vụ"). VÌ SAO "CẦN PHÂN BỔ" ÂM: (a) đã vượt các danh mục — chi nhiều hơn số dư khả dụng — cần bù bằng cách chuyển tiền; (b) đã ứng trước một khoản chi chung và chưa được hoàn lại, làm giảm "Cần phân bổ" cho đến khi được trả; (c) đã phân bổ nhiều hơn số tiền thực có. Cách thường dùng để về 0: rút tiền từ một danh mục còn dư hoặc bù phần vượt. Số khả dụng ÂM trong một danh mục = vượt ngân sách, cần phân bổ thêm tiền. Mục tiêu mỗi danh mục có thể theo tháng, tuần hoặc ngày đích (tiết kiệm). Khi được hỏi về ngân sách, phong bì, "Cần phân bổ", mục tiêu hoặc cách lập ngân sách, hãy giải thích ngắn gọn và cụ thể theo logic này; nếu cần số chi tiêu so với giới hạn tháng, dùng get_budgets và nói rõ số "Cần phân bổ" chính xác được hiển thị ở màn hình /presupuestos. HÀNH ĐỘNG: ngoài trả lời, bạn có thể ĐĂNG KÝ thông tin bằng record_transaction (ghi chi tiêu/thu nhập), settle_debt (tất toán khoản nợ) và set_category_budget (đặt ngân sách). Khi người dùng yêu cầu ghi/tạo/tải/tất toán/đặt gì đó, hãy gọi công cụ tương ứng (CHỈ XEM TRƯỚC, không ghi), sau đó nói trong MỘT câu bạn sẽ làm gì và yêu cầu họ xác nhận bằng nút bên dưới. KHÔNG BAO GIỜ nói đã hoàn tất hoặc bịa rằng bạn đã ghi nhận: người dùng phải xác nhận. Nếu công cụ trả lỗi, giải thích ngắn gọn còn thiếu gì. CÂU HỎI TIẾP THEO: cuối MỖI câu trả lời thêm một dòng riêng, CHÍNH XÁC, gồm 2 hoặc 3 câu hỏi ngắn liên quan với định dạng: SUGERENCIAS: câu hỏi một | câu hỏi hai | câu hỏi ba. Không nhắc đến dòng này trong nội dung và không dùng tiền tố "SUGERENCIAS:" cho mục đích khác. Nếu đang đề xuất một hành động để xác nhận, KHÔNG thêm dòng SUGERENCIAS.'

Deno.serve(async (req: Request) => {
  const cors = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  if (req.method === 'OPTIONS') return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type', 'Access-Control-Allow-Methods': 'POST,OPTIONS' } });

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')!;
  const admin = createClient(supabaseUrl, serviceKey);

  const auth = req.headers.get('Authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  let hid: string | null = null;
  let askerId: string | null = null;
  if (jwtPayload(token)?.role === 'service_role') {
    const { data: hh } = await admin.from('households').select('id').limit(1).single();
    hid = hh?.id ?? null;
  } else {
    const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: auth } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: cors });
    const { data: prof } = await admin.from('profiles').select('household_id').eq('id', user.id).single();
    hid = prof?.household_id ?? null;
    askerId = user.id;
  }
  if (!hid) return new Response(JSON.stringify({ error: 'No household' }), { status: 400, headers: cors });

  let body: { question?: string; history?: { role: string; content: string }[]; as?: string; confirm?: PendingAction } = {};
  try { body = await req.json(); } catch { /* empty */ }
  const question = (body.question ?? '').trim();
  // A request carries EITHER a question (chat turn) or a confirm (execute a
  // previously-previewed action). Reject only when both are missing.
  if (!question && !body.confirm) return new Response(JSON.stringify({ error: 'question requerida' }), { status: 400, headers: cors });

  const [{ data: fxRow }, { data: profs }, { data: debtRows }, { data: cats }] = await Promise.all([
    admin.from('fx_rates').select('ars_per_usd').eq('source', 'blue').order('date', { ascending: false }).limit(1).maybeSingle(),
    admin.from('profiles').select('id,nickname,display_name').eq('household_id', hid),
    // Linked friend-debts net out of the expense's real cost regardless of
    // settled — the friend paying back doesn't make the expense cost more.
    admin.from('debts').select('transaction_id,direction,amount,currency').eq('household_id', hid).not('transaction_id', 'is', null),
    admin.from('categories').select('name').eq('household_id', hid).eq('kind', 'expense'),
  ]);
  const blue = Number(fxRow?.ars_per_usd ?? 1200);
  const catNames = ((cats ?? []) as { name: string }[]).map(c => c.name).join(', ');
  const pm: Record<string, string> = {};
  const profiles = (profs ?? []) as { id: string; nickname: string | null; display_name: string | null }[];
  for (const p of profiles) pm[p.id] = p.nickname ?? p.display_name ?? 'Usuario';
  // Real users: askerId comes from their JWT (set above). Only the admin/test
  // path leaves it null — there an optional `as` (nickname or id) picks whose
  // viewpoint to simulate, otherwise the first profile.
  if (!askerId) {
    const asKey = (body.as ?? '').toLowerCase();
    askerId = (asKey ? profiles.find(p => (p.nickname ?? '').toLowerCase() === asKey || (p.display_name ?? '').toLowerCase() === asKey || p.id === body.as)?.id : null) ?? profiles[0]?.id ?? '';
  }
  const partnerId = profiles.find(p => p.id !== askerId)?.id ?? null;
  const debtByTx: Record<string, Debt[]> = {};
  for (const d of (debtRows ?? []) as Debt[]) { if (!d.transaction_id) continue; (debtByTx[d.transaction_id] ??= []).push(d); }
  const ctx: Ctx = { admin, hid, blue, pm, askerId, partnerId, debtByTx, catNames };

  // Confirm path: the user tapped "Confirmar" on a previewed action → execute it.
  if (body.confirm) {
    try {
      const answer = await executeAction(ctx, body.confirm);
      return new Response(JSON.stringify({ ok: true, answer }), { headers: cors });
    } catch (e) {
      console.error('executeAction failed', e);
      return new Response(JSON.stringify({ ok: true, answer: 'Uy, no pude completar esa acción. Probá de nuevo en un ratito.' }), { headers: cors });
    }
  }

  const primer = buildPrimer(ctx);
  const history = (body.history ?? []).slice(-6)
    .filter(h => (h.role === 'user' || h.role === 'assistant') && typeof h.content === 'string' && h.content.trim())
    .map(h => ({ role: h.role as 'user' | 'assistant', content: h.content }));

  const anthropic = new Anthropic({ apiKey: anthropicKey });
  // deno-lint-ignore no-explicit-any
  const messages: any[] = [...history, { role: 'user', content: question }];

  let answer = '';
  let pending: PendingAction | null = null;
  for (let i = 0; i < 8; i++) {
    const resp = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2500,
      // Extended thinking: que razone qué tool / lens / período usar antes de
      // responder. max_tokens debe ser > budget_tokens (deja ~1500 para la
      // respuesta). Los bloques de thinking se preservan al re-enviar `resp.content`.
      thinking: { type: 'enabled', budget_tokens: 1024 },
      system: [
        { type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } },
        { type: 'text', text: 'CONTEXTO:\n' + primer },
      ],
      tools: TOOLS,
      messages,
    });
    if (resp.stop_reason !== 'tool_use') {
      answer = resp.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('\n').trim();
      break;
    }
    messages.push({ role: 'assistant', content: resp.content });
    const results = [];
    for (const block of resp.content) {
      if (block.type === 'tool_use') {
        let out: unknown;
        if (WRITE_TOOLS.has(block.name)) {
          // Write tools only PREVIEW — they never touch the DB here.
          const built = await buildAction(ctx, block.name, block.input as Record<string, unknown>);
          if ('error' in built) { out = built; }
          else { pending = built; out = { ok: true, preview: built.summary, instruccion: 'Contale al usuario en una frase qué vas a registrar y pedile que confirme con el botón. NO digas que ya quedó hecho.' }; }
        } else {
          out = await runTool(block.name, block.input as Record<string, unknown>, ctx);
        }
        results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(out) });
      }
    }
    messages.push({ role: 'user', content: results });
  }
  // Pull the trailing "SUGERENCIAS: a | b | c" line out of the answer into tappable
  // quick-replies. No suggestions alongside an action card (the card is the CTA).
  let suggestions: string[] = [];
  const sm = answer.match(/^[ \t]*SUGERENCIAS:[ \t]*(.+)$/im);
  if (sm) {
    suggestions = sm[1].split('|').map(s => s.trim()).filter(Boolean).slice(0, 3);
    answer = answer.replace(/\n?[ \t]*SUGERENCIAS:.*$/im, '').trim();
  }
  if (!answer) answer = pending ? `Voy a registrar: ${pending.summary}. Confirmá abajo 👇` : 'Uy, no pude llegar a una respuesta. Probá reformulando la pregunta.';
  if (pending) suggestions = [];

  return new Response(JSON.stringify({ ok: true, answer, pending_action: pending, suggestions }), { headers: cors });
});
