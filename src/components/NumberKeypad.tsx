'use client';

import { useEffect } from 'react';

interface NumberKeypadProps {
  onDigit: (d: string) => void;
  onBackspace: () => void;
  onConfirm?: () => void;
// Khi truyền onOperator, hiển thị thêm một cột toán tử để người dùng tính nhanh
  // (ví dụ chia hóa đơn) khi nhập số tiền. Bỏ qua với bàn phím PIN, vốn vẫn có 3 cột.
  onOperator?: (op: string) => void;
}

const KEYS = [
  ['1', '2', '3'],
  ['4', '5', '6'],
  ['7', '8', '9'],
  [',', '0', '⌫'],
];

// Các phím số, với thêm một cột toán tử cho phiên bản máy tính.
const KEYS_WITH_OPS = [
  ['1', '2', '3', '÷'],
  ['4', '5', '6', '×'],
  ['7', '8', '9', '−'],
  [',', '0', '⌫', '+'],
];

// Ký hiệu hiển thị -> toán tử ASCII gửi lại cho bên gọi.
const OP_SYMBOLS: Record<string, string> = { '÷': '/', '×': '*', '−': '-', '+': '+' };

const KEY_LABEL: Record<string, string> = {
  '⌫': 'Xóa',
  ',': 'Dấu phẩy thập phân',
  '÷': 'Chia',
  '×': 'Nhân',
  '−': 'Trừ',
  '+': 'Cộng',
};

export function NumberKeypad({ onDigit, onBackspace, onConfirm, onOperator }: NumberKeypadProps) {
  const keys = onOperator ? KEYS_WITH_OPS : KEYS;

  function handleKey(k: string) {
    if (k === '⌫') onBackspace();
    else if (OP_SYMBOLS[k]) onOperator?.(OP_SYMBOLS[k]);
    else onDigit(k);
  }

// Hỗ trợ bàn phím phần cứng: số, dấu phẩy/chấm, toán tử, Backspace,
  // Enter — chỉ khi focus không nằm trong trường văn bản (để không chiếm phím nhập mô tả).
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el?.isContentEditable) return;
      if (e.key >= '0' && e.key <= '9') onDigit(e.key);
      else if (e.key === ',' || e.key === '.') onDigit(',');
      else if (onOperator && (e.key === '+' || e.key === '-' || e.key === '*' || e.key === '/')) onOperator(e.key);
      else if (e.key === 'Backspace') onBackspace();
      else if (e.key === 'Enter') onConfirm?.();
      else return;
      e.preventDefault();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onDigit, onBackspace, onConfirm, onOperator]);

  return (
    <div
      className={`grid ${onOperator ? 'grid-cols-4' : 'grid-cols-3'} gap-2 px-4`}
      role="group"
      aria-label="Bàn phím số"
    >
      {keys.map((row, ri) =>
        row.map((k) => {
          const isOp = !!OP_SYMBOLS[k];
          const isDel = k === '⌫';
          return (
            <button
              key={`${ri}-${k}`}
              type="button"
              aria-label={KEY_LABEL[k] ?? k}
              onPointerDown={(e) => {
                e.preventDefault();
                handleKey(k);
              }}
              className="h-16 rounded-2xl text-2xl font-bold flex items-center justify-center active:scale-95 transition-transform select-none"
              style={{
                background: isDel ? '#FFE5E0' : isOp ? '#E9F1FD' : '#FFFFFF',
                color: isDel ? '#FF6F61' : isOp ? '#4E84E0' : '#18211D',
                boxShadow: '0 1px 4px rgba(20,28,24,0.06)',
              }}
            >
              {k}
            </button>
          );
        }),
      )}
    </div>
  );
}
