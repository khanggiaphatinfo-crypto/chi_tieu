// YNAB-style colour flags for transactions. Stored as the `key` in
// transactions.flag; rendered with `hex`.
export const FLAG_COLORS: { key: string; hex: string; label: string }[] = [
  { key: 'red', hex: '#E25749', label: 'Đỏ' },
  { key: 'orange', hex: '#F5A623', label: 'Cam' },
  { key: 'yellow', hex: '#E8C84A', label: 'Vàng' },
  { key: 'green', hex: '#1F8A68', label: 'Xanh lá' },
  { key: 'blue', hex: '#4E84E0', label: 'Xanh dương' },
  { key: 'purple', hex: '#B084CC', label: 'Tím' },
];

export const flagHex = (key: string | null | undefined): string | null =>
  FLAG_COLORS.find((f) => f.key === key)?.hex ?? null;
