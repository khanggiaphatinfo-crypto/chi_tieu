# Morchis 💚

> **Tiền của chúng ta, cùng nhau.**

Morchis là ứng dụng tài chính cá nhân dành cho **các cặp đôi và hộ gia đình**: một không gian chung để theo dõi tài khoản, ngân sách, chi tiêu và khoản nợ bằng peso và đô la, cùng trợ lý AI hiểu tình hình tài chính của bạn và trả lời bằng ngôn ngữ dễ hiểu.

Đây là **PWA ưu tiên thiết bị di động** (cài trên điện thoại như ứng dụng gốc), với khả năng đồng bộ theo thời gian thực giữa các thành viên trong hộ gia đình.

<p align="center">
  <img src="public/icons/icon-512.png" width="96" alt="Morchis" />
</p>

---

## ✨ Tính năng

### 💸 Tài chính hằng ngày
- **Giao dịch** — Sổ giao dịch có tìm kiếm, bộ lọc, xuất CSV, vuốt để chỉnh sửa/xóa và xem chi tiết từng mục.
- **Tài khoản** — Tài khoản thanh toán, tiết kiệm, tiền mặt và thẻ tín dụng, kèm số dư, đối soát và theo dõi lãi suất.
- **Quy tắc** — Thu nhập và chi phí định kỳ (hằng ngày / hằng tuần / hai tuần một lần / hằng tháng) được tự động tạo.
- **Sao kê** — Tải lên sao kê ngân hàng và nhập giao dịch.

### 🎯 Ngân sách & mục tiêu
- **Ngân sách** — Lập ngân sách theo phong bì cho từng danh mục, với hạn mức theo tháng, cảnh báo chi vượt và phân chia hộ gia đình / cá nhân.
- **Phân tích** — Bảng điều khiển hộ gia đình: tài sản ròng, dòng tiền dự kiến, *tuổi của tiền* và cơ cấu chi tiêu theo ARS/USD.
- **Mô phỏng** — "Nếu tôi mua món này thì sao?": đo tác động của một khoản mua đến tỷ lệ tiết kiệm và mục tiêu trước khi bạn chi tiền.

### 👫 Tài chính cặp đôi
- **Cặp đôi** — Cân đối giữa hai người: ai nợ ai, ghi nhận thanh toán và quyết toán.
- **Chi tiêu chung** — Mỗi khoản chi có thể là *cá nhân*, *chia sẻ* (theo dõi ai đã trả và ai đang nợ) hoặc *hộ gia đình*.

### 🤖 AI (Claude)
- **Hỏi Morchi** — Trợ lý hội thoại trả lời các câu hỏi về tài chính của bạn ("Tháng này chúng ta đã chi bao nhiêu?", "Có thể cắt giảm khoản nào?"), hỗ trợ nhập liệu bằng giọng nói.
- **Hóa đơn** — Chụp ảnh hóa đơn để AI trích xuất nhà bán hàng, ngày, số tiền, đơn vị tiền tệ và các mặt hàng, sau đó gợi ý danh mục (hóa đơn tạp hóa, chuyển khoản, ứng dụng giao hàng, v.v.).
- **Thông tin chi tiết** — Các thẻ tự động tạo về tỷ lệ tiết kiệm, những đợt chi tiêu tăng bất thường và cảnh báo mục tiêu.
- **Gợi ý ngân sách** và **sức mua** — Công cụ hỗ trợ xây dựng và hiểu ngân sách trong bối cảnh lạm phát.

### 📱 Trải nghiệm
- **PWA có thể cài đặt** với service worker, chế độ ngoại tuyến cơ bản và thông báo đẩy (Web Push / VAPID).
- **Khóa ứng dụng** bằng mã PIN 4–6 chữ số (băm SHA-256).
- Hỗ trợ **hai loại tiền tệ** (ARS / USD), chế độ sáng/tối, kéo để làm mới và phản hồi rung.

---

## 🧱 Công nghệ

| Tầng | Công nghệ |
|-------|------------|
| Framework | **Next.js 16** (App Router) · **React 19** · TypeScript 5 |
| Backend | **Supabase** — Postgres, Auth, Row Level Security, Edge Functions (Deno) |
| AI | **Claude** thông qua Anthropic SDK (trò chuyện, OCR hóa đơn, thông tin chi tiết, mô phỏng) |
| State | **Zustand** (client) · **TanStack React Query** (server) |
| UI | **Base UI** + **shadcn** · **Tailwind CSS 4** · **Lucide** · **Recharts** · **Sonner** |
| PWA | **next-pwa** · service worker · Web Push · **next-themes** |
| Kiểm thử | **Vitest** |

---

## 🏗️ Kiến trúc

