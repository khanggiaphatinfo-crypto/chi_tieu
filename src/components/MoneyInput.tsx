'use client';

import { useState } from 'react';
import { roundMoney, evalMoneyExpr, hasMoneyOperator } from '@/lib/format';

// Text input that shows the amount with vi-VN thousand separators
// (e.g. 4.500.000) while storing a number with up to 2 decimals. Allows
// users to type cents (e.g. 193,35) for decimal amounts.
//
// Convention (comma-decimal, unambiguous): ',' is the decimal separator; '.' is always
// a thousands separator and is stripped. This is what keeps "1234" -> "1.234"
// from being misread as 1,23 on the next keystroke.

// Formatted string -> number with up to 2 decimals.
function esARToNumber(formatted: string): number {
  const norm = formatted.replace(/\./g, '').replace(',', '.');
  const n = parseFloat(norm);
  return Number.isFinite(n) ? roundMoney(n) : 0;
}

// Display an already-known numeric value for editing (no currency symbol).
function formatValue(v: number): string {
  if (!v) return '';
  return v.toLocaleString('vi-VN', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

// Re-group what the user is typing: thousands on the integer part, keep a
// trailing decimal comma and up to 2 decimal digits so typing feels live.
function formatTyping(raw: string): string {
  const firstComma = raw.indexOf(',');
  const intRaw = firstComma === -1 ? raw : raw.slice(0, firstComma);
  const decRaw = firstComma === -1 ? '' : raw.slice(firstComma + 1);
  const intDigits = intRaw.replace(/\D/g, '');
  const decDigits = decRaw.replace(/\D/g, '').slice(0, 2);
  const intFmt = intDigits
    ? parseInt(intDigits, 10).toLocaleString('vi-VN')
    : firstComma === -1
      ? ''
      : '0';
  return firstComma === -1 ? intFmt : `${intFmt},${decDigits}`;
}

export function MoneyInput({
  value,
  onChange,
  placeholder,
  className,
  style,
  autoFocus,
}: {
  value: number;
  onChange: (n: number) => void;
  placeholder?: string;
  className?: string;
  style?: React.CSSProperties;
  autoFocus?: boolean;
}) {
  const [text, setText] = useState(() => formatValue(value));
  // While the field has focus we don't reformat from the outside `value`, so a
  // half-typed expression like "1200+" isn't clobbered mid-keystroke. The
  // expression collapses to its result on blur.
  const [focused, setFocused] = useState(false);

  const displayValue = focused ? text : formatValue(value);

  return (
    <input
      type="text"
      inputMode="decimal"
      value={displayValue}
      placeholder={placeholder}
      className={className}
      style={style}
      autoFocus={autoFocus}
      onFocus={() => {
        setFocused(true);
        setText(formatValue(value));
      }}
      onBlur={() => {
        setFocused(false);
        setText(formatValue(hasMoneyOperator(text) ? evalMoneyExpr(text) : value));
      }}
      onChange={(e) => {
        const next = e.target.value;
        // Quick math: let the user type + − × ÷ to compute an amount. We keep
        // the raw operators visible (only stripping clearly invalid chars) and
        // report the evaluated result upward.
        if (hasMoneyOperator(next)) {
          const cleaned = next.replace(/[^\d.,+\-*/×÷]/g, '');
          setText(cleaned);
          onChange(evalMoneyExpr(cleaned));
          return;
        }
        const formatted = formatTyping(next);
        setText(formatted);
        onChange(esARToNumber(formatted));
      }}
    />
  );
}
