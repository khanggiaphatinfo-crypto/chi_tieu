type TxRow = {
  id: string;
  amount: number;
  type: string;
  currency?: string | null;
  category_id: string | null;
  account_id: string | null;
  scope: string;
  is_shared: boolean;
  merchant: string | null;
  occurred_on: string;
  profile_id: string;
  categories: { name: string; icon: string } | null;
};

const TYPE_LABEL: Record<string, string> = {
  expense: 'Chi tiêu',
  income: 'Thu nhập',
  transfer: 'Chuyển khoản',
};

export function exportTransactionsToCSV(transactions: TxRow[], filename: string): void {
// Số tiền được xuất theo đúng loại tiền của từng dòng, kèm cột Tiền tệ rõ ràng
  // để giao dịch USD không bị ghi nhầm là peso.
  const header = ['Ngày', 'Loại', 'Danh mục', 'Cửa hàng', 'Số tiền', 'Tiền tệ', 'Phạm vi', 'Đã chia sẻ'];

  const rows = transactions.map((tx) => [
    tx.occurred_on,
    TYPE_LABEL[tx.type] ?? tx.type,
    tx.categories?.name ?? '',
    tx.merchant ?? '',
    String(tx.amount),
    tx.currency ?? 'ARS',
    tx.scope === 'household' ? 'Hộ gia đình' : 'Cá nhân',
    tx.is_shared ? 'Có' : 'Không',
  ]);

  const csv = [header, ...rows]
    .map((row) =>
      row
        .map((cell) => {
          let s = String(cell);
      // Vô hiệu hóa việc chèn công thức bảng tính: merchant tên
          // "=HYPERLINK(...)" phải mở dưới dạng văn bản trong Excel, không được thực thi.
          if (/^[=+@\t\r]/.test(s)) s = `'${s}`;
          return s.includes(',') || s.includes('"') || s.includes('\n')
            ? `"${s.replace(/"/g, '""')}"`
            : s;
        })
        .join(','),
    )
    .join('\n');

  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
