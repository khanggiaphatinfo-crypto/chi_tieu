'use client';

import { useState, useRef } from 'react';
import { createClient } from '@/lib/supabase';
import { BottomNav } from '@/components/BottomNav';
import { AddTransactionSheet } from '@/components/AddTransactionSheet';
import { useQuery } from '@tanstack/react-query';
import { formatARS } from '@/lib/format';
import { useFx } from '@/hooks/useFx';
import Link from 'next/link';

interface Profile {
  id: string;
  household_id: string;
  nickname: string | null;
  display_name: string | null;
}

interface SimResult {
  parsed: { item: string; amount_ars: number; currency_input: 'ARS' | 'USD'; installments: number | null };
  projection: { current: number; new: number };
  monthly_cost: number;
  // null when there's no income this month (a rate would be meaningless)
  savings_rate: { current: number | null; new: number | null };
  goal_delays: { name: string; icon: string; slip_months: number; is_past_deadline: boolean }[];
  budget_overflows: { category: string; budget: number; current_spend: number; after_purchase: number }[];
  fx_rate: number;
  is_negative_impact: boolean;
}

const CORAL = '#FF6F61';
const SAGE = '#2FA37C';
const SURFACE = '#FFFFFF';
const CREAM = '#F1F5F3';
const CHARCOAL = '#18211D';
const MUTED = '#5B6660';
const BORDER = '#E5EBE8';

const SUGGESTIONS = [
  'Tôi muốn mua điện thoại giá 1.500.000 trong 12 kỳ trả góp',
  'Laptop US$800 trong 6 kỳ trả góp',
  'Chuyến du lịch 500.000',
  'TV thông minh 350.000 trong 3 kỳ trả góp',
];

