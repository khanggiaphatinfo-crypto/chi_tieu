'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { formatARS, formatUSD, parseMoney } from '@/lib/format';
import { toLocalISO } from '@/lib/date';
import { MoneyInput } from '@/components/MoneyInput';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SecondaryButton } from '@/components/SecondaryButton';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { BottomNav } from '@/components/BottomNav';
import { AddTransactionSheet } from '@/components/AddTransactionSheet';
import { toast } from 'sonner';
import Link from 'next/link';
import { EmptyState } from '@/components/EmptyState';

interface Profile {
  id: string;
  household_id: string;
  nickname: string | null;
  display_name: string | null;
}

interface Debt {
  id: string;
  // Whose debt this is. The list shows the whole household, so cards and
  // totals need to distinguish the viewer's debts from the partner's.
  profile_id: string;
  counterparty: string;
  direction: 'owe' | 'owed';
  amount: number;
  // Already-paid portion; remaining = amount - paid_amount.
  paid_amount: number;
  currency: 'ARS' | 'USD';
  note: string | null;
  settled: boolean;
  transaction_id: string | null;
}

function remainingOf(d: Debt): number {
  return Math.max(d.amount - d.paid_amount, 0);
}

interface LinkableExpense { id: string; label: string; occurred_on: string; }

function fmtMoney(amount: number, currency: string): string {
  return currency === 'USD' ? formatUSD(amount) : formatARS(amount);
}

// Sum the REMAINING of unsettled debts of a direction, split by currency
// (partial payments shrink what's actually pending).
function totalsByCurrency(debts: Debt[], direction: 'owe' | 'owed') {
  const rows = debts.filter((d) => !d.settled && d.direction === direction);
  const usd = rows.filter((d) => d.currency === 'USD').reduce((s, d) => s + remainingOf(d), 0);
  const ars = rows.filter((d) => d.currency === 'ARS').reduce((s, d) => s + remainingOf(d), 0);
  return { usd, ars };
}

