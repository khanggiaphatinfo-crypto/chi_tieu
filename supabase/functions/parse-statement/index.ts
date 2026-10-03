import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { normalize, isDuplicate } from "./math.ts";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

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

// ── Claude provider ───────────────────────────────────────────────────

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
      ? `\n\nAliases de comercios conocidos (usá estas categorías si el comercio coincide):\n${merchantAliases
          .map((a) => `- "${a.raw_pattern}" → ${categories.find((c) => c.id === a.category_id)?.name ?? ""}`)
          .join("\n")}`
      : "";

    // Variable block: the document. CSVs go as plain text; PDFs as a
    // document block; everything else as an image block.
    let fileBlock: Record<string, unknown>;
    if (input.kind === "text") {
      fileBlock = {
        type: "text",
        text: `Contenido del archivo CSV:\n\n${input.text}`,
      };
    } else if (input.mimeType === "application/pdf") {
      fileBlock = {
        type: "document",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: input.data,
        },
      };
    } else {
      fileBlock = {
        type: "image",
        source: {
          type: "base64",
          media_type: input.mimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif",
          data: input.data,
        },
      };
    }

    const messages = [
      {
        role: "user",
        content: [
          // Cached block: system context + schema + categories
          {
            type: "text",
            text: `${SYSTEM_PROMPT}\n\nCategorías disponibles: ${categoryList}${aliasList}\n\nEsquema de salida:\n${JSON.stringify(TRANSACTION_SCHEMA, null, 2)}`,
            cache_control: { type: "ephemeral" },
          },
          fileBlock,
          {
            type: "text",
            text: "Analizá el documento y extraé las transacciones según su tipo (resumen/extracto: una por cada gasto; ticket/comprobante: una sola con el total y los productos en raw_description; CSV de actividad: una por cada gasto real).",
          },
        ],
      },
    ];

    const response = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-beta": "prompt-caching-2024-07-31,pdfs-2024-09-25",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        messages,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Claude API error ${response.status}: ${err}`);
    }

    const data = await response.json();
    const text = data.content?.[0]?.text ?? "[]";

    // Strip markdown code fences if present
    const cleaned = text.replace(/^```[\w]*\n?/, "").replace(/\n?```$/, "").trim();
    return JSON.parse(cleaned) as ParsedTransaction[];
  }
}

// ── Dedup logic ──────────────────────────────────────────────────────



// ── Main handler ─────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" } });
  }

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
    return new Response(JSON.stringify({ error: "statement_id requerido" }), { status: 400 });
  }

  // Get statement (RLS ensures user owns it via household)
  const { data: statement, error: stmtErr } = await supabase
    .from("statements")
    .select("id, household_id, file_path, profile_id, account_id")
    .eq("id", statement_id)
    .single();

  if (stmtErr || !statement) {
    return new Response(JSON.stringify({ error: "Resumen no encontrado" }), { status: 404 });
  }

  if (!statement.file_path) {
    return new Response(JSON.stringify({ error: "Sin archivo" }), { status: 400 });
  }

  // Mark as parsing
  await serviceClient.from("statements").update({ status: "parsing" }).eq("id", statement_id);

  try {
    // Download file from storage
    const { data: fileData, error: dlErr } = await serviceClient.storage
      .from("statements")
      .download(statement.file_path);

    if (dlErr || !fileData) throw new Error(`Error descargando archivo: ${dlErr?.message}`);

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
          "\n\n[ARCHIVO TRUNCADO: se incluyen solo los primeros 150.000 caracteres]";
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
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    await serviceClient
      .from("statements")
      .update({ status: "failed", error: msg })
      .eq("id", statement_id);
    return new Response(JSON.stringify({ error: msg }), { status: 500 });
  }
});
