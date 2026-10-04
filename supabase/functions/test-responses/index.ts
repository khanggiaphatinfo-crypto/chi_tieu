import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-test-token, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: corsHeaders });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "Chỉ hỗ trợ POST" }, 405);

  const expectedToken = Deno.env.get("RESPONSES_TEST_TOKEN") ?? "";
  const receivedToken = req.headers.get("x-test-token") ?? "";
  if (!expectedToken || receivedToken !== expectedToken) {
    return json({ ok: false, error: "Yêu cầu kiểm tra không hợp lệ" }, 401);
  }

  // This diagnostic function is intentionally disabled in ordinary deployments.
  // Keep the implementation out of the production surface; provider diagnostics
  // must be exercised locally or from an explicitly isolated test project.
  return json({ ok: false, error: "Tính năng kiểm tra đã bị tắt" }, 404);
});
