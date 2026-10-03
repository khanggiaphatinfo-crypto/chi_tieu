'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

type Mode = 'login' | 'signup' | 'reset';

export default function AuthPage() {
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      if (mode === 'reset') {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/callback`,
        });
        if (error) { toast.error(error.message); return; }
        toast.success('Đã gửi liên kết đổi mật khẩu. Hãy kiểm tra email của bạn.');
        setMode('login');
        return;
      }

      if (password.length < 6) {
        toast.error('Mật khẩu phải có ít nhất 6 ký tự.');
        return;
      }

      if (mode === 'login') {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) {
          toast.error('Email hoặc mật khẩu không đúng.');
          return;
        }
        router.push('/presupuestos');
        router.refresh();
      } else {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) { toast.error(error.message); return; }
        // Auto-login (works when email confirmation is disabled in Supabase)
        const { error: loginErr } = await supabase.auth.signInWithPassword({ email, password });
        if (!loginErr) {
          router.push('/presupuestos');
          router.refresh();
        } else {
          toast.success('Tạo tài khoản thành công! Hãy đăng nhập bằng email và mật khẩu.');
          setMode('login');
        }
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ background: '#F1F5F3' }}>
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="text-5xl mb-3">💚</div>
          <h1 className="text-4xl font-black tracking-tight" style={{ color: '#18211D' }}>Morchis</h1>
          <p className="text-base mt-1" style={{ color: '#5B6660' }}>Tiền của chúng ta, cùng nhau</p>
        </div>

        {/* Mode toggle (only login/signup) */}
        {mode !== 'reset' && (
          <div className="flex mb-6 rounded-2xl p-1" style={{ background: '#E5EBE8' }}>
            {(['login', 'signup'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className="flex-1 py-2.5 text-sm font-bold rounded-xl transition-colors"
                style={{
                  background: mode === m ? '#FFFFFF' : 'transparent',
                  color: mode === m ? '#18211D' : '#5B6660',
                }}
              >
                {m === 'login' ? 'Đăng nhập' : 'Tạo tài khoản'}
              </button>
            ))}
          </div>
        )}
        {mode === 'reset' && (
          <p className="text-base font-bold mb-6" style={{ color: '#18211D' }}>Khôi phục mật khẩu</p>
        )}

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div>
            <label className="block text-sm font-semibold mb-1.5" style={{ color: '#18211D' }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tên@ví dụ.com"
              required
              autoComplete="email"
              className="w-full px-4 py-3 rounded-2xl text-base outline-none border"
              style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)', borderColor: '#E5EBE8', color: '#18211D' }}
              onFocus={(e) => (e.target.style.borderColor = '#2FA37C')}
              onBlur={(e) => (e.target.style.borderColor = '#E5EBE8')}
            />
          </div>

          {mode !== 'reset' && (
            <div>
              <label className="block text-sm font-semibold mb-1.5" style={{ color: '#18211D' }}>Mật khẩu</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Tối thiểu 6 ký tự"
                required
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                className="w-full px-4 py-3 rounded-2xl text-base outline-none border"
                style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)', borderColor: '#E5EBE8', color: '#18211D' }}
                onFocus={(e) => (e.target.style.borderColor = '#2FA37C')}
                onBlur={(e) => (e.target.style.borderColor = '#E5EBE8')}
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading || !email || (mode !== 'reset' && !password)}
            className="w-full py-4 rounded-2xl text-base font-bold text-white transition-opacity disabled:opacity-50 mt-2"
            style={{ background: '#2FA37C' }}
          >
            {loading ? '…' : mode === 'login' ? 'Đăng nhập' : mode === 'signup' ? 'Tạo tài khoản' : 'Gửi liên kết'}
          </button>
        </form>

        {mode === 'login' && (
          <button
            onClick={() => setMode('reset')}
            className="block text-center text-xs mt-4 underline w-full"
            style={{ color: '#5B6660' }}
          >
            Quên mật khẩu
          </button>
        )}
        {mode === 'reset' && (
          <button
            onClick={() => setMode('login')}
            className="block text-center text-xs mt-4 underline w-full"
            style={{ color: '#5B6660' }}
          >
            ← Quay lại đăng nhập
          </button>
        )}

        <p className="text-center text-xs mt-6" style={{ color: '#5B6660' }}>
          Phiên đăng nhập của bạn sẽ được duy trì. Bạn sẽ không phải đăng nhập lại.
        </p>
      </div>
    </div>
  );
}
