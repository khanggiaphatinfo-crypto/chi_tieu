'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { createClient } from '@/lib/supabase';
import { useFx } from '@/hooks/useFx';
import { useCoupleBalance, recordSettlement } from '@/hooks/useCouple';
import { BottomNav } from '@/components/BottomNav';
import { AddTransactionSheet } from '@/components/AddTransactionSheet';
import { InvitePartnerModal } from '@/components/InvitePartnerModal';
import { formatARS } from '@/lib/format';
import { MoneyInput } from '@/components/MoneyInput';
import { todayISO, toLocalISO, shortDayMonth } from '@/lib/date';
import { toast } from 'sonner';
import Link from 'next/link';

interface Profile {
  id: string;
  household_id: string;
  nickname: string | null;
  display_name: string | null;
}

interface Partner {
  id: string;
  name: string;
}

interface SettleAccount {
  id: string;
  name: string;
  type: string;
  currency: string;
  owner_profile_id?: string | null;
}

/** One shared gasto someone fronted, for the per-category double-entry sheet. */
interface SharedTx {
  id: string;
  merchant: string | null;
  occurred_on: string;
  amountArs: number;
}

/** A shared category's combined spend plus who-owes-whom breakdown (all ARS). */
interface SharedCatDetail {
  key: string;
  name: string;
  icon: string;
  amount: number;
  /** Partner's share of the gastos I fronted → partner owes me this. */
  owedToMe: number;
  /** My share of the gastos the partner fronted → I owe partner this. */
  iOwe: number;
  myTxs: SharedTx[];
  partnerTxs: SharedTx[];
}

