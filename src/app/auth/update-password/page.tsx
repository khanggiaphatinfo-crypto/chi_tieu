'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase';
import { toast } from 'sonner';

export default function UpdatePasswordPage() {
  const router = useRouter();
  const supabase = createClient();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [checkingSession, setCheckingSession] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) setCheckingSession(false);
      if (!cancelled && !data.session) {
        toast.error('Liên kết đổi mật khẩu không hợp lệ hoặc đã hết hạn.');
        router.replace('/auth');
      }
    });
    return () => { cancelled = true; };
  }, [router, supabase.auth]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) {
      toast.error('Mật khẩu phải có ít nhất 6 ký tự.');
      return;
    }
    if (password !== confirmation) {
      toast.error('Hai mật khẩu không khớp.');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        toast.error('Không thể cập nhật mật khẩu. Hãy yêu cầu liên kết mới.');
        return;
      }
      toast.success('Đã cập nhật mật khẩu.');
      router.replace('/presupuestos');
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ background: '#F1F5F3' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-5xl mb-3">🔐</div>
          <h1 className="text-2xl font-black" style={{ color: '#18211D' }}>Đặt mật khẩu mới</h1>
          <p className="text-sm mt-2" style={{ color: '#5B6660' }}>Chọn một mật khẩu mới cho tài khoản của bạn.</p>
        </div>

        {checkingSession ? (
          <p className="text-center text-sm" style={{ color: '#5B6660' }}>Đang kiểm tra liên kết…</p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <label className="text-sm font-semibold" style={{ color: '#18211D' }}>
              Mật khẩu mới
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Tối thiểu 6 ký tự"
                autoComplete="new-password"
                required
                className="mt-1.5 w-full px-4 py-3 rounded-2xl text-base outline-none border"
                style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)', borderColor: '#E5EBE8', color: '#18211D' }}
              />
            </label>
            <label className="text-sm font-semibold" style={{ color: '#18211D' }}>
              Nhập lại mật khẩu
              <input
                type="password"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                placeholder="Nhập lại mật khẩu mới"
                autoComplete="new-password"
                required
                className="mt-1.5 w-full px-4 py-3 rounded-2xl text-base outline-none border"
                style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)', borderColor: '#E5EBE8', color: '#18211D' }}
              />
            </label>
            <button
              type="submit"
              disabled={saving}
              className="w-full py-4 rounded-2xl text-base font-bold text-white disabled:opacity-50"
              style={{ background: '#2FA37C' }}
            >
              {saving ? 'Đang lưu…' : 'Cập nhật mật khẩu'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