function DebtForm({
  initial,
  expenses,
  onSave,
  onCancel,
}: {
  initial?: Partial<Debt>;
  expenses: LinkableExpense[];
  // profile_id is set by the caller on create and never changed on edit.
  // paid_amount is managed by the partial-payment / settle actions, not the form.
  onSave: (data: Omit<Debt, 'id' | 'profile_id' | 'paid_amount'>) => void;
  onCancel: () => void;
}) {
  const [direction, setDirection] = useState<'owe' | 'owed'>(initial?.direction ?? 'owe');
  const [counterparty, setCounterparty] = useState(initial?.counterparty ?? '');
  const [amountStr, setAmountStr] = useState(initial?.amount ? String(initial.amount) : '');
  const [currency, setCurrency] = useState<'ARS' | 'USD'>(initial?.currency ?? 'USD');
  const [note, setNote] = useState(initial?.note ?? '');
  const [settled, setSettled] = useState(initial?.settled ?? false);
  const [transactionId, setTransactionId] = useState<string>(initial?.transaction_id ?? '');

  function handleSave() {
    const amount = parseMoney(amountStr);
    if (!counterparty.trim() || !amount || amount <= 0) {
      toast.error('Hãy nhập người và số tiền.');
      return;
    }
    onSave({ direction, counterparty: counterparty.trim(), amount, currency, note: note.trim() || null, settled, transaction_id: transactionId || null });
  }

  return (
    <div className="flex flex-col gap-4 p-5 rounded-3xl" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
      {/* Direction */}
      <div className="flex rounded-2xl overflow-hidden" style={{ background: '#E5EBE8' }}>
        {(['owe', 'owed'] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDirection(d)}
            className="flex-1 py-2.5 text-sm font-black transition-all"
            style={{
              background: direction === d ? (d === 'owe' ? '#FF6F61' : '#2FA37C') : 'transparent',
              color: direction === d ? '#FFFFFF' : '#5B6660',
              borderRadius: '14px',
              boxShadow: direction === d ? 'var(--shadow-soft)' : 'none',
            }}
          >
            {d === 'owe' ? 'Tôi nợ' : 'Họ nợ tôi'}
          </button>
        ))}
      </div>

      {/* Counterparty */}
      <input
        type="text"
        placeholder={direction === 'owe' ? 'Bạn nợ ai? (vd: Franco)' : 'Ai nợ bạn?'}
        value={counterparty}
        onChange={(e) => setCounterparty(e.target.value)}
        className="w-full px-4 py-3 rounded-2xl text-sm border outline-none"
        style={{ borderColor: '#E5EBE8', color: '#18211D' }}
      />

      {/* Currency */}
      <div>
        <p className="text-xs font-semibold mb-2" style={{ color: '#5B6660' }}>Tiền tệ</p>
        <div className="flex rounded-2xl overflow-hidden" style={{ background: '#E5EBE8' }}>
          {(['ARS', 'USD'] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setCurrency(c)}
              className="flex-1 py-2.5 text-sm font-black transition-all"
              style={{
                background: currency === c ? '#2FA37C' : 'transparent',
                color: currency === c ? '#FFFFFF' : '#5B6660',
                borderRadius: '14px',
                boxShadow: currency === c ? 'var(--shadow-soft)' : 'none',
              }}
            >
              {c === 'ARS' ? 'ARS (Peso)' : 'USD (Đô la)'}
            </button>
          ))}
        </div>
      </div>

      {/* Amount */}
      <MoneyInput
        placeholder={`Số tiền bằng ${currency}`}
        value={parseMoney(amountStr)}
        onChange={(n) => setAmountStr(n ? String(n) : '')}
        className="w-full px-4 py-3 rounded-2xl text-sm border outline-none"
        style={{ borderColor: '#E5EBE8', color: '#18211D' }}
      />

      {/* Note */}
      <input
        type="text"
        placeholder="Ghi chú (tùy chọn)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        className="w-full px-4 py-3 rounded-2xl text-sm border outline-none"
        style={{ borderColor: '#E5EBE8', color: '#18211D' }}
      />

      {/* Liên kết với một khoản chi — chỉ khi ai đó hoàn tiền cho bạn, để phân tích trừ khoản hoàn trả khỏi chi phí thực tế. */}
      {direction === 'owed' && expenses.length > 0 && (
        <div>
          <p className="text-xs font-semibold mb-2" style={{ color: '#5B6660' }}>
            Đây có phải là khoản hoàn trả cho một chi phí của bạn không? (tùy chọn)
          </p>
          <select
            value={transactionId}
            onChange={(e) => setTransactionId(e.target.value)}
            className="w-full px-4 py-3 rounded-2xl text-sm border outline-none"
            style={{ borderColor: transactionId ? '#2FA37C' : '#E5EBE8', color: '#18211D', background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}
          >
            <option value="">Không liên kết</option>
            {expenses.map((e) => (
              <option key={e.id} value={e.id}>{e.label}</option>
            ))}
          </select>
          {transactionId && (
            <p className="text-[11px] mt-1.5" style={{ color: '#1F8A68' }}>
              ✓ Phân tích sẽ trừ số tiền này khỏi chi phí đó.
            </p>
          )}
        </div>
      )}

      {/* Settled toggle */}
      <button
        type="button"
        onClick={() => setSettled((v) => !v)}
        className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold border w-fit"
        style={{
          background: settled ? '#DDF0E8' : '#FFFFFF',
          borderColor: settled ? '#2FA37C' : '#E5EBE8',
          color: settled ? '#1F8A68' : '#5B6660',
        }}
      >
        {settled ? '✓ Đã trả hết' : 'Đang chờ'}
      </button>

      <div className="flex gap-3">
        <SecondaryButton onClick={onCancel} className="flex-1 py-3 text-sm">
          Hủy
        </SecondaryButton>
        <PrimaryButton
          onClick={handleSave}
          disabled={!counterparty.trim() || !(parseMoney(amountStr) > 0)}
          className="flex-1 py-3 text-sm"
        >
          Lưu
        </PrimaryButton>
      </div>
    </div>
  );
}

  // Khoản thanh toán một phần cho một khoản nợ của người dùng. Đặt ở cấp module để ô nhập giữ được focus.
