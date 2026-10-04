import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { inputFile, inputImage, inputText, parseJson, responsesRequest } from "../_shared/responses.ts";
import { normalize, isDuplicate } from "./math.ts";

// ── Types ────────────────────────────────────────────────────────────

interface ParsedTransaction {
  date: string;          // YYYY-MM-DD
  merchant: string;
  raw_description: string;
  amount: number;        // positive ARS integer
  suggested_category: string;
  confidence: number;    // 0–1
}

// Input for the AI provider: binary documents/images go as base64,
// CSV exports go as plain decoded text.
type StatementInput =
  | { kind: "base64"; data: string; mimeType: string }
  | { kind: "text"; text: string };

interface AIProvider {
  parseStatement(
    input: StatementInput,
    categories: { id: string; name: string }[],
    merchantAliases: { raw_pattern: string; merchant_clean: string | null; category_id: string | null }[],
  ): Promise<ParsedTransaction[]>;
}

// ── Responses provider ───────────────────────────────────────────────

const SYSTEM_PROMPT = `Bạn là trợ lý trích xuất giao dịch từ tài liệu tài chính Argentina: sao kê thẻ, sao kê ngân hàng và hóa đơn/biên lai mua hàng.

Trước hết hãy xác định LOẠI tài liệu:

A) SAO KÊ (thẻ tín dụng/thẻ ghi nợ hoặc ngân hàng): chứa NHIỀU giao dịch ở các cửa hàng và ngày khác nhau.
   → Trả về một mảng với MỘT phần tử cho mỗi giao dịch chi tiêu.

B) HÓA ĐƠN / BIÊN LAI của một lần mua hàng (siêu thị, ki-ốt, nhà thuốc, nhà hàng, cửa hàng kim khí, v.v.): chỉ là MỘT lần mua tại một cửa hàng, có chi tiết sản phẩm và tổng tiền.
   → Trả về một mảng với ĐÚNG MỘT phần tử đại diện cho toàn bộ lần mua:
      - amount: TỔNG tiền mua (số tiền cuối cùng đã trả, không phải từng sản phẩm riêng lẻ).
      - merchant: tên cửa hàng.
      - raw_description: liệt kê sản phẩm phát hiện được, ngăn cách bằng dấu phẩy (ví dụ: "Sữa La Serenísima, Bánh mì sandwich, Coca-Cola 2.25L, Nước rửa chén Magistral"). Nếu quá nhiều, liệt kê các sản phẩm chính rồi thêm "và các sản phẩm khác".
      - date: ngày trên hóa đơn theo định dạng YYYY-MM-DD.
      - suggested_category: danh mục phù hợp nhất theo sản phẩm (ví dụ: hóa đơn siêu thị thường là Thực phẩm/Siêu thị).

C) FILE CSV hoạt động (ví dụ: Mercado Pago): mỗi dòng là một giao dịch. CHỈ trích xuất chi tiêu thực tế (thanh toán cho cửa hàng, mua hàng, dịch vụ, ghi nợ tự động). BỎ QUA: chuyển tiền giữa tài khoản của chính người dùng, tiền nhận, nạp số dư, hoàn tiền và thanh toán thẻ tín dụng (đó là luân chuyển tiền, không phải chi tiêu). Số âm thường là tiền ra — trả về giá trị tuyệt đối. Ngày theo định dạng YYYY-MM-DD (CSV Argentina thường dùng DD/MM/YYYY hoặc ISO).
   → Trả về một mảng với MỘT phần tử cho mỗi khoản chi thực tế.

Quy tắc chung:
- Số tiền luôn là peso Argentina (ARS), số nguyên dương.
- Nếu tài liệu thể hiện đô la, quy đổi sang ARS bằng tỷ giá trong tài liệu hoặc đặt confidence thấp.
- Với sao kê, bỏ qua thanh toán tối thiểu, thanh toán sao kê trước, phí tài chính và số dư. Chỉ lấy giao dịch tại cửa hàng.
- Ngày phải theo định dạng YYYY-MM-DD.
- merchant: tên cửa hàng sạch (không mã, không tiền tố ngân hàng).
- suggested_category: chọn danh mục phù hợp nhất từ danh sách được cung cấp.
- confidence: số từ 0 đến 1 cho biết mức độ chắc chắn về danh mục và số tiền.

CHỈ trả về mảng JSON, không thêm văn bản.`;

