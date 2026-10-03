import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
};

const GROUPS = ["frutas y verduras", "carnes y fiambres", "lácteos y huevos", "almacén", "panadería", "agua", "bebidas", "snacks", "limpieza", "cuidado personal", "hogar", "mascotas", "café", "tostados y sándwiches", "pastelería", "desayuno y bowls", "jugos y licuados", "otros"];
const CURRENCIES = ["ARS", "USD"];

interface ReceiptItem {
  name: string;
  qty: number;
  line_total: number;
  group: string;
}

interface ParsedReceipt {
  merchant: string;
  date: string;
  total: number;
  currency: string;
  suggested_category: string;
  items: ReceiptItem[];
}

// The function now reads ANY purchase proof, not just supermarket tickets:
// itemized receipts (super, kiosco, farmacia, ferretería) AND single-charge
// proofs like bank/wallet notification screenshots (DiDi, Uber, Mercado Pago,
// PedidosYa, debits, transfers). It detects the right category and currency,
// and only itemizes when there's an actual product list.
const SYSTEM_PROMPT = `Bạn là trợ lý đọc CHỨNG TỪ CHI TIÊU tại Argentina và trả về một đối tượng JSON duy nhất. Chứng từ có thể thuộc một trong hai loại:

1) HÓA ĐƠN / BIÊN LAI có danh sách sản phẩm (siêu thị, ki-ốt, nhà thuốc, cửa hàng kim khí, v.v.).
2) CHỨNG TỪ của một khoản trừ duy nhất KHÔNG có danh sách sản phẩm: ảnh chụp thông báo hoặc giao dịch ngân hàng/ví điện tử (DiDi, Uber, Cabify, Mercado Pago, MODO, PedidosYa, Rappi, ghi nợ tự động, chuyển khoản, thanh toán dịch vụ, nhà hàng, v.v.).

LUÔN trả về JSON sau:
- merchant: tên cửa hàng hoặc dịch vụ (đã làm sạch). Ví dụ: "DiDi", "Carrefour", "Farmacity", "Mercado Pago".
- date: ngày trên chứng từ theo định dạng YYYY-MM-DD. Nếu không có, dùng ngày hôm nay.
- total: TỔNG SỐ TIỀN đã trả, số dương. Chỉ giữ phần thập phân nếu chứng từ thể hiện (không có ký hiệu tiền tệ).
- currency: loại tiền trên chứng từ. "ARS" cho peso Argentina ($, AR$, ARS, "peso"). Chỉ dùng "USD" khi chứng từ rõ ràng là đô la (US$, U$S, USD, "đô la"). Nếu không chắc, dùng "ARS".
- suggested_category: danh mục chi tiêu phù hợp nhất, chọn ĐÚNG từ danh sách được cung cấp. Ví dụ: chuyến DiDi/Uber → giao thông; siêu thị → thực phẩm/siêu thị; nhà thuốc → y tế; giao đồ ăn → nhà hàng/giao đồ ăn. Nếu không có danh mục hoàn toàn phù hợp, chọn danh mục gần nhất.
- items: mảng chi tiết sản phẩm.
    * Nếu là HÓA ĐƠN có danh sách sản phẩm, đưa từng sản phẩm vào:
        - name: tên sản phẩm rõ ràng (ví dụ: "Sữa La Serenísima 1L").
        - qty: số lượng (số, dùng 1 nếu không thể hiện).
        - line_total: tổng giá của dòng đó (đơn giá × số lượng), số dương bằng CÙNG loại tiền với total.
        - group: phân loại sản phẩm vào MỘT trong các nhóm: ${GROUPS.join(", ")}.
            · frutas y verduras = rau quả tươi (chuối, táo, cà chua, khoai tây, hành, xà lách, cà rốt, chanh, v.v.).
            · carnes y fiambres = thịt (bò, gà, heo, cá), thịt nguội và xúc xích.
            · lácteos y huevos = sữa, phô mai, sữa chua, bơ, kem, dulce de leche và trứng.
            · almacén = đồ khô và thực phẩm tủ bếp: gạo, mì, bột, dầu, đường, muối, đồ hộp, đậu, nước xốt, gia vị, cà phê, trà, yerba, đồ phết và mứt.
            · panadería = bánh mì, bánh ngọt, figacitas, tortilla, bánh cuốn và sản phẩm làm bánh.
            · agua = CHỈ nước uống: nước khoáng/nước lọc, có hoặc không ga (bao gồm nước có hương vị). KHÔNG gồm nước ngọt, nước ép hay rượu.
            · bebidas = các loại đồ uống còn lại: nước ép, nước ngọt và đồ uống có cồn (bia, rượu vang, v.v.). Nước vào "agua", sữa vào "lácteos y huevos", cà phê/trà/yerba vào "almacén".
            · snacks = kẹo, khoai tây chiên, sô-cô-la, bánh quy ngọt, kem và đồ ăn vặt.
            · limpieza = nước rửa chén, thuốc tẩy, bọt biển, giấy bếp/giấy vệ sinh và đồ vệ sinh nhà cửa.
            · cuidado personal = dầu gội, xà phòng, kem đánh răng, chất khử mùi và đồ vệ sinh cá nhân.
            · hogar = pin, bóng đèn, dụng cụ và đồ dùng bền cho nhà.
            · mascotas = thức ăn hoặc đồ dùng cho thú cưng.
            · café = đồ uống pha tại quán: espresso, americano, cortado, flat white, latte, cappuccino, mocaccino, trà, sô-cô-la nóng, submarino. (KHÔNG phải cà phê hạt/bột mua ở siêu thị: đó là "almacén".)
            · tostados y sándwiches = bánh mì nướng, sandwich, bánh cuốn, lomito, hamburger và món tương tự dùng tại chỗ.
            · pastelería = medialuna, bánh ngọt, bánh bông lan, bánh kem, cookie, scone, alfajor và đồ ngọt ở quán cà phê.
            · desayuno y bowls = bữa sáng/bữa xế, tô sữa chua hoặc granola, bánh mì nướng bơ, trứng và combo bữa sáng.
            · jugos y licuados = nước ép, sinh tố, smoothie và nước chanh ở quán cà phê.
            · otros = mọi thứ không phù hợp (bao gồm tiền tip, túi, v.v.).
    QUAN TRỌNG với QUÁN CÀ PHÊ, QUÁN BAR và NHÀ HÀNG (đồ ăn/thức uống đã pha để dùng): phân loại từng món vào nhóm quán cà phê (café, tostados y sándwiches, pastelería, desayuno y bowls, jugos y licuados), KHÔNG vào nhóm siêu thị. Để có thể so sánh giá giữa các quán, đặt tên sản phẩm NGẮN và CHUẨN trong "name" (ví dụ: "Latte", "Cappuccino", "Tostado", "Medialuna", "Nước cam"), không thêm kích cỡ hay giải thích dài; nếu có hương vị/đặc biệt có thể giữ một từ (ví dụ: "Latte hương vị").
    * Nếu là CHỨNG TỪ của một khoản trừ duy nhất KHÔNG có chi tiết sản phẩm (ví dụ thông báo DiDi, chuyển khoản, ghi nợ), trả về items là mảng RỖNG []. KHÔNG bịa sản phẩm và không phân loại vào nhóm siêu thị.

Quy tắc:
- Bỏ qua các dòng không phải sản phẩm (tạm tính, chiết khấu chung, phương thức thanh toán, mã số thuế, v.v.). Có thể phản ánh chiết khấu bằng cách trừ vào line_total của sản phẩm nếu phù hợp.
- Khi có sản phẩm, tổng các line_total nên xấp xỉ total. Nếu không khớp hoàn toàn, ưu tiên tổng thực tế trên chứng từ.
- CHỈ trả về JSON, không thêm văn bản hay markdown.`;