```
src/
├── app/                      # Các tuyến (App Router)
│   ├── analisis/             # Bảng điều khiển hộ gia đình
│   ├── cuentas/              # Tài khoản và thẻ
│   ├── deudas/               # Khoản nợ với bên thứ ba
│   ├── extractos/            # Sao kê ngân hàng
│   ├── household/            # Tạo / tham gia hộ gia đình
│   ├── insights/             # Thông tin chi tiết do AI tạo
│   ├── mas/                  # Cài đặt, danh mục, PIN, thông báo
│   ├── movimientos/          # Sổ giao dịch
│   ├── onboarding/           # Hướng dẫn cài đặt PWA
│   ├── pareja/               # Cân đối và quyết toán giữa cặp đôi
│   ├── preguntale/           # Trò chuyện với AI ("Hỏi Morchi")
│   ├── presupuestos/         # Lập ngân sách theo phong bì
│   ├── reglas/               # Quy tắc định kỳ
│   ├── simulador/            # Mô phỏng giao dịch mua
│   ├── super/                # Chi tiết chi tiêu tạp hóa
│   └── ticket/               # OCR hóa đơn
├── components/               # Component giao diện (điều hướng, sheet, biểu đồ…)
├── hooks/                    # Hook (phong bì, cặp đôi, tỷ giá, push…)
├── lib/                      # Logic nghiệp vụ (ngân sách, tài khoản, định kỳ, định dạng…)
└── store/                    # Store Zustand (PIN, tiền tệ, quyền riêng tư)

supabase/
├── migrations/               # Khoảng 28 migration schema
└── functions/                # Edge Function
    ├── ask-morchis/          # Trợ lý hội thoại
    ├── parse-receipt/        # OCR hóa đơn
    ├── parse-statement/      # Phân tích sao kê
    ├── generate-insights/    # Tạo thông tin chi tiết
    ├── simulate-purchase/    # Mô phỏng giao dịch mua
    ├── suggest-budgets/      # Gợi ý ngân sách
    ├── purchasing-power-insight/
    ├── budget-alert/ · card-due-alert/ · monthly-close/
    └── _shared/
```

### Mô hình dữ liệu (tổng quan)
- **`households`** — nhóm dùng chung; mỗi **`profiles`** thuộc về một hộ gia đình.
- **`accounts`**, **`transactions`**, **`transaction_items`** — tài khoản và giao dịch (với `scope`: personal / shared / household).
- **`budget_months`**, **`category_targets`**, **`savings_goals`** — ngân sách và mục tiêu.
- **`splits`**, **`settlements`** — ai đã trả / ai đang nợ và các khoản quyết toán giữa cặp đôi.
- **`recurring_rules`** — các khoản định kỳ.
- **`insights`**, **`push_subscriptions`** — AI và thông báo.
- **`fx_rates`**, **`inflation_rates`**, **`categories`**, **`merchant_aliases`** — dữ liệu tham chiếu.

Mọi dữ liệu giữa các hộ gia đình đều được cô lập bằng **Row Level Security** trong Supabase.

---

## 🚀 Bắt đầu

### Yêu cầu
- Node.js 20+
- Một dự án [Supabase](https://supabase.com)
- API key [Anthropic](https://console.anthropic.com) (cho các tính năng AI)

### 1. Cài đặt các gói phụ thuộc
```bash
npm install
```

### 2. Biến môi trường
Tạo tệp `.env.local` ở thư mục gốc của dự án:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
NEXT_PUBLIC_VAPID_PUBLIC_KEY=<your-vapid-public-key>   # cho Web Push
```

> Không đặt các key phía máy chủ ở đây: chúng được nạp dưới dạng *secret* của Edge Function trong Supabase (xem bên dưới).

### 3. Thiết lập schema và function
Sử dụng [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
# Áp dụng migration
supabase db push

# Thiết lập secret cho Edge Function
supabase secrets set ANTHROPIC_API_KEY=<your-api-key>
supabase secrets set VAPID_PRIVATE_KEY=<your-vapid-private-key>

# Triển khai function
supabase functions deploy
```

### 4. Chạy trong môi trường phát triển
```bash
npm run dev
```

Mở [http://localhost:3000](http://localhost:3000) (hoặc cổng mà terminal hiển thị).

> 💡 Để có trải nghiệm đầy đủ, hãy cài ứng dụng PWA từ trình duyệt điện thoại (**Thêm vào màn hình chính**) — khi đó thông báo, khóa ứng dụng và chế độ độc lập mới hoạt động đầy đủ.

---

## 📜 Các script

```bash
npm run dev          # Máy chủ phát triển
npm run build        # Bản dựng production
npm start            # Máy chủ production
npm run lint         # ESLint
npm test             # Kiểm thử (Vitest)
npm run test:watch   # Kiểm thử ở chế độ theo dõi
```

---

## 🔐 Cách các cặp đôi chia sẻ dữ liệu

1. Người đầu tiên **tạo một hộ gia đình** và nhận **mã mời**.
2. Người đồng hành **tham gia bằng mã** → cả hai cùng thuộc một `household_id`.
3. Từ đó, cả hai đều thấy các giao dịch dùng chung của hộ gia đình; chi tiêu cá nhân vẫn riêng tư với từng người, còn chi tiêu dùng chung sẽ theo dõi ai đã trả và ai đang nợ để có thể quyết toán tại `/pareja`.

---

## 📦 Triển khai

Được thiết kế cho [Vercel](https://vercel.com) (frontend Next.js) + [Supabase](https://supabase.com) (dữ liệu và Edge Function). Hãy nhớ thiết lập cùng các biến `NEXT_PUBLIC_*` trong môi trường Vercel.

---

## 📝 Giấy phép

Dự án riêng tư. Bảo lưu mọi quyền.
