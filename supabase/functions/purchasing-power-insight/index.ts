import { createClient } from 'jsr:@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Phương thức không được hỗ trợ' }, 405);

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) return json({ error: 'Không được phép' }, 401);

  const userClient = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return json({ error: 'Không được phép' }, 401);

  const { data: profile } = await supabase
    .from('profiles')
    .select('household_id')
    .eq('id', user.id)
    .maybeSingle();
  if (!profile) return json({ error: 'Không tìm thấy hồ sơ' }, 404);

  const householdId = profile.household_id;

  // Latest inflation rate + latest blue FX (for USD→ARS conversion)
  const [{ data: inflRow }, { data: fxRow }] = await Promise.all([
    supabase.from('inflation_rates').select('monthly_pct, date').order('date', { ascending: false }).limit(1).maybeSingle(),
    supabase.from('fx_rates').select('ars_per_usd').eq('source', 'blue').order('date', { ascending: false }).limit(1).maybeSingle(),
  ]);

  if (!inflRow) {
    return json({ ok: false, reason: 'không có dữ liệu lạm phát' });
  }

  const inflationPct = Number(inflRow.monthly_pct);
  const inflDate = inflRow.date.slice(0, 7); // YYYY-MM
  const fxRate = Number(fxRow?.ars_per_usd ?? 1200);
  const toArs = (amount: number, currency: string | null, snap: number | null): number =>
    currency === 'USD' ? Math.round(amount * (Number(snap) || fxRate)) : amount;

  // Compare the previous CLOSED month against the month before it. Comparing
  // the partial current month vs a full previous month produced false
  // Cảnh báo "sức mua giảm" xuất hiện phần lớn tháng — và
  // inflation data is for closed months too. (Columns are amount/occurred_on;
  // the old code queried non-existent amount_ars/date and silently no-op'd.)
  // "now" in Argentina (UTC-3, no DST) — the server clock is UTC and would
  // roll to tomorrow / next month after 21:00 local.
  const artNow = () => new Date(Date.now() - 3 * 60 * 60 * 1000);
  const isoUTC = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);
  const now = artNow();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const lastMonthStart = isoUTC(y, m - 1, 1);
  const lastMonthEnd = isoUTC(y, m, 0);
  const baseMonthStart = isoUTC(y, m - 2, 1);
  const baseMonthEnd = isoUTC(y, m - 1, 0);

  const incomeSel = 'amount, currency, usd_rate_snapshot';
  const [{ data: lastIncome }, { data: baseIncome }] = await Promise.all([
    supabase.from('transactions').select(incomeSel).eq('household_id', householdId).eq('type', 'income').eq('exclude_from_stats', false).gte('occurred_on', lastMonthStart).lte('occurred_on', lastMonthEnd),
    supabase.from('transactions').select(incomeSel).eq('household_id', householdId).eq('type', 'income').eq('exclude_from_stats', false).gte('occurred_on', baseMonthStart).lte('occurred_on', baseMonthEnd),
  ]);

  type IncomeRow = { amount: number; currency: string | null; usd_rate_snapshot: number | null };
  const sumArs = (rows: IncomeRow[] | null) => (rows ?? []).reduce((s, r) => s + toArs(r.amount, r.currency, r.usd_rate_snapshot), 0);
  const lastTotal = sumArs(lastIncome as IncomeRow[] | null);
  const baseTotal = sumArs(baseIncome as IncomeRow[] | null);

  if (baseTotal === 0) {
    return json({ ok: false, reason: 'không có thu nhập tháng cơ sở' });
  }

  const incomePct = Math.round(((lastTotal - baseTotal) / baseTotal) * 10000) / 100;
  const diff = Math.round((incomePct - inflationPct) * 100) / 100;
  const gained = incomePct >= inflationPct;

  const monthNames = ['tháng 1','tháng 2','tháng 3','tháng 4','tháng 5','tháng 6','tháng 7','tháng 8','tháng 9','tháng 10','tháng 11','tháng 12'];
  const lastMonthDate = new Date(Date.UTC(y, m - 1, 1)); // previous (closed) month label
  // Keep this period label distinct from generate-insights' "YYYY-MM" so its
  // period-scoped delete never wipes this purchasing-power card.
  const period = monthNames[lastMonthDate.getUTCMonth()] + ' ' + lastMonthDate.getUTCFullYear();

  const title = gained
    ? `Sức mua tăng trong ${period}`
    : `Sức mua giảm trong ${period}`;

  const body = `Thu nhập ${incomePct >= 0 ? 'tăng' : 'giảm'} ${Math.abs(incomePct)}% trong ${period} so với tháng trước. Lạm phát là ${inflationPct}% (${inflDate}). Sức mua ${gained ? 'tăng' : 'giảm'} ${Math.abs(diff)}%.`;

  const severity = gained ? 'positive' : 'warning';

  // Replace any prior purchasing-power insight for this period. The
  // (household_id, kind, period) unique constraint was removed (it broke
  // generate-insights), so de-duplicate manually with delete + insert.
  await supabase.from('insights')
    .delete()
    .eq('household_id', householdId)
    .eq('kind', 'purchasing_power')
    .eq('period', period);
  await supabase.from('insights').insert({
    household_id: householdId,
    title,
    body,
    severity,
    kind: 'purchasing_power',
    period,
    seen: false,
  });

  return json({ ok: true, incomePct, inflationPct, diff, gained, lastTotal, baseTotal });
});
