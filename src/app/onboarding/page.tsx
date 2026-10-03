'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

const steps = [
  {
    emoji: '📱',
    title: 'Cài Morchis trên iPhone',
    body: (
      <>
        <p className="text-base text-center" style={{ color: '#5B6660' }}>
          Để mở ứng dụng như một app thật, hãy làm theo các bước sau trong Safari:
        </p>
        <ol className="mt-4 space-y-3 text-left">
          {[
            { icon: '1️⃣', text: 'Mở trang này trong Safari' },
            { icon: '2️⃣', text: 'Nhấn nút Chia sẻ (hình vuông có mũi tên ↑)' },
            { icon: '3️⃣', text: 'Chọn “Thêm vào Màn hình chính”' },
            { icon: '4️⃣', text: 'Xong! Morchis sẽ xuất hiện trên màn hình chính 🎉' },
          ].map((s) => (
            <li key={s.icon} className="flex items-start gap-3">
              <span className="text-xl shrink-0">{s.icon}</span>
              <span className="text-base" style={{ color: '#18211D' }}>{s.text}</span>
            </li>
          ))}
        </ol>
        <div className="mt-4 rounded-2xl p-3 text-sm text-center" style={{ background: '#FFE5E0', color: '#E25749' }}>
          Chỉ hoạt động trên <strong>Safari</strong>. Chrome và trình duyệt Instagram không hỗ trợ.
        </div>
      </>
    ),
  },
  {
    emoji: '💚',
    title: 'Mọi thứ đã sẵn sàng, Morch!',
    body: (
      <p className="text-base text-center" style={{ color: '#5B6660' }}>
        Đã đến lúc ghi lại các khoản chi và thu nhập cùng nhau. Nhấn <strong>+</strong> để thêm giao dịch đầu tiên.
      </p>
    ),
  },
];

export default function OnboardingPage() {
  const [idx, setIdx] = useState(0);
  const router = useRouter();
  const isLast = idx === steps.length - 1;
  const step = steps[idx];

  function next() {
    if (isLast) {
      router.push('/presupuestos');
    } else {
      setIdx(idx + 1);
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-6" style={{ background: '#F1F5F3' }}>
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-6xl mb-4">{step.emoji}</div>
          <h1 className="text-2xl font-black mb-4" style={{ color: '#18211D' }}>
            {step.title}
          </h1>
          {step.body}
        </div>

        <div className="flex items-center gap-2 justify-center mb-6">
          {steps.map((_, i) => (
            <div
              key={i}
              className="h-2 rounded-full transition-all"
              style={{
                width: i === idx ? 24 : 8,
                background: i === idx ? '#2FA37C' : '#E5EBE8',
              }}
            />
          ))}
        </div>

        <button
          onClick={next}
          className="w-full py-4 rounded-2xl text-base font-bold text-white"
          style={{ background: '#2FA37C' }}
        >
          {isLast ? 'Bắt đầu thôi! 🚀' : 'Tiếp theo'}
        </button>

        {!isLast && (
          <button
            onClick={() => router.push('/presupuestos')}
            className="w-full py-3 text-sm text-center"
            style={{ color: '#5B6660' }}
          >
            Bỏ qua
          </button>
        )}
      </div>
    </div>
  );
}
