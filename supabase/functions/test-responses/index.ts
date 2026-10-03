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
  if (req.method !== "POST") return json({ ok: false, error: "POST required" }, 405);

  const expectedToken = Deno.env.get("RESPONSES_TEST_TOKEN") ?? "";
  const receivedToken = req.headers.get("x-test-token") ?? "";
  if (!expectedToken || receivedToken !== expectedToken) {
    return json({ ok: false, error: "Unauthorized test request" }, 401);
  }

  const apiKey = Deno.env.get("RESPONSES_API_KEY") ?? "";
  const baseUrl = (Deno.env.get("RESPONSES_BASE_URL") ?? "").replace(/\/+$/, "");
  const model = Deno.env.get("RESPONSES_MODEL") ?? "";
  const configured = { hasApiKey: Boolean(apiKey), baseUrl, model };

  if (!apiKey || !baseUrl || !model) {
    return json({ ok: false, error: "Missing Responses API configuration", configured }, 500);
  }

  try {
    const upstream = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        input: "Reply with exactly: RESPONSES_OK",
        max_output_tokens: 20,
      }),
    });

    const text = await upstream.text();
    let response: unknown;
    try {
      response = JSON.parse(text);
    } catch {
      response = { raw: text.slice(0, 2000) };
    }

    return json({
      ok: upstream.ok,
      upstreamStatus: upstream.status,
      configured,
      response,
    }, upstream.ok ? 200 : 502);
  } catch (error) {
    return json({
      ok: false,
      configured,
      error: error instanceof Error ? error.message : String(error),
    }, 502);
  }
});