function SettleUpSheet({
  open,
  onClose,
  net,
  myName,
  partnerName,
  householdId,
  myProfileId,
  partnerProfileId,
  accounts,
  fmt,
}: {
  open: boolean;
  onClose: () => void;
  net: number;
  myName: string;
  partnerName: string;
  householdId: string;
  myProfileId: string;
  partnerProfileId: string;
  accounts: SettleAccount[];
  fmt: (n: number) => string;
}) {
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  // Amount being settled, in ARS. Defaults to the full balance but can be a
  // partial payment — or larger than the balance, which flips who owes whom.
  // 0 = empty field, which falls back to the full balance.
  const [amountVal, setAmountVal] = useState(0);
  const [date, setDate] = useState(todayISO());
  // When on, the payment also moves real money between the partners' accounts
  // (a transfer), not just the abstract couple balance. Off = cash / external.
  const [moveMoney, setMoveMoney] = useState(true);
  const [fromAccountId, setFromAccountId] = useState<string | null>(null);
  const [toAccountId, setToAccountId] = useState<string | null>(null);
  // Payment direction, chosen explicitly. Either person can pay the other
  // regardless of who currently owes — paying against the balance just shifts
  // it the other way. Defaults to the direction that settles the debt.
  const [iPay, setIPay] = useState(net < 0);

  // net > 0 → partner owes me; net < 0 → I owe partner.
  const absNet = Math.round(Math.abs(net));
  // No upper cap: paying any amount is valid; the resulting balance is derived.
  const amount = amountVal > 0 ? Math.round(amountVal) : absNet;

  // The payer is whoever the direction toggle says; the receiver is the other.
  // Money legs are filtered to each side's own non-credit ARS accounts (the
  // couple ledger is in ARS).
  const payerProfileId = iPay ? myProfileId : partnerProfileId;
  const receiverProfileId = iPay ? partnerProfileId : myProfileId;
  const payerName = iPay ? myName : partnerName;
  const receiverName = iPay ? partnerName : myName;

  // Resulting couple balance from my perspective: paying my partner pushes the
  // balance toward "partner owes me" (+); the partner paying me pushes it the
  // other way (−). Drives every preview/toast message, in any direction.
  const newNet = net + (iPay ? amount : -amount);
  const settledExactly = Math.abs(newNet) < 1;
  const eligible = (ownerId: string) =>
    accounts.filter(
      (a) => a.type !== 'credit' && a.currency === 'ARS' && (a.owner_profile_id == null || a.owner_profile_id === ownerId),
    );
  const fromAccounts = eligible(payerProfileId);
  const toAccounts = eligible(receiverProfileId);
  const canMoveMoney = fromAccounts.length > 0 && toAccounts.length > 0;
  const effectiveFromId =
    fromAccountId && fromAccounts.some((a) => a.id === fromAccountId) ? fromAccountId : (fromAccounts[0]?.id ?? null);
  const effectiveToId =
    toAccountId && toAccounts.some((a) => a.id === toAccountId) ? toAccountId : (toAccounts[0]?.id ?? null);
  const willMoveMoney = moveMoney && canMoveMoney && !!effectiveFromId && !!effectiveToId;

  async function handleSettle() {
    if (amount <= 0) return;
    setSaving(true);
    try {
      await recordSettlement({
        householdId,
        fromProfileId: payerProfileId,
        toProfileId: receiverProfileId,
        amount,
        note,
        occurredOn: date,
        fromAccountId: willMoveMoney ? effectiveFromId : null,
        toAccountId: willMoveMoney ? effectiveToId : null,
      });
      // Invalidate the couple balance plus everything a money movement touches,
      // so account balances and net worth refresh when this also moved money.
      await Promise.all(
        ['couple-balance', 'couple-transactions', 'transactions', 'account-tx', 'summary', 'projection'].map((key) =>
          qc.invalidateQueries({ queryKey: [key] }),
        ),
      );
      toast.success(
        settledExactly
          ? 'Đã tất toán! Số dư bằng không ✓'
          : newNet > 0
            ? `Đã ghi nhận khoản thanh toán. ${partnerName} còn nợ bạn ${fmt(newNet)} ✓`
            : `Đã ghi nhận khoản thanh toán. Bạn còn nợ ${fmt(-newNet)} cho ${partnerName} ✓`,
      );
      onClose();
      setNote('');
    } catch {
      toast.error('Không thể ghi nhận. Hãy thử lại.');
    } finally {
      setSaving(false);
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center animate-in fade-in duration-200" style={{ background: 'rgba(20,28,24,0.42)' }} onClick={onClose}>
      <div
        className="w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl p-6 animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200"
        style={{ background: '#F1F5F3', boxShadow: 'var(--shadow-pop)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center mb-4">
          <div className="w-10 h-1 rounded-full" style={{ background: '#E5EBE8' }} />
        </div>

        <h2 className="text-xl font-black mb-1" style={{ color: '#18211D' }}>Ghi nhận khoản thanh toán</h2>
        <p className="text-sm mb-4" style={{ color: '#5B6660' }}>
          {absNet < 1
            ? 'Đã thanh toán đủ.'
            : net > 0
              ? `${partnerName} còn nợ bạn ${fmt(absNet)}`
              : `Bạn còn nợ ${fmt(absNet)} cho ${partnerName}`}
        </p>

        {/* Direction — either person can pay the other, regardless of who owes. */}
        <p className="text-xs font-bold mb-1.5" style={{ color: '#5B6660' }}>Ai trả cho ai?</p>
        <div className="flex rounded-2xl overflow-hidden p-1 gap-1 mb-4" style={{ background: '#E5EBE8' }}>
          {([
            { key: true, label: `👤 ${myName} → ${partnerName}` },
            { key: false, label: `👥 ${partnerName} → ${myName}` },
          ] as const).map((o) => {
            const active = iPay === o.key;
            return (
              <button
                key={String(o.key)}
                onClick={() => setIPay(o.key)}
                className="flex-1 py-2 text-xs font-black rounded-xl transition-all"
                style={{ background: active ? '#FFFFFF' : 'transparent', color: active ? '#18211D' : '#5B6660', boxShadow: active ? 'var(--shadow-soft)' : 'none' }}
              >
                {o.label}
              </button>
            );
          })}
        </div>

        <div
          key={settledExactly ? 'settled' : 'paying'}
          className={`rounded-2xl p-4 mb-4 text-center transition-colors ${settledExactly ? 'animate-pop' : ''}`}
          style={{ background: settledExactly ? '#DDF0E8' : iPay ? '#FFE5E0' : '#DDF0E8' }}
        >
          <p className="text-3xl font-black" style={{ color: settledExactly ? '#1F8A68' : iPay ? '#E25749' : '#1F8A68' }}>
            {settledExactly ? '🤝 Đã thanh toán đủ!' : fmt(amount)}
          </p>
          <p className="text-xs mt-1" style={{ color: settledExactly ? '#1F8A68' : iPay ? '#E25749' : '#1F8A68', opacity: 0.75 }}>
            {settledExactly ? `${fmt(amount)} · ${payerName} → ${receiverName}` : `${payerName} → ${receiverName}`}
          </p>
        </div>

        {/* Amount — defaults to the current balance; type any amount you want. */}
        <p className="text-xs font-bold mb-1.5" style={{ color: '#5B6660' }}>Số tiền thanh toán? (ARS)</p>
        <div className="flex items-center gap-2 mb-2">
          {/* MoneyInput handles the Vietnamese convention ('.' thousands, ',' decimal),
              so typing "15.000" means fifteen thousand, not fifteen pesos. */}
          <MoneyInput
            value={amountVal}
            onChange={setAmountVal}
            placeholder={absNet.toLocaleString('vi-VN')}
            className="flex-1 px-4 py-3 rounded-2xl text-sm border bg-white outline-none"
            style={{ borderColor: '#E5EBE8', color: '#18211D' }}
          />
          {absNet >= 1 && (
            <button
              onClick={() => setAmountVal(0)}
              className="px-3 py-3 rounded-2xl text-xs font-bold border"
              style={{ borderColor: '#E5EBE8', color: '#5B6660', background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}
            >
              Số dư
            </button>
          )}
        </div>
        {amount > 0 && (
          <p className="text-xs mb-3" style={{ color: settledExactly ? '#1F8A68' : '#5B6660' }}>
            {settledExactly
              ? 'Sau khoản này, hai người đã thanh toán đủ. 🤝'
              : newNet > 0
                ? `Sau khoản này, ${partnerName} còn nợ bạn ${fmt(newNet)}.`
                : `Sau khoản này, bạn còn nợ ${fmt(-newNet)} cho ${partnerName}.`}
          </p>
        )}

        {/* Real money movement — record the transfer between accounts, not just
            the couple balance. Off = cash or settled outside the app. */}
        <div className="rounded-2xl p-3 mb-3 border" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)', borderColor: '#E5EBE8' }}>
          <button
            onClick={() => setMoveMoney((v) => !v)}
            disabled={!canMoveMoney}
            className="w-full flex items-center justify-between disabled:opacity-50"
          >
            <span className="text-xs font-bold" style={{ color: '#18211D' }}>
              💸 Chuyển tiền giữa các tài khoản
            </span>
            <span
              className="text-[11px] font-bold px-2 py-1 rounded-full"
              style={{
                background: willMoveMoney ? '#DDF0E8' : '#E5EBE8',
                color: willMoveMoney ? '#1F8A68' : '#5B6660',
              }}
            >
              {willMoveMoney ? 'Có' : 'Không'}
            </span>
          </button>
          {!canMoveMoney ? (
            <p className="text-[11px] mt-2" style={{ color: '#5B6660' }}>
              Cần có một tài khoản bằng peso (không phải thẻ) của mỗi người để ghi nhận giao dịch.
            </p>
          ) : (
            willMoveMoney && (
              <div className="flex items-center gap-2 mt-2">
                <div className="flex-1">
                  <p className="text-[11px] font-bold mb-1" style={{ color: '#5B6660' }}>Từ · {payerName}</p>
                  <select
                    value={effectiveFromId ?? ''}
                    onChange={(e) => setFromAccountId(e.target.value || null)}
                    className="w-full px-3 py-2 rounded-xl text-xs font-bold border bg-white"
                    style={{ borderColor: '#E5EBE8', color: '#18211D' }}
                  >
                    {fromAccounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
                <span className="text-lg mt-4" style={{ color: '#4E84E0' }}>→</span>
                <div className="flex-1">
                  <p className="text-[11px] font-bold mb-1" style={{ color: '#5B6660' }}>Đến · {receiverName}</p>
                  <select
                    value={effectiveToId ?? ''}
                    onChange={(e) => setToAccountId(e.target.value || null)}
                    className="w-full px-3 py-2 rounded-xl text-xs font-bold border bg-white"
                    style={{ borderColor: '#E5EBE8', color: '#18211D' }}
                  >
                    {toAccounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
              </div>
            )
          )}
        </div>

        <div className="flex items-center gap-2 mb-4">
          <input
            type="text"
            placeholder="Ghi chú (tùy chọn)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="flex-1 px-4 py-3 rounded-2xl text-sm border bg-white outline-none"
            style={{ borderColor: '#E5EBE8', color: '#18211D' }}
          />
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="px-3 py-3 rounded-2xl text-xs font-bold border bg-white"
            style={{ borderColor: '#E5EBE8', color: '#18211D' }}
          />
        </div>

        <button
          onClick={handleSettle}
          disabled={saving || amount <= 0}
          className="w-full py-4 rounded-2xl text-lg font-black text-white disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg, #FF8173 0%, #E25749 100%)', boxShadow: 'var(--shadow-glow)' }}
        >
          {saving ? 'Đang lưu…' : settledExactly ? 'Thanh toán đủ' : 'Ghi nhận khoản thanh toán'}
        </button>
      </div>
    </div>
  );
}

function CategorySplitColumn({ name, txs, total, accent, fallbackName, fmt }: { name: string; txs: SharedTx[]; total: number; accent: string; fallbackName: string; fmt: (n: number) => string }) {
  return (
    <div className="flex-1 min-w-0">
      <div className="px-3 py-2 text-center" style={{ background: accent }}>
        <p className="text-[11px] font-black truncate" style={{ color: '#FFFFFF' }}>{name}</p>
        <p className="text-sm font-black tabular-nums" style={{ color: '#FFFFFF' }}>{fmt(total)}</p>
      </div>
      <div className="flex flex-col">
        {txs.length === 0 ? (
          <p className="text-[11px] text-center py-3" style={{ color: '#8C968F' }}>Chưa có khoản nào được thanh toán ở đây</p>
        ) : (
          txs.map((t, i) => (
            <div key={t.id} className="px-3 py-2" style={{ borderTop: i > 0 ? '1px solid #E5EBE8' : 'none' }}>
              <p className="text-[11px] font-semibold truncate" style={{ color: '#18211D' }}>{t.merchant || fallbackName}</p>
              <div className="flex items-center justify-between gap-1">
                <span className="text-[10px]" style={{ color: '#8C968F' }}>{shortDayMonth(t.occurred_on)}</span>
                <span className="text-[11px] font-bold tabular-nums" style={{ color: '#18211D' }}>{fmt(t.amountArs)}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// Double-entry breakdown for one shared category: a column for each person with
// the gastos they fronted, and a reconciliation showing how the per-category net
// (who owes whom) is reached. Opened by tapping a category in the breakdown.
function CategorySplitSheet({
  detail,
  myName,
  partnerName,
  fmt,
  onClose,
}: {
  detail: SharedCatDetail;
  myName: string;
  partnerName: string;
  fmt: (n: number) => string;
  onClose: () => void;
}) {
  const paidByMe = detail.myTxs.reduce((s, t) => s + t.amountArs, 0);
  const paidByPartner = detail.partnerTxs.reduce((s, t) => s + t.amountArs, 0);
  // Each person's fair share of the combined spend. My share = the part of what I
  // paid that's mine (paid − owedToMe) plus the part of the partner's gastos
  // that's mine (iOwe). The two shares always add up to the category total.
  const myShare = paidByMe - detail.owedToMe + detail.iOwe;
  const partnerShare = paidByPartner - detail.iOwe + detail.owedToMe;
  // Net from my perspective: >0 partner owes me, <0 I owe partner.
  const net = Math.round(detail.owedToMe - detail.iOwe);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center animate-in fade-in duration-200" style={{ background: 'rgba(20,28,24,0.45)' }} onClick={onClose}>
      <div
        className="w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl p-6 max-h-[88vh] overflow-y-auto animate-in slide-in-from-bottom-4 sm:zoom-in-95 duration-200"
        style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-pop)', paddingBottom: 'max(24px, env(safe-area-inset-bottom))' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 rounded-full mx-auto mb-4" style={{ background: '#E5EBE8' }} />
        <div className="flex items-center gap-2 mb-1">
          <span className="text-2xl">{detail.icon}</span>
          <h2 className="text-lg font-black flex-1 min-w-0 truncate" style={{ color: '#18211D' }}>{detail.name}</h2>
        </div>
        <p className="text-xs mb-4" style={{ color: '#5B6660' }}>Tổng chi tiêu chung trong tháng này · <strong>{fmt(detail.amount)}</strong></p>

        {/* Double entry — what each person fronted */}
        <p className="text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: '#5B6660' }}>Ai đã trả khoản nào</p>
        <div className="flex rounded-2xl overflow-hidden mb-4" style={{ background: '#F1F5F3', border: '1px solid #E5EBE8' }}>
          <CategorySplitColumn name={myName} txs={detail.myTxs} total={paidByMe} accent="#34AD84" fallbackName={detail.name} fmt={fmt} />
          <div className="w-px" style={{ background: '#E5EBE8' }} />
          <CategorySplitColumn name={partnerName} txs={detail.partnerTxs} total={paidByPartner} accent="#4E84E0" fallbackName={detail.name} fmt={fmt} />
        </div>

        {/* Reconciliation — how the net is reached */}
        <p className="text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: '#5B6660' }}>Phân chia như thế nào</p>
        <div className="rounded-2xl overflow-hidden mb-4" style={{ background: '#F1F5F3' }}>
          {[
            { l: 'Đã trả', a: fmt(paidByMe), b: fmt(paidByPartner) },
            { l: 'Phần của mỗi người', a: fmt(Math.round(myShare)), b: fmt(Math.round(partnerShare)) },
          ].map((r, i) => (
            <div key={r.l} className="grid grid-cols-[1fr_auto_auto] gap-2 px-4 py-2.5 items-center" style={{ borderTop: i > 0 ? '1px solid #E5EBE8' : 'none' }}>
              <span className="text-xs" style={{ color: '#5B6660' }}>{r.l}</span>
              <span className="text-xs font-bold tabular-nums text-right w-20" style={{ color: '#18211D' }}>{r.a}</span>
              <span className="text-xs font-bold tabular-nums text-right w-20" style={{ color: '#18211D' }}>{r.b}</span>
            </div>
          ))}
          <div className="grid grid-cols-[1fr_auto_auto] gap-2 px-4 py-2.5 items-center" style={{ borderTop: '1px solid #E5EBE8', background: '#FFFFFF' }}>
            <span className="text-xs font-bold" style={{ color: '#18211D' }}>Chênh lệch</span>
            <span className="text-xs font-black tabular-nums text-right w-20" style={{ color: net > 0 ? '#1F8A68' : net < 0 ? '#E25749' : '#5B6660' }}>{net >= 0 ? '+' : ''}{fmt(net)}</span>
            <span className="text-xs font-black tabular-nums text-right w-20" style={{ color: net < 0 ? '#1F8A68' : net > 0 ? '#E25749' : '#5B6660' }}>{net <= 0 ? '+' : ''}{fmt(-net)}</span>
          </div>
        </div>

        {/* Plain-language result */}
        <div className="rounded-2xl p-4 text-center" style={{ background: Math.abs(net) < 1 ? '#DDF0E8' : net > 0 ? '#DDF0E8' : '#FFE5E0' }}>
          <p className="text-sm font-black" style={{ color: Math.abs(net) < 1 ? '#1F8A68' : net > 0 ? '#1F8A68' : '#E25749' }}>
            {Math.abs(net) < 1
              ? '🤝 Hai người đã thanh toán đủ trong danh mục này'
              : net > 0
                ? `${partnerName} còn nợ bạn ${fmt(net)} trong danh mục này`
                : `Bạn còn nợ ${fmt(-net)} cho ${partnerName} trong danh mục này`}
          </p>
        </div>
      </div>
    </div>
  );
}

export default function ParejaClient({
  profile,
  partner,
}: {
  profile: Profile;
  partner?: Partner;
}) {
  const supabase = createClient();
  const qc = useQueryClient();
  const { showUSD, arsPerUsd, toggle } = useFx();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fabType, setFabType] = useState<'expense' | 'income' | 'transfer'>('expense');
  const [settleOpen, setSettleOpen] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  // Which shared category's double-entry breakdown is open (its category key).
  const [detailKey, setDetailKey] = useState<string | null>(null);

  const myName = profile.nickname || profile.display_name || 'Bạn';

  const { net, loading: balanceLoading } = useCoupleBalance(
    profile.household_id,
    profile.id,
    partner?.id,
  );

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
      const { data } = await supabase.from('accounts').select('id, name, type, currency, owner_profile_id').eq('household_id', profile.household_id).eq('archived', false).order('name');
      return data ?? [];
    },
  });

  // Household split mode ('equal' = 50/50, 'income' = proportional to incomes).
  const { data: household } = useQuery({
    queryKey: ['household', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('households')
        .select('split_mode')
        .eq('id', profile.household_id)
        .single();
      return data;
    },
  });
  const splitMode: 'equal' | 'income' = household?.split_mode === 'income' ? 'income' : 'equal';

  const splitModeMutation = useMutation({
    mutationFn: async (mode: 'equal' | 'income') => {
      const { error } = await supabase
        .from('households')
        .update({ split_mode: mode })
        .eq('id', profile.household_id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Đã lưu ✓');
      qc.invalidateQueries({ queryKey: ['household', profile.household_id] });
    },
    onError: () => toast.error('Không thể lưu. Hãy thử lại.'),
  });
  // Reflect the tapped option immediately while the update is in flight.
  const activeSplitMode = splitModeMutation.isPending ? splitModeMutation.variables : splitMode;

  // Current month combined transactions
  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;

  // Previous closed calendar month — local date parts, never toISOString.
  const prevMonthStart = toLocalISO(new Date(now.getFullYear(), now.getMonth() - 1, 1));
  const prevMonthEnd = toLocalISO(new Date(now.getFullYear(), now.getMonth(), 0));

  // Last month's incomes, used to compute the income-proportional split.
  const { data: prevIncomes = [] } = useQuery({
    queryKey: ['prev-month-incomes', profile.household_id, prevMonthStart],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('amount, currency, usd_rate_snapshot, profile_id')
        .eq('household_id', profile.household_id)
        .eq('type', 'income')
        .gte('occurred_on', prevMonthStart)
        .lte('occurred_on', prevMonthEnd);
      return data ?? [];
    },
    enabled: activeSplitMode === 'income',
  });

  const { data: txData } = useQuery({
    queryKey: ['couple-transactions', profile.household_id, monthStart],
    queryFn: async () => {
      const { data } = await supabase
        .from('transactions')
        .select('id, merchant, occurred_on, amount, type, currency, scope, profile_id, category_id, is_shared, categories(name, icon), splits(payer_profile_id, ower_profile_id, amount)')
        .eq('household_id', profile.household_id)
        .gte('occurred_on', monthStart)
        .order('occurred_on', { ascending: false });
      return data ?? [];
    },
  });

  const allTx = txData ?? [];
  // Normalize USD→ARS so combined couple totals are in one currency.
  const toArs = (amount: number, currency?: string | null) =>
    currency === 'USD' && arsPerUsd > 0 ? Math.round(amount * arsPerUsd) : amount;
  const expenses = allTx.filter((t) => t.type === 'expense');
  const incomes = allTx.filter((t) => t.type === 'income');
  const totalExpenses = expenses.reduce((s, t) => s + toArs(t.amount, t.currency), 0);
  const totalIncome = incomes.reduce((s, t) => s + toArs(t.amount, t.currency), 0);
  const householdExpenses = expenses.filter((t) => t.scope === 'household').reduce((s, t) => s + toArs(t.amount, t.currency), 0);
  const personalExpenses = expenses.filter((t) => t.scope === 'personal').reduce((s, t) => s + toArs(t.amount, t.currency), 0);
  const sharedExpenses = expenses.filter((t) => t.is_shared).reduce((s, t) => s + toArs(t.amount, t.currency), 0);

  // Category breakdown for shared expenses. `amount` is the full combined spend;
  // `owedToMe`/`iOwe` come from the split rows (ARS) so each category shows who's
  // carrying whose share THIS month — net > 0 means the partner owes me there.
  // `myTxs`/`partnerTxs` keep the individual gastos each person fronted so the
  // detail sheet can show the full double-entry breakdown (who paid what + how the
  // net is reached).
  type SplitRow = { payer_profile_id: string; ower_profile_id: string; amount: number };
  const sharedByCategory: Record<string, SharedCatDetail> = {};
  for (const t of expenses.filter((t) => t.is_shared)) {
    const cat = (t as unknown as { categories: { name: string; icon: string } | null }).categories;
    const key = t.category_id ?? 'sin-categoria';
    if (!sharedByCategory[key]) {
      sharedByCategory[key] = { key, name: cat?.name ?? 'Chưa phân loại', icon: cat?.icon ?? '🏷️', amount: 0, owedToMe: 0, iOwe: 0, myTxs: [], partnerTxs: [] };
    }
    const entry = sharedByCategory[key];
    const amountArs = toArs(t.amount, t.currency);
    entry.amount += amountArs;
    const txRow: SharedTx = { id: t.id, merchant: t.merchant ?? null, occurred_on: t.occurred_on, amountArs };
    if (t.profile_id === profile.id) entry.myTxs.push(txRow);
    else if (partner && t.profile_id === partner.id) entry.partnerTxs.push(txRow);
    const splits = ((t as unknown as { splits: SplitRow[] | null }).splits) ?? [];
    for (const s of splits) {
      if (s.payer_profile_id === profile.id && s.ower_profile_id === partner?.id) entry.owedToMe += s.amount;
      else if (partner && s.payer_profile_id === partner.id && s.ower_profile_id === profile.id) entry.iOwe += s.amount;
    }
  }
  const sharedCats = Object.values(sharedByCategory).sort((a, b) => b.amount - a.amount);

  // Each person's share of last month's income, for the "Según ingresos" split.
  // USD incomes convert at their snapshot rate, falling back to the current blue.
  let myPrevIncome = 0;
  let partnerPrevIncome = 0;
  for (const t of prevIncomes) {
    const ars =
      t.currency === 'USD'
        ? Math.round(t.amount * (Number(t.usd_rate_snapshot) || arsPerUsd))
        : t.amount;
    if (t.profile_id === profile.id) myPrevIncome += ars;
    else if (partner && t.profile_id === partner.id) partnerPrevIncome += ars;
  }
  const totalPrevIncome = myPrevIncome + partnerPrevIncome;
  const myIncomePct = totalPrevIncome > 0 ? Math.round((myPrevIncome / totalPrevIncome) * 100) : 50;
  const partnerIncomePct = 100 - myIncomePct;

  const absNet = Math.abs(net);
  // Splits are rounded ARS, so treat sub-peso residue as settled.
  const balanced = absNet < 1;
  const partnerOwesMe = !balanced && net > 0;
  const iOwePartner = !balanced && net < 0;

  const f = (n: number) =>
    showUSD && arsPerUsd > 0
      ? `US$${Math.round(n / arsPerUsd).toLocaleString('vi-VN')}`
      : formatARS(n);

  return (
    <div className="min-h-screen pb-24" style={{ background: '#F1F5F3' }}>
      <header className="flex items-center gap-3 px-5 pt-14 pb-4">
        <Link href="/mas" style={{ color: '#5B6660', fontSize: 22 }}>←</Link>
        <div className="flex-1">
          <h1 className="text-2xl font-black" style={{ color: '#18211D' }}>Chế độ xem cặp đôi</h1>
          {partner && <p className="text-xs" style={{ color: '#5B6660' }}>{myName} & {partner.name}</p>}
        </div>
        <button
          onClick={toggle}
          className="text-sm font-bold px-3 py-1.5 rounded-full border"
          style={{ borderColor: '#2FA37C', color: '#2FA37C' }}
        >
          {showUSD ? 'USD' : 'ARS'}
        </button>
      </header>

      {/* Combined summary */}
      <div className="mx-4 rounded-3xl p-5 mb-4 shadow-sm" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
        <p className="text-xs font-bold uppercase tracking-wide mb-3" style={{ color: '#5B6660' }}>
          Tóm tắt tháng
        </p>
        <div className="flex gap-4">
          <div className="flex-1 rounded-2xl p-3" style={{ background: '#DDF0E8' }}>
            <p className="text-[11px] font-black uppercase mb-1" style={{ color: '#1F8A68' }}>Thu nhập</p>
            <p className="text-lg font-black" style={{ color: '#1F8A68', fontVariantNumeric: 'tabular-nums' }}>{f(totalIncome)}</p>
          </div>
          <div className="flex-1 rounded-2xl p-3" style={{ background: '#FFE5E0' }}>
            <p className="text-[10px] font-bold uppercase mb-1" style={{ color: '#E25749' }}>Chi tiêu</p>
            <p className="text-lg font-black" style={{ color: '#E25749', fontVariantNumeric: 'tabular-nums' }}>{f(totalExpenses)}</p>
          </div>
        </div>

        {/* Household vs personal */}
        <div className="mt-4 pt-4" style={{ borderTop: '1px solid #E5EBE8' }}>
          <div className="flex justify-between mb-2">
            <p className="text-xs" style={{ color: '#5B6660' }}>🏠 Hộ gia đình</p>
            <p className="text-xs font-bold" style={{ color: '#18211D' }}>{f(householdExpenses)}</p>
          </div>
          <div className="flex justify-between">
            <p className="text-xs" style={{ color: '#5B6660' }}>👤 Cá nhân</p>
            <p className="text-xs font-bold" style={{ color: '#18211D' }}>{f(personalExpenses)}</p>
          </div>
        </div>
      </div>

      {/* Who owes whom */}
      {!partner ? (
        <div className="mx-4 rounded-3xl p-5 mb-4 text-center" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
          <p className="text-3xl mb-2">👫</p>
          <p className="text-sm font-bold" style={{ color: '#18211D' }}>Chưa có người bạn đời nào liên kết với hộ gia đình</p>
          <p className="text-sm mt-1 mb-4" style={{ color: '#5B6660' }}>
            Mời người bạn đời để cùng xem và chia sẻ chi phí.
          </p>
          <button
            onClick={() => setInviteOpen(true)}
            className="px-5 py-3 rounded-2xl text-sm font-black text-white transition-transform hover:-translate-y-0.5"
            style={{ background: 'linear-gradient(135deg, #34AD84 0%, #1F8A68 100%)', boxShadow: 'var(--shadow-glow)' }}
          >
            💌 Mời người bạn đời
          </button>
        </div>
      ) : (
        <div
          className="mx-4 rounded-3xl overflow-hidden mb-4"
          style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-pop)' }}
        >
          <div
            className="relative px-5 pt-5 pb-5 overflow-hidden"
            style={{
              background: iOwePartner
                ? 'linear-gradient(135deg, #FF8173 0%, #E25749 100%)'
                : 'linear-gradient(135deg, #34AD84 0%, #1F8A68 100%)',
            }}
          >
            <div className="absolute -top-10 -right-8 w-40 h-40 rounded-full pointer-events-none" style={{ background: 'rgba(255,255,255,0.14)' }} />
            <p className="relative text-[11px] font-black uppercase tracking-widest" style={{ color: 'rgba(255,255,255,0.82)' }}>
              Ai đang nợ ai
            </p>

            {balanceLoading ? (
              <p className="relative text-sm mt-2" style={{ color: 'rgba(255,255,255,0.85)' }}>Đang tính…</p>
            ) : balanced ? (
              <div className="relative mt-2">
                <p className="text-3xl mb-1">🤝</p>
                <p className="text-[2.4rem] leading-none font-black tracking-tight" style={{ color: '#FFFFFF' }}>Đã cân bằng!</p>
                <p className="text-[11px] mt-2" style={{ color: 'rgba(255,255,255,0.85)' }}>Không còn khoản nợ nào giữa hai người.</p>
              </div>
            ) : (
              <div className="relative mt-2">
                <p className="text-[11px]" style={{ color: 'rgba(255,255,255,0.85)' }}>
                  {partnerOwesMe ? `${partner.name} còn nợ bạn` : `Bạn còn nợ ${partner.name}`}
                </p>
                <p
                  className="text-[2.4rem] leading-none font-black mt-1 tracking-tight"
                  style={{ color: '#FFFFFF', fontVariantNumeric: 'tabular-nums' }}
                >
                  {f(absNet)}
                </p>
              </div>
            )}
          </div>

          {!balanceLoading && !balanced && (
            <div className="px-4 py-4">
              <div className="flex items-center gap-3">
                <p className="flex-1 text-xs" style={{ color: partnerOwesMe ? '#1F8A68' : '#E25749' }}>
                  {partnerOwesMe
                    ? `Bạn đã trả các chi phí chung mà ${partner.name} chưa hoàn lại.`
                    : `${partner.name} đã trả các chi phí chung mà bạn chưa hoàn lại.`}
                </p>
                <button
                  onClick={() => setSettleOpen(true)}
                  className="px-4 py-2.5 rounded-2xl text-sm font-black text-white transition-transform hover:-translate-y-0.5"
                  style={{ background: 'linear-gradient(135deg, #FF8173 0%, #E25749 100%)', boxShadow: 'var(--shadow-glow)' }}
                >
                  Thanh toán đủ
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Default split for new household expenses */}
      {partner && (
        <div className="mx-4 rounded-3xl p-5 mb-4 shadow-sm" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
          <p className="text-sm font-bold mb-3" style={{ color: '#18211D' }}>
            ⚖️ Hai người muốn chia chi phí hộ gia đình như thế nào?
          </p>
          <div className="flex rounded-2xl overflow-hidden p-1 gap-1 mb-3" style={{ background: '#E5EBE8' }}>
            {([
              { key: 'equal', label: '50/50' },
              { key: 'income', label: 'Theo thu nhập' },
            ] as const).map((o) => {
              const active = activeSplitMode === o.key;
              return (
                <button
                  key={o.key}
                  onClick={() => {
                    if (!active && !splitModeMutation.isPending) splitModeMutation.mutate(o.key);
                  }}
                  className="flex-1 py-2 text-xs font-black rounded-xl transition-all"
                  style={{ background: active ? '#FFFFFF' : 'transparent', color: active ? '#18211D' : '#5B6660', boxShadow: active ? 'var(--shadow-soft)' : 'none' }}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
          {activeSplitMode === 'income' &&
            (totalPrevIncome > 0 ? (
              <p className="text-xs font-bold mb-2" style={{ color: '#18211D' }}>
                Tháng này: {myName} {myIncomePct}% · {partner.name} {partnerIncomePct}%
              </p>
            ) : (
              <p className="text-xs mb-2" style={{ color: '#5B6660', opacity: 0.7 }}>
                Không có thu nhập tháng trước — sử dụng tỷ lệ 50/50
              </p>
            ))}
          <p className="text-[11px]" style={{ color: '#5B6660' }}>
            Áp dụng làm cách chia gợi ý cho các chi phí hộ gia đình mới và chi phí cố định.
          </p>
        </div>
      )}

      {/* Shared category breakdown */}
      {sharedCats.length > 0 && (
        <div className="mx-4 rounded-3xl p-5 mb-4 shadow-sm" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
          <p className="text-xs font-bold uppercase tracking-wide mb-0.5" style={{ color: '#5B6660' }}>
            Chi phí chung theo danh mục
          </p>
          <p className="text-[11px] mb-3" style={{ color: '#8C968F' }}>
            Chạm vào một danh mục để xem ai đã trả gì và cách chia.
          </p>
          <div className="flex flex-col gap-2">
            {sharedCats.map((cat) => {
              const pct = sharedExpenses > 0 ? cat.amount / sharedExpenses : 0;
              // Net of this month's split rows for the category: who's owed what.
              const net = Math.round(cat.owedToMe - cat.iOwe);
              return (
                <button
                  key={cat.key}
                  onClick={() => setDetailKey(cat.key)}
                  className="text-left w-full -mx-1 px-1 py-1 rounded-xl transition-colors active:bg-[#F1F5F3]"
                >
                  <div className="flex items-center justify-between mb-1">
                    <div className="flex items-center gap-2">
                      <span>{cat.icon}</span>
                      <p className="text-sm font-semibold" style={{ color: '#18211D' }}>{cat.name}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      <p className="text-sm font-bold" style={{ color: '#18211D' }}>{f(cat.amount)}</p>
                      <span className="text-xs" style={{ color: '#B0BAB4' }}>›</span>
                    </div>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#E5EBE8' }}>
                    <div
                      className="h-full rounded-full"
                      style={{ background: '#2FA37C', width: `${Math.min(pct * 100, 100)}%` }}
                    />
                  </div>
                  {partner && Math.abs(net) >= 1 && (
                    <p className="text-[11px] mt-1" style={{ color: net > 0 ? '#1F8A68' : '#E25749' }}>
                      {net > 0
                        ? `${partner.name} còn nợ bạn ${f(net)} trong danh mục này`
                        : `Bạn còn nợ ${f(-net)} cho ${partner.name} trong danh mục này`}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
          <p className="text-xs mt-3" style={{ color: '#5B6660' }}>
            Tổng chi phí chung trong tháng này: <strong>{f(sharedExpenses)}</strong>
          </p>
        </div>
      )}

      <BottomNav onFab={(type) => { setFabType(type); setSheetOpen(true); }} />

      <AddTransactionSheet
        open={sheetOpen}
        initialType={fabType}
        onClose={() => setSheetOpen(false)}
        householdId={profile.household_id}
        profileId={profile.id}
        partnerProfileId={partner?.id}
        categories={categories}
        accounts={accounts}
      />

      {partner && (
        <SettleUpSheet
          key={`${settleOpen ? 'open' : 'closed'}-${net}`}
          open={settleOpen}
          onClose={() => setSettleOpen(false)}
          net={net}
          myName={myName}
          partnerName={partner.name}
          householdId={profile.household_id}
          myProfileId={profile.id}
          partnerProfileId={partner.id}
          accounts={accounts}
          fmt={f}
        />
      )}

      <InvitePartnerModal open={inviteOpen} onClose={() => setInviteOpen(false)} />

      {partner && detailKey && sharedByCategory[detailKey] && (
        <CategorySplitSheet
          detail={sharedByCategory[detailKey]}
          myName={myName}
          partnerName={partner.name}
          fmt={f}
          onClose={() => setDetailKey(null)}
        />
      )}
    </div>
  );
}
