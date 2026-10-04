'use client';

import { useState, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { BottomNav } from '@/components/BottomNav';
import { AddTransactionSheet } from '@/components/AddTransactionSheet';
import { toast } from 'sonner';

interface Profile {
  id: string;
  household_id: string;
  nickname: string | null;
  display_name: string | null;
}

interface Account {
  id: string;
  name: string;
  type: string;
}

interface Statement {
  id: string;
  status: string;
  created_at: string;
  account_id: string | null;
  file_path: string | null;
}

const STATUS_LABELS: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  uploaded: { label: 'Đã tải lên', color: '#5B6660', bg: '#E5EBE8', icon: '📄' },
  parsing: { label: 'Đang phân tích…', color: '#1F8A68', bg: '#DDF0E8', icon: '⚙️' },
  parsed: { label: 'Sẵn sàng', color: '#1F8A68', bg: '#DDF0E8', icon: '✅' },
  failed: { label: 'Lỗi', color: '#E25749', bg: '#FFE5E0', icon: '⚠️' },
};

export default function ExtractosClient({
  profile,
  accounts,
}: {
  profile: Profile;
  accounts: Account[];
}) {
  const supabase = createClient();
  const router = useRouter();
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [fabType, setFabType] = useState<'expense' | 'income' | 'transfer'>('expense');
  const [uploading, setUploading] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string>(accounts[0]?.id ?? '');

  const { data: statements = [] } = useQuery<Statement[]>({
    queryKey: ['statements', profile.household_id],
    queryFn: async () => {
      const { data } = await supabase
        .from('statements')
        .select('id, status, created_at, account_id, file_path')
        .eq('household_id', profile.household_id)
        .order('created_at', { ascending: false })
        .limit(20);
      return (data ?? []) as Statement[];
    },
    refetchInterval: (query) => {
      // Poll while any statement is parsing
      const data = query.state.data ?? [];
      return data.some((s: Statement) => s.status === 'parsing') ? 3000 : false;
    },
  });

  async function handleFileSelect(file: File) {
    if (!file) return;
    setUploading(true);
    try {
      const ext = file.name.split('.').pop() ?? 'pdf';
      const statementId = crypto.randomUUID();
      const filePath = `${profile.household_id}/${statementId}.${ext}`;

      // Upload to storage
      const { error: uploadErr } = await supabase.storage
        .from('statements')
        .upload(filePath, file, { contentType: file.type, upsert: false });

      if (uploadErr) throw uploadErr;

      // Create statement record
      const { error: insertErr } = await supabase.from('statements').insert({
        id: statementId,
        household_id: profile.household_id,
        profile_id: profile.id,
        account_id: selectedAccountId || null,
        file_path: filePath,
        status: 'uploaded',
      });

      if (insertErr) throw insertErr;

      // Trigger parse-statement edge function
      const { data: { session } } = await supabase.auth.getSession();
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/parse-statement`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: JSON.stringify({ statement_id: statementId }),
        },
      );

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error ?? 'Lỗi khi phân tích');
      }

      await qc.invalidateQueries({ queryKey: ['statements'] });
      toast.success('Đã tải sao kê — đang phân tích bằng AI…');
      router.push(`/extractos/${statementId}`);
    } catch {
      toast.error('Không thể tải lên hoặc phân tích sao kê. Hãy thử lại.');
    } finally {
      setUploading(false);
    }
  }

  function fmtDate(d: string) {
    return new Date(d).toLocaleDateString('vi-VN', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  }

  return (
    <div className="min-h-screen pb-24" style={{ background: '#F1F5F3' }}>
      <header className="px-5 pt-14 pb-4">
        <h1 className="text-2xl font-black" style={{ color: '#18211D' }}>Sao kê</h1>
        <p className="text-xs mt-0.5" style={{ color: '#5B6660' }}>Tải lên sao kê để nhập giao dịch — PDF, ảnh hoặc CSV (ví dụ: hoạt động Mercado Pago)</p>
      </header>

      {/* Upload card */}
      <div className="mx-4 mb-4 rounded-3xl p-5" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
        {accounts.length > 0 && (
          <div className="mb-4">
            <p className="text-[11px] font-black uppercase tracking-wide mb-1.5" style={{ color: '#8C968F' }}>Tài khoản</p>
            <div className="flex gap-2 flex-wrap">
              {accounts.map((acc) => (
                <button
                  key={acc.id}
                  onClick={() => setSelectedAccountId(acc.id)}
                  className="px-3.5 py-2 rounded-full text-xs font-bold border transition-all"
                  style={{
                    background: selectedAccountId === acc.id ? '#18211D' : 'transparent',
                    borderColor: selectedAccountId === acc.id ? '#18211D' : '#E5EBE8',
                    color: selectedAccountId === acc.id ? '#FFFFFF' : '#5B6660',
                    boxShadow: selectedAccountId === acc.id ? 'var(--shadow-soft)' : 'none',
                  }}
                >
                  {acc.name}
                </button>
              ))}
            </div>
          </div>
        )}

        <input
          ref={fileInputRef}
          type="file"
          accept="application/pdf,image/jpeg,image/png,image/heic,image/webp,text/csv,.csv"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFileSelect(f);
            e.target.value = '';
          }}
        />

        <div className="flex gap-3">
          <button
            onClick={() => {
              if (fileInputRef.current) {
                fileInputRef.current.removeAttribute('capture');
                fileInputRef.current.click();
              }
            }}
            disabled={uploading}
            className="flex-1 py-3.5 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 transition-all"
            style={{ background: '#DDF0E8', color: '#1F8A68', boxShadow: 'var(--shadow-soft)' }}
          >
            📄 Tải tệp lên
          </button>
          <button
            onClick={() => {
              if (fileInputRef.current) {
                fileInputRef.current.setAttribute('capture', 'environment');
                fileInputRef.current.click();
              }
            }}
            disabled={uploading}
            className="flex-1 py-3.5 rounded-2xl text-sm font-bold flex items-center justify-center gap-2 transition-all"
            style={{ background: 'linear-gradient(135deg, #FF8173 0%, #E25749 100%)', color: '#FFFFFF', boxShadow: 'var(--shadow-glow)' }}
          >
            📷 Chụp ảnh
          </button>
        </div>

        {uploading && (
          <p className="text-xs text-center mt-3 font-semibold" style={{ color: '#2FA37C' }}>
            Đang tải lên và phân tích bằng AI…
          </p>
        )}
      </div>

      {/* Statement history */}
      {statements.length > 0 && (
        <div className="px-4">
          <p className="text-sm font-black mb-3" style={{ color: '#18211D' }}>Lịch sử</p>
          <div className="rounded-3xl overflow-hidden" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
            {statements.map((s, i) => {
              const badge = STATUS_LABELS[s.status] ?? STATUS_LABELS.uploaded;
              return (
                <button
                  key={s.id}
                  onClick={() => router.push(`/extractos/${s.id}`)}
                  className="w-full flex items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-[#F4F8F6] active:bg-[#EEF3F1]"
                  style={{ borderTop: i > 0 ? '1px solid #E5EBE8' : 'none' }}
                >
                  <span
                    className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0"
                    style={{ background: badge.bg }}
                  >
                    <span className={s.status === 'parsing' ? 'animate-spin' : ''}>{badge.icon}</span>
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate" style={{ color: '#18211D' }}>
                      {accounts.find((a) => a.id === s.account_id)?.name ?? 'Không có tài khoản'}
                    </p>
                    <p className="text-xs mt-0.5" style={{ color: '#5B6660' }}>
                      {fmtDate(s.created_at)}
                    </p>
                  </div>
                  <span
                    className="text-[11px] font-bold px-2.5 py-1 rounded-full shrink-0"
                    style={{ background: badge.bg, color: badge.color }}
                  >
                    {badge.label}
                  </span>
                  <span className="text-base shrink-0" style={{ color: '#B0BAB4' }}>›</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {statements.length === 0 && !uploading && (
        <div className="text-center py-16 px-8">
          <p className="text-5xl mb-4">🧾</p>
          <p className="text-base font-bold" style={{ color: '#18211D' }}>Chưa có sao kê nào</p>
          <p className="text-sm mt-2" style={{ color: '#5B6660' }}>
            Tải lên sao kê dưới dạng PDF, ảnh hoặc CSV (ví dụ: hoạt động Mercado Pago) — AI sẽ trích xuất tất cả giao dịch để bạn kiểm tra.
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
        categories={[]}
        accounts={accounts}
      />
    </div>
  );
}