function PartialPaymentForm({
  debt,
  onSave,
  onCancel,
}: {
  debt: Debt;
  onSave: (payment: number) => void;
  onCancel: () => void;
}) {
  const [payStr, setPayStr] = useState('');
  const remaining = remainingOf(debt);
  const payment = parseMoney(payStr);

  return (
    <div className="flex flex-col gap-4 p-5 rounded-3xl" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
      <div>
        <p className="font-bold text-sm" style={{ color: '#18211D' }}>
          Thanh toán một phần · {debt.direction === 'owe' ? `Tôi nợ ${debt.counterparty}` : `${debt.counterparty} nợ tôi`}
        </p>
        <p className="text-xs mt-1" style={{ color: '#5B6660' }}>
          Còn lại {fmtMoney(remaining, debt.currency)}/tổng {fmtMoney(debt.amount, debt.currency)}
        </p>
      </div>
      <MoneyInput
        placeholder={`Số tiền bằng ${debt.currency} (tối đa ${fmtMoney(remaining, debt.currency)})`}
        value={payment}
        // Cap at the remaining so paid_amount can never exceed the debt.
        onChange={(n) => setPayStr(n ? String(Math.min(n, remaining)) : '')}
        className="w-full px-4 py-3 rounded-2xl text-sm border outline-none"
        style={{ borderColor: '#E5EBE8', color: '#18211D' }}
      />
      {payment > 0 && payment >= remaining && (
        <p className="text-[11px]" style={{ color: '#1F8A68' }}>
          ✓ Khoản nợ sẽ được thanh toán hết sau lần này.
        </p>
      )}
      <div className="flex gap-3">
        <SecondaryButton onClick={onCancel} className="flex-1 py-3 text-sm">
          Hủy
        </SecondaryButton>
        <PrimaryButton
          onClick={() => onSave(Math.min(payment, remaining))}
          disabled={!(payment > 0)}
          className="flex-1 py-3 text-sm"
        >
          Ghi nhận thanh toán
        </PrimaryButton>
      </div>
    </div>
  );
}

function TotalsCard({ debts, viewerId, partnerName }: { debts: Debt[]; viewerId: string; partnerName: string }) {
  // “Tôi nợ / Họ nợ tôi” chỉ cộng các khoản nợ của người dùng; khoản của người đồng hành hiển thị riêng để không trộn lẫn.
  const mine = debts.filter((d) => d.profile_id === viewerId);
  const partners = debts.filter((d) => d.profile_id !== viewerId);
  const owe = totalsByCurrency(mine, 'owe');
  const owed = totalsByCurrency(mine, 'owed');
  const pOwe = totalsByCurrency(partners, 'owe');
  const pOwed = totalsByCurrency(partners, 'owed');
  const hasOwe = owe.usd > 0 || owe.ars > 0;
  const hasOwed = owed.usd > 0 || owed.ars > 0;
  const hasPartner = pOwe.usd > 0 || pOwe.ars > 0 || pOwed.usd > 0 || pOwed.ars > 0;
  if (!hasOwe && !hasOwed && !hasPartner) return null;

  function amounts(t: { usd: number; ars: number }) {
    const parts = [t.usd ? formatUSD(t.usd) : null, t.ars ? formatARS(t.ars) : null].filter(Boolean);
    return parts.length ? parts.join(' + ') : '—';
  }

  return (
    <div className="rounded-3xl overflow-hidden" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-pop)' }}>
      <div className="relative px-5 pt-5 pb-5 overflow-hidden" style={{ background: 'linear-gradient(135deg, #34AD84 0%, #1F8A68 100%)' }}>
        <div className="absolute -top-10 -right-8 w-40 h-40 rounded-full pointer-events-none" style={{ background: 'rgba(255,255,255,0.14)' }} />
        <div className="relative flex items-center justify-between">
          <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.82)' }}>
            Đang chờ
          </p>
        </div>
        <div className="relative flex gap-3 mt-3">
          <div className="flex-1 rounded-2xl px-3 py-3" style={{ background: 'rgba(255,255,255,0.16)' }}>
            <p className="text-[11px] font-bold" style={{ color: 'rgba(255,255,255,0.82)' }}>Tôi nợ</p>
            <p className="text-lg font-black leading-tight" style={{ color: '#FFFFFF', fontVariantNumeric: 'tabular-nums' }}>
              {amounts(owe)}
            </p>
          </div>
          <div className="flex-1 rounded-2xl px-3 py-3" style={{ background: 'rgba(255,255,255,0.22)' }}>
            <p className="text-[11px] font-bold" style={{ color: 'rgba(255,255,255,0.9)' }}>Họ nợ tôi</p>
            <p className="text-lg font-black leading-tight" style={{ color: '#FFFFFF', fontVariantNumeric: 'tabular-nums' }}>
              {amounts(owed)}
            </p>
          </div>
        </div>
      </div>
      {hasPartner && (
        <div className="px-4 py-4">
          <p className="text-xs" style={{ color: '#5B6660' }}>
            {partnerName}: nợ {amounts(pOwe)} · bị nợ {amounts(pOwed)}
          </p>
        </div>
      )}
    </div>
  );
}