export default function SimuladorClient({ profile }: { profile: Profile }) {
  const supabase = createClient();
  const { format, secondary } = useFx();
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<SimResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fabType, setFabType] = useState<'expense' | 'income' | 'transfer'>('expense');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  const { data: categories = [] } = useQuery({
    queryKey: ['categories', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase.from('categories').select('id, name, icon, kind, color').eq('household_id', profile.household_id).order('name');
      return data ?? [];
    },
  });
  const { data: accounts = [] } = useQuery({
    queryKey: ['accounts', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase.from('accounts').select('id, name, type, owner_profile_id').eq('household_id', profile.household_id).eq('archived', false).order('name');
      return data ?? [];
    },
  });

  async function simulate() {
    if (!text.trim()) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const resp = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/simulate-purchase`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${session?.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ text }),
        },
      );
      if (!resp.ok) throw new Error('Lỗi máy chủ');
      const data: SimResult = await resp.json();
      setResult(data);
      setTimeout(() => resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
    } catch (e) {
      setError('Không thể mô phỏng. Hãy thử lại.');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  function pct(r: number | null) {
    if (r === null || !Number.isFinite(r)) return '—';
    return `${r >= 0 ? '+' : ''}${Math.round(r * 100)}%`;
  }

  const name = profile.nickname ?? profile.display_name ?? 'Morch';
  const srCurrent = result?.savings_rate.current ?? null;
  const srNew = result?.savings_rate.new ?? null;
  const srWorse = srCurrent !== null && srNew !== null && srNew < srCurrent;
  const srDelta = srCurrent !== null && srNew !== null ? srNew - srCurrent : null;

  return (
    <div className="min-h-screen pb-28" style={{ background: CREAM }}>
      {/* Header */}
      <header className="px-5 pt-14 pb-4 flex items-center gap-3">
        <Link href="/mas" className="text-2xl leading-none" style={{ color: MUTED }}>←</Link>
        <h1 className="text-2xl font-black" style={{ color: CHARCOAL }}>Trình mô phỏng</h1>
      </header>

      <div className="px-4 flex flex-col gap-4">
        {/* Input card */}
        <div className="rounded-3xl p-5" style={{ background: SURFACE, boxShadow: 'var(--shadow-card)' }}>
          <p className="text-sm font-semibold mb-3" style={{ color: MUTED }}>
            Bạn muốn mua gì, {name}?
          </p>
          <textarea
            ref={textareaRef}
            value={text}
            onChange={e => setText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); simulate(); } }}
            placeholder="Tôi muốn mua điện thoại giá 1.500.000 trong 12 kỳ trả góp"
            rows={3}
            className="w-full resize-none rounded-2xl px-4 py-3 text-base outline-none border"
            style={{
              borderColor: BORDER,
              color: CHARCOAL,
              background: CREAM,
              fontFamily: 'inherit',
            }}
          />

          {/* Suggestions */}
          {!text && (
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => setText(s)}
                  className="px-3.5 py-2 rounded-full text-xs font-semibold border transition-all"
                  style={{ borderColor: BORDER, color: MUTED, background: CREAM, boxShadow: 'var(--shadow-soft)' }}
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={simulate}
            disabled={loading || !text.trim()}
            className="mt-4 w-full py-4 rounded-2xl text-base font-bold transition-opacity"
            style={{
              background: 'linear-gradient(135deg, #FF8173 0%, #E25749 100%)',
              color: '#fff',
              boxShadow: 'var(--shadow-glow)',
              opacity: loading || !text.trim() ? 0.6 : 1,
            }}
          >
            {loading ? 'Đang mô phỏng…' : 'Mô phỏng'}
          </button>
        </div>

        {error && (
          <p className="text-center text-sm" style={{ color: CORAL }}>{error}</p>
        )}

        {/* Result card */}
        {result && (
          <div ref={resultRef} className="rounded-3xl overflow-hidden" style={{ background: SURFACE, boxShadow: 'var(--shadow-pop)' }}>
            {/* Purchase summary — hero */}
            <div
              className="relative px-5 pt-5 pb-5 overflow-hidden"
              style={{ background: result.is_negative_impact ? 'linear-gradient(135deg, #FF8173 0%, #E25749 100%)' : 'linear-gradient(135deg, #34AD84 0%, #1F8A68 100%)' }}
            >
              <div className="absolute -top-10 -right-8 w-40 h-40 rounded-full pointer-events-none" style={{ background: 'rgba(255,255,255,0.14)' }} />
              <div className="relative flex items-center justify-between">
                <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.82)' }}>Món mua đã phân tích</p>
              </div>
              <p className="relative text-base font-bold mt-2" style={{ color: 'rgba(255,255,255,0.92)' }}>
                {result.parsed.item}
              </p>
              <p className="relative text-[2.4rem] leading-none font-black mt-1 tracking-tight" style={{ color: '#FFFFFF', fontVariantNumeric: 'tabular-nums' }}>
                {format(result.parsed.amount_ars)}
              </p>
              {result.parsed.installments && (
                <p className="relative text-[11px] mt-2" style={{ color: 'rgba(255,255,255,0.85)' }}>
                  {result.parsed.installments} kỳ trả góp, mỗi kỳ{' '}
                  <span className="font-black" style={{ color: '#FFFFFF' }}>{format(result.monthly_cost)}</span>
                  /tháng
                </p>
              )}
              {result.parsed.currency_input === 'USD' && (
                <p className="relative text-[11px] mt-1" style={{ color: 'rgba(255,255,255,0.85)' }}>
                  Đã quy đổi sang {formatARS(result.parsed.amount_ars)} theo tỷ giá blue ({formatARS(Math.round(result.fx_rate))})
                </p>
              )}
            </div>

            {/* Month-end projection */}
            <div className="px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
              <p className="text-[11px] font-black uppercase tracking-widest mb-3" style={{ color: '#8C968F' }}>
                Dự báo cuối tháng
              </p>
              <div className="flex gap-4">
                <div className="flex-1">
                  <p className="text-xs" style={{ color: MUTED }}>Không mua</p>
                  <p className="text-xl font-black" style={{ color: result.projection.current >= 0 ? SAGE : CORAL }}>
                    {format(result.projection.current)}
                  </p>
                  <p className="text-xs" style={{ color: MUTED }}>{secondary(result.projection.current)}</p>
                </div>
                <div className="text-2xl self-center" style={{ color: MUTED }}>→</div>
                <div className="flex-1">
                  <p className="text-xs" style={{ color: MUTED }}>Có mua</p>
                  <p className="text-xl font-black" style={{ color: result.projection.new >= 0 ? SAGE : CORAL }}>
                    {format(result.projection.new)}
                  </p>
                  <p className="text-xs" style={{ color: MUTED }}>{secondary(result.projection.new)}</p>
                </div>
              </div>
            </div>

            {/* Savings rate */}
            <div className="px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
              <p className="text-[11px] font-black uppercase tracking-widest mb-3" style={{ color: '#8C968F' }}>
                Tỷ lệ tiết kiệm
              </p>
              <div className="flex items-center gap-3">
                <span className="text-xl font-black" style={{ color: SAGE }}>
                  {pct(srCurrent)}
                </span>
                <span style={{ color: MUTED }}>→</span>
                <span
                  className="text-xl font-black"
                  style={{ color: srWorse ? CORAL : SAGE }}
                >
                  {pct(srNew)}
                </span>
                <span className="text-sm ml-1" style={{ color: srWorse ? CORAL : SAGE }}>
                  ({pct(srDelta)})
                </span>
              </div>
            </div>

            {/* Goal delays */}
            {result.goal_delays.length > 0 && (
              <div className="px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
                <p className="text-[11px] font-black uppercase tracking-widest mb-3" style={{ color: '#8C968F' }}>
                  Ảnh hưởng đến mục tiêu
                </p>
                <div className="flex flex-col gap-2">
                  {result.goal_delays.map((g, i) => (
                    <div key={i} className="flex items-center justify-between">
                      <span className="text-base" style={{ color: CHARCOAL }}>
                        {g.icon} {g.name}
                      </span>
                      {g.slip_months === 0 ? (
                        <span className="text-sm font-semibold" style={{ color: SAGE }}>Không ảnh hưởng</span>
                      ) : (
                        <span className="text-sm font-semibold px-2 py-0.5 rounded-full" style={{ background: '#FFF0EE', color: CORAL }}>
                          ~{g.slip_months} tháng trì hoãn
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Budget overflows */}
            {result.budget_overflows.length > 0 && (
              <div className="px-5 py-4" style={{ borderBottom: `1px solid ${BORDER}` }}>
                <p className="text-[11px] font-black uppercase tracking-widest mb-3" style={{ color: '#8C968F' }}>
                  Vượt ngân sách
                </p>
                {result.budget_overflows.map((b, i) => (
                  <div key={i}>
                    <div className="flex justify-between text-sm mb-1">
                      <span style={{ color: CHARCOAL }}>{b.category}</span>
                      <span style={{ color: CORAL }}>{format(b.after_purchase)} / {format(b.budget)}</span>
                    </div>
                    <div className="rounded-full overflow-hidden h-2" style={{ background: BORDER }}>
                      <div
                        className="h-2 rounded-full"
                        style={{ width: `${b.budget > 0 ? Math.min(100, (b.after_purchase / b.budget) * 100) : 100}%`, background: CORAL }}
                      />
                    </div>
                    <p className="text-xs mt-1" style={{ color: CORAL }}>
                      Bạn vượt {format(b.after_purchase - b.budget)} ngân sách
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Summary verdict */}
            <div
              className="px-5 py-4"
              style={{ background: result.is_negative_impact ? '#FFF0EE' : '#EAF6F1' }}
            >
              <p className="text-sm font-bold" style={{ color: result.is_negative_impact ? CORAL : SAGE }}>
                {result.is_negative_impact
                  ? result.projection.new < 0
                    ? `Nếu mua món này, bạn sẽ kết thúc tháng âm (${format(result.projection.new)}).`
                    : `Món mua này ảnh hưởng đến khoản tiết kiệm tháng này.`
                  : `Món mua này vẫn nằm trong khả năng tiết kiệm tháng này.`}
              </p>
              {result.goal_delays.some(g => g.slip_months > 0) && (
                <p className="text-xs mt-1" style={{ color: result.is_negative_impact ? CORAL : MUTED }}>
                  {result.goal_delays
                    .filter(g => g.slip_months > 0)
                    .map(g => `Mục tiêu "${g.name}" bị trễ khoảng ${g.slip_months} tháng.`)
                    .join(' ')}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <BottomNav onFab={(type) => { setFabType(type); setSheetOpen(true); }} />
      <AddTransactionSheet
        open={sheetOpen}
        initialType={fabType}
        onClose={() => setSheetOpen(false)}
        householdId={profile.household_id}
        profileId={profile.id}
        categories={categories}
        accounts={accounts}
      />
    </div>
  );
}
