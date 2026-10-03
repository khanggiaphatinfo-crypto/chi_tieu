'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

type Step = 'choose' | 'create' | 'join' | 'profile';

export default function HouseholdPage() {
  const [step, setStep] = useState<Step>('choose');
  const [householdName, setHouseholdName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [nickname, setNickname] = useState('');
  const [loading, setLoading] = useState(false);
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const router = useRouter();
  const supabase = createClient();

  async function createHousehold() {
    setLoading(true);
    try {
// Dùng RPC SECURITY DEFINER để tránh vòng lặp phụ thuộc RLS trên households
      const { data, error } = await supabase.rpc('create_household', {
        household_name: householdName || 'Nuestro hogar',
      });
      if (error) throw error;
      setHouseholdId(data as string);
      setStep('profile');
    } catch (err: unknown) {
      console.error(err);
      toast.error('Không thể tạo hộ gia đình. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  }

  async function joinHousehold() {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('join_household', {
        invite_code: joinCode.toUpperCase().trim(),
      });
      if (error) {
        if (error.message?.includes('invalid_or_expired_code')) {
          toast.error('Mã không hợp lệ hoặc đã hết hạn. Hãy xin mã mới từ người đồng hành.');
        } else {
          throw error;
        }
        return;
      }
      setHouseholdId(data as string);
      setStep('profile');
    } catch (err: unknown) {
      console.error(err);
      toast.error('Đã xảy ra lỗi. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  }

  async function saveProfile() {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Chưa đăng nhập');
      const { error } = await supabase
        .from('profiles')
        .update({ nickname: nickname.trim() || 'Morch' })
        .eq('id', user.id);
      if (error) throw error;
      router.push('/onboarding');
    } catch (err: unknown) {
      console.error(err);
      toast.error('Không thể lưu. Vui lòng thử lại.');
    } finally {
      setLoading(false);
    }
  }

// ── CHỌN ─────────────────────────────────────────────────────────────────
  if (step === 'choose') {
    return (
      <Screen>
        <div className="text-center mb-10">
          <div className="text-5xl mb-3">🏡</div>
          <h1 className="text-2xl font-black" style={{ color: '#18211D' }}>
            ¿Chúng ta bắt đầu thế nào?
          </h1>
        </div>
        <div className="flex flex-col gap-3">
          <Btn onClick={() => setStep('create')}>Tạo hộ gia đình mới</Btn>
          <Btn variant="outline" onClick={() => setStep('join')}>Tham gia bằng mã</Btn>
        </div>
      </Screen>
    );
  }

// ── TẠO ──────────────────────────────────────────────────────────────────
  if (step === 'create') {
    return (
      <Screen>
        <BackBtn onClick={() => setStep('choose')} />
        <h1 className="text-2xl font-black mb-6" style={{ color: '#18211D' }}>Tạo hộ gia đình</h1>
        <div className="mb-4">
          <label className="block text-sm font-semibold mb-2" style={{ color: '#18211D' }}>
            Tên hộ gia đình (không bắt buộc)
          </label>
          <TextInput
            value={householdName}
            onChange={setHouseholdName}
            placeholder="Ví dụ: Lucas và Sofi 💚"
          />
        </div>
        <Btn onClick={createHousehold} disabled={loading}>
          {loading ? 'Đang tạo...' : 'Tạo hộ gia đình'}
        </Btn>
      </Screen>
    );
  }

// ── THAM GIA ────────────────────────────────────────────────────────────────────
  if (step === 'join') {
    return (
      <Screen>
        <BackBtn onClick={() => setStep('choose')} />
        <h1 className="text-2xl font-black mb-2" style={{ color: '#18211D' }}>Tham gia hộ gia đình</h1>
        <p className="text-sm mb-6" style={{ color: '#5B6660' }}>
          Hãy xin mã gồm 6 ký tự từ người đồng hành trong ứng dụng.
        </p>
        <div className="mb-4">
          <input
            type="text"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
            placeholder="ABC123"
            maxLength={6}
            className="w-full px-4 py-3 rounded-2xl text-2xl font-black text-center tracking-widest outline-none border"
            style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)', borderColor: '#E5EBE8', color: '#18211D' }}
          />
        </div>
        <Btn onClick={joinHousehold} disabled={loading || joinCode.length < 6}>
          {loading ? 'Đang kiểm tra...' : 'Tham gia'}
        </Btn>
      </Screen>
    );
  }

// ── HỒ SƠ ─────────────────────────────────────────────────────────────────
  return (
    <Screen>
      <div className="text-center mb-8">
        <div className="text-5xl mb-3">✨</div>
        <h1 className="text-2xl font-black" style={{ color: '#18211D' }}>¿Bạn muốn chúng tôi gọi bạn là gì?</h1>
        <p className="text-sm mt-1" style={{ color: '#5B6660' }}>Chúng tôi sẽ dùng biệt danh của bạn trong ứng dụng.</p>
      </div>
      <div className="mb-4">
        <TextInput
          value={nickname}
          onChange={setNickname}
          placeholder="Ví dụ: Morch, Lucas, Sofi..."
          center
        />
      </div>

{/* Phần mã mời — chỉ hiển thị nếu người dùng vừa TẠO hộ gia đình */}
      {householdId && <InviteCodeSection householdId={householdId} />}

      <Btn onClick={saveProfile} disabled={loading}>
        {loading ? 'Đang lưu...' : 'Xong, vào ứng dụng ✓'}
      </Btn>
    </Screen>
  );
}

// ── Thành phần phụ ─────────────────────────────────────────────────────────

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ background: '#F1F5F3' }}>
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

function Btn({
  children, onClick, disabled, variant = 'primary',
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'outline';
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="w-full py-4 rounded-2xl text-base font-bold transition-opacity disabled:opacity-50"
      style={
        variant === 'primary'
          ? { background: '#2FA37C', color: '#fff' }
          : { background: 'transparent', color: '#2FA37C', border: '2px solid #2FA37C' }
      }
    >
      {children}
    </button>
  );
}

function BackBtn({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="mb-6 text-sm" style={{ color: '#5B6660' }}>
      ← Quay lại
    </button>
  );
}

function TextInput({
  value, onChange, placeholder, center,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  center?: boolean;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-4 py-3 rounded-2xl text-base outline-none border"
      style={{
        background: '#FFFFFF', boxShadow: 'var(--shadow-card)',
        borderColor: '#E5EBE8',
        color: '#18211D',
        textAlign: center ? 'center' : 'left',
      }}
    />
  );
}

function InviteCodeSection({ householdId }: { householdId: string }) {
  const [code, setCode] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const supabase = createClient();

  async function generateCode() {
    setLoading(true);
    const { data, error } = await supabase.rpc('generate_invite_code');
    if (!error && data) setCode(data as string);
    else toast.error('Không thể tạo mã.');
    setLoading(false);
  }

// tránh cảnh báo unused — householdId được dùng ngầm qua RPC
  void householdId;

  return (
    <div className="rounded-2xl p-4 mb-4" style={{ background: '#DDF0E8' }}>
      <p className="text-sm font-semibold mb-2" style={{ color: '#18211D' }}>
        Mời người đồng hành của bạn 💌
      </p>
      {code ? (
        <div className="text-center">
          <div className="text-3xl font-black tracking-widest mb-1" style={{ color: '#1F8A68' }}>
            {code}
          </div>
          <p className="text-xs" style={{ color: '#5B6660' }}>
            Hãy nhập mã trong mục “Tham gia bằng mã”. Mã có hiệu lực trong 7 ngày.
          </p>
        </div>
      ) : (
        <button
          onClick={generateCode}
          disabled={loading}
          className="text-sm font-bold underline disabled:opacity-50"
          style={{ color: '#1F8A68' }}
        >
          {loading ? 'Đang tạo...' : 'Tạo mã mời'}
        </button>
      )}
    </div>
  );
}