const TRANSACTION_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    required: ["date", "merchant", "raw_description", "amount", "suggested_category", "confidence"],
    properties: {
      date: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
      merchant: { type: "string" },
      raw_description: { type: "string" },
      amount: { type: "integer", minimum: 0 },
      suggested_category: { type: "string" },
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
  },
};

class ClaudeProvider implements AIProvider {
  async parseStatement(
    input: StatementInput,
    categories: { id: string; name: string }[],
    merchantAliases: { raw_pattern: string; merchant_clean: string | null; category_id: string | null }[],
  ): Promise<ParsedTransaction[]> {
    const categoryList = categories.map((c) => c.name).join(", ");
    const aliasList = merchantAliases.length > 0
      ? `\n\nCác bí danh cửa hàng đã biết (dùng các danh mục này nếu cửa hàng khớp):\n${merchantAliases
          .map((a) => `- "${a.raw_pattern}" → ${categories.find((c) => c.id === a.category_id)?.name ?? ""}`)
          .join("\n")}`
      : "";

    let filePart;
    if (input.kind === "text") {
      filePart = inputText(`Nội dung tệp CSV:\n\n${input.text}`);
    } else if (input.mimeType === "application/pdf") {
      filePart = inputFile(input.data, input.mimeType, "statement.pdf");
    } else {
      filePart = inputImage(input.data, input.mimeType);
    }

    const response = await responsesRequest({
      maxOutputTokens: 4096,
      instructions: `${SYSTEM_PROMPT}\n\nCác danh mục có sẵn: ${categoryList}${aliasList}\n\nĐịnh dạng đầu ra:\n${JSON.stringify(TRANSACTION_SCHEMA, null, 2)}`,
      input: [filePart, inputText("Hãy phân tích tài liệu và trích xuất giao dịch theo loại (sao kê: một giao dịch cho mỗi khoản chi; hóa đơn/chứng từ: một giao dịch duy nhất với tổng tiền và sản phẩm trong raw_description; CSV hoạt động: một giao dịch cho mỗi khoản chi thực tế).")],
    });

    return parseJson<ParsedTransaction[]>(response.text, []);
  }
}

// ── Dedup logic ──────────────────────────────────────────────────────



