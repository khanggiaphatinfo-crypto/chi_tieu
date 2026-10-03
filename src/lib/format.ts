// Các hàm định dạng tiền — mọi phép tính thực hiện bằng TypeScript, không bao giờ trong LLM.
// Các khoản tiền lưu numeric(14,2): tối đa 2 chữ số thập phân. Chỉ hiện phần lẻ khi có giá trị
// (minimumFractionDigits: 0) để số tròn luôn gọn.

export function formatARS(amount: number): string {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'ARS',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount || 0); // `|| 0` collapses -0 so we never render "-$ 0"
}

export function formatUSD(amount: number): string {
  return new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount || 0); // `|| 0` collapses -0 so we never render "-US$ 0"
}

/**
 * Định dạng chuỗi thô đang nhập trên bàn phím số (ví dụ “1234,8”) thành
 * hiển thị tiền tệ mà KHÔNG chuyển vòng qua số thực. Nhờ đó dấu phẩy thập phân
 * vẫn hiện ngay khi bấm và giữ được số 0 ở cuối ("0,80" hiển thị "$ 0,80", không phải "$ 0,8").
 * Phần nguyên được nhóm bằng Intl để ký hiệu/khoảng cách tiền tệ khớp chính xác với formatARS/formatUSD.
 */
export function formatTypedAmount(raw: string, currency: 'ARS' | 'USD'): string {
  const commaAt = raw.indexOf(',');
  const intDigits = (commaAt === -1 ? raw : raw.slice(0, commaAt)).replace(/\D/g, '');
  const intValue = intDigits ? parseInt(intDigits, 10) : 0;
  const intDisplay = new Intl.NumberFormat('vi-VN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(intValue);
  if (commaAt === -1) return intDisplay;
  const decDigits = raw.slice(commaAt + 1).replace(/\D/g, '').slice(0, 2);
  return `${intDisplay},${decDigits}`;
}

/**
  * Đánh giá một biểu thức số học nhỏ được nhập thay cho số tiền, để tính nhanh
 * khi thêm giao dịch ("1200+350", "990*3", "5000/2"). Hỗ trợ + − × ÷ theo thứ tự ưu tiên thông thường
 * (× ÷ trước + −). Mỗi toán hạng được phân tích bằng parseMoney (hỗ trợ es-AR), nên "1.200,50+300"
 * cũng hoạt động. Bỏ qua toán tử ở đầu/cuối, nếu lặp toán tử thì giữ toán tử cuối và chia cho 0 cho kết quả 0. Trả về số được làm tròn 2 chữ số thập phân (0 nếu không có gì hợp lệ để tính).
 */
export function evalMoneyExpr(input: string): number {
  if (!input) return 0;
  const norm = input.replace(/×/g, '*').replace(/÷/g, '/').replace(/[−–—]/g, '-');
  const tokens = norm.match(/[\d.,]+|[+\-*/]/g);
  if (!tokens) return 0;

  const nums: number[] = [];
  const ops: string[] = [];
  let expectOperand = true;
  for (const t of tokens) {
    const isOp = t.length === 1 && '+-*/'.includes(t);
    if (isOp) {
      // Ignore a leading operator; collapse a run of operators to the last one.
      if (expectOperand) {
        if (ops.length > 0 && ops.length === nums.length) ops[ops.length - 1] = t;
        continue;
      }
      ops.push(t);
      expectOperand = true;
    } else {
      nums.push(parseMoney(t));
      expectOperand = false;
    }
  }
  if (nums.length === 0) return 0;

  // First pass: fold × and ÷ into running products; defer + and − to a second
  // pass so multiplication binds tighter than addition.
  const vals = [nums[0]];
  const addOps: string[] = [];
  for (let i = 0; i < ops.length && i + 1 < nums.length; i++) {
    const op = ops[i];
    const n = nums[i + 1];
    if (op === '*') vals[vals.length - 1] *= n;
    else if (op === '/') vals[vals.length - 1] = n === 0 ? 0 : vals[vals.length - 1] / n;
    else {
      addOps.push(op);
      vals.push(n);
    }
  }
  let result = vals[0];
  for (let i = 0; i < addOps.length; i++) {
    result = addOps[i] === '+' ? result + vals[i + 1] : result - vals[i + 1];
  }
  return Number.isFinite(result) ? roundMoney(result) : 0;
}

/** Đúng khi chuỗi chứa toán tử số học (tức là biểu thức, không phải số tiền đơn). */
export function hasMoneyOperator(input: string): boolean {
  return /[+\-*/×÷]/.test(input);
}

/**
 * Định dạng biểu thức đang nhập để hiển thị: mỗi toán hạng được nhóm hàng nghìn theo vi-VN
 * (giữ dấu phẩy thập phân), toán tử hiển thị thành ×, ÷, −, + với khoảng trắng hai bên.
 * Dùng để phản chiếu công thức người dùng đang xây dựng.
 */
export function formatExprDisplay(expr: string): string {
  const tokens = expr.match(/[\d.,]+|[+\-*/×÷]/g);
  if (!tokens) return '';
  return tokens
    .map((t) => {
      if (t.length === 1 && '+-*/×÷'.includes(t)) {
        const sym = t === '*' ? '×' : t === '/' ? '÷' : t === '-' ? '−' : t;
        return ` ${sym} `;
      }
      const commaAt = t.indexOf(',');
      const intDigits = (commaAt === -1 ? t : t.slice(0, commaAt)).replace(/\D/g, '');
      const intDisplay = intDigits ? parseInt(intDigits, 10).toLocaleString('vi-VN') : '0';
      if (commaAt === -1) return intDisplay;
      const dec = t.slice(commaAt + 1).replace(/\D/g, '').slice(0, 2);
      return `${intDisplay},${dec}`;
    })
    .join('')
    .trim();
}

export function arsToUsd(ars: number, rateArsPerUsd: number): number {
  return roundMoney(ars / rateArsPerUsd);
}

export function usdToArs(usd: number, rateArsPerUsd: number): number {
  return roundMoney(usd * rateArsPerUsd);
}

/** Làm tròn 2 chữ số để lưu/hiển thị, tránh sai số số thực. */
export function roundMoney(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Phân tích chuỗi tiền thành số có tối đa 2 chữ số thập phân.
 * Hỗ trợ định dạng vi-VN (1.234,56) và nhập thông thường (1234.56):
 * dấu phân cách CUỐI CÙNG (',' hoặc '.') được xem là dấu thập phân, các dấu trước đó là phân cách hàng nghìn. Mọi thứ khác bị loại bỏ.
 */
export function parseMoney(input: string): number {
  if (!input) return 0;
  const cleaned = input.replace(/[^\d.,]/g, '');
  if (!cleaned) return 0;
  const lastSep = Math.max(cleaned.lastIndexOf(','), cleaned.lastIndexOf('.'));
  let intPart: string;
  let decPart = '';
  if (lastSep === -1) {
    intPart = cleaned.replace(/\D/g, '');
  } else {
    intPart = cleaned.slice(0, lastSep).replace(/\D/g, '');
    decPart = cleaned.slice(lastSep + 1).replace(/\D/g, '').slice(0, 2);
  }
  const n = parseFloat(`${intPart || '0'}.${decPart || '0'}`);
  return Number.isFinite(n) ? roundMoney(n) : 0;
}