export default function DeudasClient({ profile }: { profile: Profile }) {
  const supabase = createClient();
  const qc = useQueryClient();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fabType, setFabType] = useState<'expense' | 'income' | 'transfer'>('expense');
  const [showForm, setShowForm] = useState(false);
  const [editDebt, setEditDebt] = useState<Debt | null>(null);
  const [partialDebt, setPartialDebt] = useState<Debt | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Debt | null>(null);

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

  // Hồ sơ trong hộ gia đình, dùng để hiển thị tên người đồng hành cho các khoản nợ không thuộc người dùng.
  const { data: householdProfiles = [] } = useQuery({
    queryKey: ['household-profiles', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, nickname, display_name')
        .eq('household_id', profile.household_id);
      return data ?? [];
    },
  });
  const nameOf = (profileId: string) => {
    const p = householdProfiles.find((p) => p.id === profileId);
    return p?.nickname || p?.display_name || 'Bạn đời';
  };
  const partnerName = nameOf(householdProfiles.find((p) => p.id !== profile.id)?.id ?? '');

  const { data: debts = [], isLoading } = useQuery({
    queryKey: ['debts', profile.household_id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('debts')
        .select('id, profile_id, counterparty, direction, amount, currency, note, settled, transaction_id, paid_amount')
        .eq('household_id', profile.household_id)
        .order('settled')
        .order('created_at', { ascending: false });
      if (error) throw error;
      // Rows created before the column existed can have a null paid_amount.
      return ((data ?? []) as Debt[]).map((d) => ({ ...d, paid_amount: d.paid_amount ?? 0 }));
    },
  });

  // Các khoản chi gần đây mà một khoản nợ “họ nợ tôi” có thể liên kết để phân tích trừ khoản hoàn trả khỏi chi phí thực tế.
  const { data: linkableExpenses = [] } = useQuery<LinkableExpense[]>({
    queryKey: ['linkable-expenses', profile.household_id],
    queryFn: async () => {
      // Dùng toLocalISO thay vì toISOString: ngày UTC có thể bị lệch một ngày ở Argentina.
      const since = toLocalISO(new Date(Date.now() - 90 * 86400000));
      const { data } = await supabase
        .from('transactions')
        .select('id, merchant, amount, currency, occurred_on, categories(name)')
        .eq('household_id', profile.household_id)
        .eq('type', 'expense')
        .gte('occurred_on', since)
        .order('occurred_on', { ascending: false })
        .limit(60);
      return ((data ?? []) as { id: string; merchant: string | null; amount: number; currency: string; occurred_on: string; categories: { name: string } | null }[])
        .map((t) => ({
          id: t.id,
          occurred_on: t.occurred_on,
          label: `${t.occurred_on.slice(5)} · ${t.merchant || t.categories?.name || 'Gasto'} · ${t.currency === 'USD' ? formatUSD(t.amount) : formatARS(t.amount)}`,
        }));
    },
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['debts'] });

  // Khi hoàn trả một khoản nợ “họ nợ tôi” đã liên kết với chi phí, giảm chi phí thực tế theo số tiền đã trả.
  async function applyRepaymentNetting(debt: Debt, newPaid: number) {
    if (debt.direction !== 'owed' || !debt.transaction_id) return;
    const delta = (debt.paid_amount ?? 0) - newPaid; // negative while paying down
    if (delta === 0) return;
    const { data: tx, error } = await supabase
      .from('transactions')
      .select('id, amount, currency')
      .eq('id', debt.transaction_id)
      .maybeSingle();
    if (error) throw error;
    // Skip if the linked gasto was deleted or is in another currency (we'd have
    // no safe rate to net at); the debt still settles, just without netting.
    if (!tx || tx.currency !== debt.currency) return;
    const next = Math.max(0, Number(tx.amount) + delta);
    const { error: upErr } = await supabase
      .from('transactions')
      .update({ amount: next })
      .eq('id', tx.id);
    if (upErr) throw upErr;
  }

  // Việc ghi nhận hoàn trả làm thay đổi dòng tiền, nên làm mới các truy vấn giống như biểu mẫu thêm chi phí.
  const invalidateMoney = () =>
    Promise.all(
      ['transactions', 'account-tx', 'spent-by-category', 'category-month-totals', 'budget-expense-rows', 'summary', 'category-tx', 'couple-balance'].map(
        (key) => qc.invalidateQueries({ queryKey: [key] }),
      ),
    );

  const createMutation = useMutation({
    mutationFn: async (data: Omit<Debt, 'id' | 'profile_id' | 'paid_amount'>) => {
      const { error } = await supabase.from('debts').insert({
        ...data,
        household_id: profile.household_id,
        profile_id: profile.id,
      });
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Đã lưu khoản nợ ✓'); setShowForm(false); invalidate(); },
    onError: () => toast.error('Không thể lưu khoản nợ.'),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Omit<Debt, 'id' | 'profile_id' | 'paid_amount'> }) => {
      // Nếu biểu mẫu đánh dấu đã thanh toán, đồng bộ paid_amount để số liệu luôn nhất quán.
      const payload = data.settled ? { ...data, paid_amount: data.amount } : data;
      const { error } = await supabase.from('debts').update(payload).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Đã cập nhật khoản nợ ✓'); setEditDebt(null); invalidate(); },
    onError: () => toast.error('Không thể cập nhật khoản nợ.'),
  });

  const toggleSettled = useMutation({
    mutationFn: async (d: Debt) => {
      // Thanh toán toàn bộ sẽ đặt lại số tiền đã trả khi mở lại, để số dư còn lại luôn chính xác.
      const newPaid = d.settled ? 0 : d.amount;
      // Net the repayment out of the linked gasto BEFORE flipping paid_amount —
      // the netting delta is read from the debt's current paid_amount.
      await applyRepaymentNetting(d, newPaid);
      const payload = d.settled ? { settled: false, paid_amount: 0 } : { settled: true, paid_amount: d.amount };
      const { error } = await supabase.from('debts').update(payload).eq('id', d.id);
      if (error) throw error;
    },
    onSuccess: (_data, d) => {
      toast.success(d.settled ? 'Đã đánh dấu đang chờ' : 'Đã trả hết ✓');
      invalidate();
      invalidateMoney();
    },
    onError: () => toast.error('Không thể cập nhật.'),
  });

  const partialPayMutation = useMutation({
    mutationFn: async ({ debt, payment }: { debt: Debt; payment: number }) => {
      // Không vượt quá số tiền gốc để paid_amount không bao giờ lớn hơn khoản nợ.
      const newPaid = Math.min(debt.paid_amount + payment, debt.amount);
      // Trừ phần vừa thanh toán khỏi chi phí đã liên kết (dựa trên thay đổi của paid_amount).
      await applyRepaymentNetting(debt, newPaid);
      const { error } = await supabase
        .from('debts')
        .update({ paid_amount: newPaid, settled: newPaid >= debt.amount ? true : debt.settled })
        .eq('id', debt.id);
      if (error) throw error;
    },
    onSuccess: (_data, { debt, payment }) => {
      toast.success(debt.paid_amount + payment >= debt.amount ? 'Đã trả hết khoản nợ ✓' : 'Đã ghi nhận thanh toán ✓');
      setPartialDebt(null);
      invalidate();
      invalidateMoney();
    },
    onError: () => toast.error('Không thể ghi nhận thanh toán.'),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('debts').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { toast.success('Đã xóa khoản nợ'); invalidate(); },
    onError: () => toast.error('Không thể xóa khoản nợ.'),
  });

  const pending = debts.filter((d) => !d.settled);
  const settled = debts.filter((d) => d.settled);

  function DebtCard({ debt }: { debt: Debt }) {
    // Thẻ của người đồng hành dùng ngôi thứ ba — không được hiểu là khoản nợ của người dùng.
    const isMine = debt.profile_id === profile.id;
    const ownerName = isMine ? null : nameOf(debt.profile_id);
    const title = isMine
      ? debt.direction === 'owe'
        ? `Tôi nợ ${debt.counterparty}`
        : `${debt.counterparty} nợ tôi`
      : debt.direction === 'owe'
        ? `${ownerName} nợ ${debt.counterparty}`
        : `${debt.counterparty} nợ ${ownerName}`;
    const remaining = remainingOf(debt);
    const partiallyPaid = !debt.settled && debt.paid_amount > 0 && remaining > 0;
    // Chỉ dùng “bạn đã trả” khi người dùng đang trả khoản nợ của chính mình; trường hợp khác dùng ngôi thứ ba.
    const paidVerb = isMine && debt.direction === 'owe' ? 'bạn đã trả' : 'đã trả';
    const paidPct = debt.amount > 0 ? Math.min(100, Math.round((debt.paid_amount / debt.amount) * 100)) : 0;
    const accent = debt.direction === 'owe' ? '#FF6F61' : '#2FA37C';
    return (
      <div className="px-4 py-3.5" style={{ borderTop: '1px solid #E5EBE8', opacity: debt.settled ? 0.6 : 1 }}>
            {/* Phần đầu: người/khoản nợ và số tiền nổi bật */}
        <div className="flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-lg shrink-0"
            style={{ background: debt.direction === 'owe' ? '#FFE5E0' : '#DDF0E8' }}
          >
            {debt.direction === 'owe' ? '💸' : '🤝'}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-bold text-sm truncate" style={{ color: '#18211D' }}>{title}</p>
            <p className="text-[11px] truncate" style={{ color: '#5B6660' }}>
              {debt.settled ? 'Đã trả hết' : 'Đang chờ'}{debt.note ? ` · ${debt.note}` : ''}{debt.transaction_id ? ' · 🔗' : ''}
            </p>
          </div>
          <div className="text-right shrink-0">
            {/* Unsettled cards show what's still pending, not the original total. */}
            <p className="font-black text-base tabular-nums leading-tight" style={{ color: accent }}>
              {fmtMoney(debt.settled ? debt.amount : remaining, debt.currency)}
            </p>
            {partiallyPaid && (
              <p className="text-[10px] tabular-nums" style={{ color: '#8C968F' }}>de {fmtMoney(debt.amount, debt.currency)}</p>
            )}
          </div>
        </div>

            {/* Tiến độ thanh toán một phần */}
        {partiallyPaid && (
          <div className="mt-2 ml-12">
            <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#EAF0ED' }}>
              <div className="h-full rounded-full" style={{ width: `${paidPct}%`, background: '#2FA37C' }} />
            </div>
            <p className="text-[10px] mt-1 font-semibold" style={{ color: '#1F8A68' }}>
              {paidVerb} {fmtMoney(debt.paid_amount, debt.currency)} ({paidPct}%)
            </p>
          </div>
        )}

        {/* Các thao tác nằm ở hàng riêng để không chen lấn số tiền */}
        <div className="flex items-center gap-2 mt-3 pt-3" style={{ borderTop: '1px solid #EAF0ED' }}>
          <button
            onClick={() => toggleSettled.mutate(debt)}
            className="flex-1 text-xs font-bold py-2 rounded-xl"
            style={{ background: debt.settled ? '#F1F5F3' : '#DDF0E8', color: debt.settled ? '#5B6660' : '#1F8A68' }}
          >
            {debt.settled ? '↩️ Mở lại' : '✓ Thanh toán hết'}
          </button>
          {!debt.settled && isMine && (
            <button
              onClick={() => { setShowForm(false); setEditDebt(null); setPartialDebt(debt); }}
              className="flex-1 text-xs font-bold py-2 rounded-xl"
              style={{ background: '#E9F1FD', color: '#4E84E0' }}
            >
              💵 Thanh toán
            </button>
          )}
          <button
            onClick={() => { setPartialDebt(null); setEditDebt(debt); }}
            aria-label="Chỉnh sửa"
            className="px-3 py-2 text-xs rounded-xl border"
            style={{ borderColor: '#E5EBE8', color: '#5B6660' }}
          >
            ✏️
          </button>
          <button
            onClick={() => setConfirmDelete(debt)}
            aria-label="Xóa"
            className="px-3 py-2 text-xs rounded-xl border"
            style={{ borderColor: '#FFE5E0', color: '#FF6F61' }}
          >
            🗑
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24" style={{ background: '#F1F5F3' }}>
      <header className="px-5 pt-14 pb-4 flex items-center gap-3">
        <Link href="/mas" className="text-2xl">←</Link>
        <h1 className="text-2xl font-black" style={{ color: '#18211D' }}>Khoản nợ</h1>
      </header>

      <div className="px-4 flex flex-col gap-4">
        {!showForm && !editDebt && !partialDebt && debts.length > 0 && (
          <TotalsCard debts={debts} viewerId={profile.id} partnerName={partnerName} />
        )}

        {showForm && !editDebt && (
          <DebtForm
            expenses={linkableExpenses}
            onSave={(data) => createMutation.mutate(data)}
            onCancel={() => setShowForm(false)}
          />
        )}

        {editDebt && (
          <DebtForm
            initial={editDebt}
            expenses={linkableExpenses}
            onSave={(data) => updateMutation.mutate({ id: editDebt.id, data })}
            onCancel={() => setEditDebt(null)}
          />
        )}

        {partialDebt && (
          <PartialPaymentForm
            debt={partialDebt}
            onSave={(payment) => partialPayMutation.mutate({ debt: partialDebt, payment })}
            onCancel={() => setPartialDebt(null)}
          />
        )}

        {!showForm && !editDebt && !partialDebt && (
          <button
            onClick={() => setShowForm(true)}
            className="w-full py-4 rounded-3xl text-sm font-black text-white transition-all"
            style={{ background: 'linear-gradient(135deg, #34AD84 0%, #1F8A68 100%)', boxShadow: 'var(--shadow-glow)' }}
          >
            + Khoản nợ mới
          </button>
        )}

        {pending.length > 0 && (
          <div className="rounded-3xl overflow-hidden" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
            <div className="px-5 py-3" style={{ borderBottom: '1px solid #E5EBE8' }}>
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#FF6F61' }}>
                Đang chờ
              </p>
            </div>
            {pending.map((d) => <DebtCard key={d.id} debt={d} />)}
          </div>
        )}

        {settled.length > 0 && (
          <div className="rounded-3xl overflow-hidden" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
            <div className="px-5 py-3" style={{ borderBottom: '1px solid #E5EBE8' }}>
              <p className="text-xs font-bold uppercase tracking-wide" style={{ color: '#1F8A68' }}>
                Đã trả hết
              </p>
            </div>
            {settled.map((d) => <DebtCard key={d.id} debt={d} />)}
          </div>
        )}

        {!isLoading && debts.length === 0 && !showForm && (
          <EmptyState
            icon="🤝"
            title="Không có khoản nợ"
            subtitle="Ghi lại những gì bạn nợ hoặc người khác nợ bạn."
          />
        )}
      </div>

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Xóa khoản nợ?"
        message={confirmDelete ? `Khoản nợ với ${confirmDelete.counterparty} sẽ bị xóa. Hành động này không thể hoàn tác.` : undefined}
        confirmLabel="Xóa"
        onConfirm={() => {
          if (confirmDelete) deleteMutation.mutate(confirmDelete.id);
          setConfirmDelete(null);
        }}
        onCancel={() => setConfirmDelete(null)}
      />

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