const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// ── Main handler ─────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }
  if (req.method !== "POST") return json({ error: "Phương thức không được hỗ trợ" }, 405);

  const authHeader = req.headers.get("Authorization") ?? "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } },
  );

  const serviceClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const { statement_id } = await req.json();
  if (!statement_id) {
    return json({ error: "cần có statement_id" }, 400);
  }

  // Get statement (RLS ensures user owns it via household)
  const { data: statement, error: stmtErr } = await supabase
    .from("statements")
    .select("id, household_id, file_path, profile_id, account_id")
    .eq("id", statement_id)
    .single();

  if (stmtErr || !statement) {
    return json({ error: "Không tìm thấy sao kê" }, 404);
  }

  if (!statement.file_path) {
    return json({ error: "Không tìm thấy tệp" }, 400);
  }

  // Mark as parsing
  await serviceClient.from("statements").update({ status: "parsing" }).eq("id", statement_id);

  try {
    // Download file from storage
    const { data: fileData, error: dlErr } = await serviceClient.storage
      .from("statements")
      .download(statement.file_path);

    if (dlErr || !fileData) throw new Error("Không thể tải tệp sao kê");

    const arrayBuffer = await fileData.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);

    // CSV exports (e.g. Mercado Pago "actividad") go to Claude as plain text.
    // Storage may report application/octet-stream, so also check the extension.
    const isCsv = fileData.type === "text/csv" ||
      statement.file_path.toLowerCase().endsWith(".csv");

    let input: StatementInput;
    if (isCsv) {
      const MAX_CSV_CHARS = 150_000;
      let csvText = new TextDecoder("utf-8").decode(bytes);
      if (csvText.length > MAX_CSV_CHARS) {
        csvText = csvText.slice(0, MAX_CSV_CHARS) +
          "\n\n[TỆP BỊ CẮT: chỉ bao gồm 150.000 ký tự đầu tiên]";
      }
      input = { kind: "text", text: csvText };
    } else {
      // Chunked base64 encoding — spreading a huge Uint8Array into String.fromCharCode
      // overflows the call stack for large files (photos), so encode in slices.
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }
      input = {
        kind: "base64",
        data: btoa(binary),
        mimeType: fileData.type || "application/pdf",
      };
    }

    // Load categories for this household
    const { data: categories = [] } = await serviceClient
      .from("categories")
      .select("id, name")
      .eq("household_id", statement.household_id)
      .eq("kind", "expense");

    // Load merchant aliases
    const { data: merchantAliases = [] } = await serviceClient
      .from("merchant_aliases")
      .select("raw_pattern, merchant_clean, category_id")
      .eq("household_id", statement.household_id);

    // Load recent transactions for dedup (last 90 days, Argentina local date —
    // the server clock is UTC and rolls a day early after 21:00 ART).
    const artNow = new Date(Date.now() - 3 * 60 * 60 * 1000);
    artNow.setUTCDate(artNow.getUTCDate() - 90);
    const ninetyDaysAgoISO = artNow.toISOString().slice(0, 10);
    const { data: recentTx = [] } = await serviceClient
      .from("transactions")
      .select("occurred_on, amount, merchant")
      .eq("household_id", statement.household_id)
      .gte("occurred_on", ninetyDaysAgoISO);

    // Also dedup against not-yet-rejected drafts from OTHER statements of the
    // household, so uploading the same PDF twice doesn't create a second full
    // set of pending drafts (bulk-accepting both used to duplicate everything).
    const { data: otherDrafts = [] } = await serviceClient
      .from("draft_transactions")
      .select("payload, status, statement_id, statements!inner(household_id)")
      .eq("statements.household_id", statement.household_id)
      .neq("statement_id", statement_id)
      .neq("status", "rejected");
    const draftRows = (otherDrafts ?? [])
      .map((d) => {
        const p = (d as { payload: { date?: string; amount?: number; merchant?: string } }).payload ?? {};
        return { occurred_on: p.date ?? "", amount: Number(p.amount ?? 0), merchant: p.merchant ?? null };
      })
      .filter((r) => r.occurred_on);
    const dedupPool = [...(recentTx ?? []), ...draftRows];

    // Parse via Claude
    const provider = new ClaudeProvider();
    const parsed = await provider.parseStatement(input, categories ?? [], merchantAliases ?? []);

    // Resolve category IDs and dedup
    const categoryByName = new Map((categories ?? []).map((c) => [c.name.toLowerCase(), c.id]));

    const drafts = parsed
      .filter((p) => !isDuplicate(p, dedupPool))
      .map((p) => {
        // Check merchant_aliases for a match
        const aliasMatch = (merchantAliases ?? []).find((a) =>
          normalize(p.raw_description).includes(normalize(a.raw_pattern)) ||
          normalize(p.merchant).includes(normalize(a.raw_pattern))
        );

        const categoryId = aliasMatch?.category_id
          ?? categoryByName.get(p.suggested_category.toLowerCase())
          ?? null;

        const merchantClean = aliasMatch?.merchant_clean ?? p.merchant;

        return {
          statement_id,
          confidence: p.confidence,
          status: "pending",
          payload: {
            date: p.date,
            merchant: merchantClean,
            raw_description: p.raw_description,
            amount: Math.round(p.amount),
            suggested_category: p.suggested_category,
            category_id: categoryId,
            confidence: p.confidence,
          },
        };
      });

    if (drafts.length > 0) {
      await serviceClient.from("draft_transactions").insert(drafts);
    }

    // Update statement status. Surface how many rows were skipped as likely
    // duplicates so the review screen can say so instead of silently showing
    // fewer rows than the document.
    const skipped = parsed.length - drafts.length;
    await serviceClient
      .from("statements")
      .update({
        status: "parsed",
        raw_excerpt: JSON.stringify({ sample: parsed.slice(0, 3), skipped_duplicates: skipped }),
      })
      .eq("id", statement_id);

    return new Response(
      JSON.stringify({ ok: true, count: drafts.length, skipped_duplicates: skipped }),
      { headers: { ...CORS, "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const errorCode = err instanceof Error && err.message === "Không thể tải tệp sao kê"
      ? "FILE_DOWNLOAD_FAILED"
      : "STATEMENT_PARSE_FAILED";
    console.error("parse-statement error:", err);
    await serviceClient
      .from("statements")
      .update({ status: "failed", error: errorCode })
      .eq("id", statement_id);
    return json({
      error: errorCode === "FILE_DOWNLOAD_FAILED"
        ? "Không thể tải tệp sao kê"
        : "Không thể phân tích sao kê. Hãy thử lại.",
      code: errorCode,
    }, 500);
  }
});