interface ReceiptFile {
  base64: string;
  mimeType: string;
}

async function parseReceipt(
  files: ReceiptFile[],
  categories: string[],
): Promise<ParsedReceipt> {
  const today = new Date().toISOString().slice(0, 10);

  // One block per file, in upload order. A long ticket split across several
  // photos arrives here as multiple images that describe the SAME receipt.
  const fileBlocks = files.map((f) => {
    const isPdf = f.mimeType === "application/pdf";
    return isPdf
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.base64 } }
      : { type: "image", source: { type: "base64", media_type: f.mimeType, data: f.base64 } };
  });

  const closing = files.length > 1
    ? `Estas ${files.length} imágenes son fotos de UN MISMO comprobante largo, en orden. Leélas como un único ticket continuo: NO dupliques productos que aparezcan repetidos por el solapamiento entre fotos, y devolvé UN solo JSON con todos los productos y el total final del comprobante.`
    : "Leé este comprobante (ticket o captura de notificación bancaria) y devolvé el JSON.";

  const messages = [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `${SYSTEM_PROMPT}\n\nCategorías de gasto disponibles (elegí suggested_category EXACTAMENTE de esta lista): ${categories.join(", ")}\n\nFecha de hoy: ${today}`,
          cache_control: { type: "ephemeral" },
        },
        ...fileBlocks,
        { type: "text", text: closing },
      ],
    },
  ];

  // Forced tool use: the API guarantees the reply is a structured tool call
  // matching this schema, so the model can never answer with prose.
  const receiptTool = {
    name: "registrar_comprobante",
    description: "Registra los datos extraídos del comprobante de gasto.",
    input_schema: {
      type: "object",
      properties: {
        merchant: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD" },
        total: { type: "number" },
        currency: { type: "string", enum: CURRENCIES },
        suggested_category: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              qty: { type: "number" },
              line_total: { type: "number" },
              group: { type: "string", enum: GROUPS },
            },
            required: ["name", "qty", "line_total", "group"],
          },
        },
      },
      required: ["merchant", "date", "total", "currency", "suggested_category", "items"],
    },
  };

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
      tools: [receiptTool],
      tool_choice: { type: "tool", name: "registrar_comprobante" },
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const toolUse = (data.content ?? []).find((b: { type: string }) => b.type === "tool_use");
  if (!toolUse?.input) {
    throw new Error("No se pudo leer el comprobante. Probá con una foto más nítida y completa.");
  }
  const parsed = toolUse.input as ParsedReceipt;

  // Normalize. Money keeps up to 2 decimals (a USD proof may have cents); the
  // currency is constrained to what the app supports, defaulting to ARS.
  const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
  parsed.total = round2(parsed.total);
  parsed.currency = CURRENCIES.includes(String(parsed.currency).toUpperCase())
    ? String(parsed.currency).toUpperCase()
    : "ARS";
  parsed.items = (parsed.items ?? []).map((it) => ({
    name: String(it.name ?? "").slice(0, 120),
    qty: Number(it.qty) || 1,
    line_total: round2(it.line_total),
    group: GROUPS.includes(String(it.group)) ? String(it.group) : "otros",
  }));
  if (!parsed.date || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.date)) parsed.date = today;
  if (!parsed.merchant) parsed.merchant = "";
  return parsed;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
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

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return new Response(JSON.stringify({ error: "No autorizado" }), { status: 401, headers: { ...CORS, "Content-Type": "application/json" } });

    const { data: profile } = await supabase
      .from("profiles").select("household_id").eq("id", user.id).single();
    if (!profile?.household_id) return new Response(JSON.stringify({ error: "Sin hogar" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });

    const body = await req.json();
    // Accept the new multi-photo shape (file_paths) and the legacy single one.
    const filePaths: string[] = Array.isArray(body.file_paths)
      ? body.file_paths.filter((p: unknown) => typeof p === "string")
      : body.file_path ? [body.file_path] : [];
    if (filePaths.length === 0) return new Response(JSON.stringify({ error: "file_path requerido" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });

    const files: ReceiptFile[] = [];
    for (const fp of filePaths) {
      const { data: fileData, error: dlErr } = await serviceClient.storage.from("statements").download(fp);
      if (dlErr || !fileData) throw new Error(`Error descargando archivo: ${dlErr?.message}`);

      const arrayBuffer = await fileData.arrayBuffer();
      const bytes = new Uint8Array(arrayBuffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }
      files.push({ base64: btoa(binary), mimeType: fileData.type || "image/jpeg" });
    }

    const { data: categories = [] } = await serviceClient
      .from("categories").select("name").eq("household_id", profile.household_id).eq("kind", "expense");
    const catNames = (categories ?? []).map((c: { name: string }) => c.name);

    const parsed = await parseReceipt(files, catNames);

    return new Response(JSON.stringify({ ok: true, receipt: parsed }), { headers: { ...CORS, "Content-Type": "application/json" } });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("parse-receipt error:", msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
