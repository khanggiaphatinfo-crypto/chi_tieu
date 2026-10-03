'use client';

import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { createClient } from '@/lib/supabase';

type Profile = {
  id: string;
  household_id: string;
  nickname: string | null;
  display_name: string | null;
};

type Household = {
  id: string;
  name: string;
};

export default function PerfilClient({
  profile,
  household,
}: {
  profile: Profile;
  household: Household;
}) {
  const supabase = createClient();
  const [nickname, setNickname] = useState(profile.nickname ?? '');
  const [householdName, setHouseholdName] = useState(household.name);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingHousehold, setSavingHousehold] = useState(false);

  async function saveProfile() {
    setSavingProfile(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ nickname: nickname === '' ? null : nickname })
        .eq('id', profile.id);
      if (error) throw error;
      toast.success('Hồ sơ đã được lưu');
    } catch (error) {
      console.error(error);
      toast.error('Không thể lưu hồ sơ. Hãy thử lại.');
    } finally {
      setSavingProfile(false);
    }
  }

  async function saveHousehold() {
    if (householdName.trim() === '') {
      toast.error('Nhập tên hộ gia đình.');
      return;
    }

    setSavingHousehold(true);
    try {
      const { error } = await supabase
        .from('households')
        .update({ name: householdName })
        .eq('id', household.id);
      if (error) throw error;
      toast.success('Tên hộ gia đình đã được lưu');
    } catch (error) {
      console.error(error);
      toast.error('Không thể lưu tên hộ gia đình. Hãy thử lại.');
    } finally {
      setSavingHousehold(false);
    }
  }

  return (
    <div className="min-h-screen pb-24" style={{ background: '#F1F5F3' }}>
      <header className="px-5 pt-14 pb-4 flex items-center gap-3">
        <Link href="/mas" className="text-2xl" aria-label="Quay lại">←</Link>
        <h1 className="text-2xl font-black" style={{ color: '#18211D' }}>Hồ sơ & hộ gia đình</h1>
      </header>

      <main className="px-4 flex flex-col gap-4">
        <section className="rounded-3xl p-5" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
          <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: '#5B6660' }}>
            Hồ sơ của bạn
          </p>
          <p className="text-sm mb-4" style={{ color: '#5B6660' }}>
            Tên này được hiển thị trong ứng dụng và với người trong hộ gia đình.
          </p>
          <label htmlFor="nickname" className="block text-sm font-bold mb-2" style={{ color: '#18211D' }}>
            Biệt danh
          </label>
          <input
            id="nickname"
            type="text"
            value={nickname}
            onChange={(event) => setNickname(event.target.value)}
            className="w-full px-4 py-3 rounded-2xl text-base outline-none border"
            style={{ background: '#FFFFFF', borderColor: '#E5EBE8', color: '#18211D' }}
          />
          <button
            type="button"
            onClick={saveProfile}
            disabled={savingProfile}
            className="w-full mt-4 py-3 rounded-2xl text-sm font-black text-white disabled:opacity-50"
            style={{ background: '#2FA37C' }}
          >
            {savingProfile ? 'Đang lưu…' : 'Lưu biệt danh'}
          </button>
        </section>

        <section className="rounded-3xl p-5" style={{ background: '#FFFFFF', boxShadow: 'var(--shadow-card)' }}>
          <p className="text-xs font-bold uppercase tracking-wide mb-1" style={{ color: '#5B6660' }}>
            Hộ gia đình
          </p>
          <p className="text-sm mb-4" style={{ color: '#5B6660' }}>
            Thành viên được ủy quyền trong hộ gia đình có thể thay đổi tên hiển thị này.
          </p>
          <label htmlFor="household-name" className="block text-sm font-bold mb-2" style={{ color: '#18211D' }}>
            Tên hộ gia đình
          </label>
          <input
            id="household-name"
            type="text"
            value={householdName}
            onChange={(event) => setHouseholdName(event.target.value)}
            className="w-full px-4 py-3 rounded-2xl text-base outline-none border"
            style={{ background: '#FFFFFF', borderColor: '#E5EBE8', color: '#18211D' }}
          />
          <button
            type="button"
            onClick={saveHousehold}
            disabled={savingHousehold}
            className="w-full mt-4 py-3 rounded-2xl text-sm font-black text-white disabled:opacity-50"
            style={{ background: '#2FA37C' }}
          >
            {savingHousehold ? 'Đang lưu…' : 'Lưu tên hộ gia đình'}
          </button>
        </section>
      </main>
    </div>
  );
}
