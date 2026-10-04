import "jsr:@supabase/functions-js/edge-runtime.d.ts";

export interface ResponsesFunctionTool {
  type: "function";
  name: string;
  description?: string;
  parameters: Record<string, unknown>;
  strict?: boolean;
}

export interface ResponsesFunctionCall {
  id?: string;
  call_id?: string;
  name: string;
  arguments: string;
}

export interface ResponsesFunctionOutput {
  type: "function_call_output";
  call_id: string;
  output: string;
}

export interface ResponsesResult {
  raw: Record<string, unknown>;
  text: string;
  functionCalls: ResponsesFunctionCall[];
  responseId: string | null;
}

export interface ResponsesRequest {
  input: unknown;
  instructions?: string;
  maxOutputTokens?: number;
  tools?: ResponsesFunctionTool[];
  toolChoice?: unknown;
  previousResponseId?: string;
}

export interface InputTextPart {
  type: "input_text";
  text: string;
}

export interface InputImagePart {
  type: "input_image";
  image_url: string;
}

export interface InputFilePart {
  type: "input_file";
  filename?: string;
  file_data: string;
}

export type ResponsesInputPart = InputTextPart | InputImagePart | InputFilePart | ResponsesFunctionOutput;

export function responsesConfig(): { apiKey: string; baseUrl: string; model: string } {
  const apiKey = Deno.env.get("RESPONSES_API_KEY")?.trim() ?? "";
  const baseUrl = (Deno.env.get("RESPONSES_BASE_URL")?.trim() ?? "").replace(/\/+$/, "");
  const model = Deno.env.get("RESPONSES_MODEL")?.trim() ?? "";
  if (!apiKey || !baseUrl || !model) {
    throw new Error("Responses API configuration is incomplete");
  }
  return { apiKey, baseUrl, model };
}

export async function responsesRequest(request: ResponsesRequest): Promise<ResponsesResult> {
  const { apiKey, baseUrl, model } = responsesConfig();
  const body: Record<string, unknown> = {
    model,
    input: request.input,
    max_output_tokens: request.maxOutputTokens ?? 1024,
  };
  if (request.instructions) body.instructions = request.instructions;
  if (request.tools?.length) body.tools = request.tools;
  if (request.toolChoice) body.tool_choice = request.toolChoice;
  if (request.previousResponseId) body.previous_response_id = request.previousResponseId;

  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });
  const rawText = await response.text();
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(rawText) as Record<string, unknown>;
  } catch {
    raw = { raw: rawText.slice(0, 4000) };
  }
  if (!response.ok) {
    console.error("Responses API request failed", { status: response.status, raw });
    throw new Error(`Responses API error ${response.status}`);
  }
  return {
    raw,
    text: responseText(raw),
    functionCalls: responseFunctionCalls(raw),
    responseId: typeof raw.id === "string" ? raw.id : null,
  };
}

export function responseText(raw: Record<string, unknown>): string {
  if (typeof raw.output_text === "string") return raw.output_text;
  const output = Array.isArray(raw.output) ? raw.output : [];
  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? (item as Record<string, unknown>).content as unknown[]
      : [];
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const text = (block as Record<string, unknown>).text;
      if (typeof text === "string") parts.push(text);
    }
    const itemText = (item as Record<string, unknown>).text;
    if (typeof itemText === "string") parts.push(itemText);
  }
  return parts.join("\n").trim();
}

export function responseFunctionCalls(raw: Record<string, unknown>): ResponsesFunctionCall[] {
  const output = Array.isArray(raw.output) ? raw.output : [];
  return output.flatMap((item): ResponsesFunctionCall[] => {
    if (!item || typeof item !== "object") return [];
    const block = item as Record<string, unknown>;
    if (block.type !== "function_call" && block.type !== "tool_call") return [];
    if (typeof block.name !== "string") return [];
    const args = typeof block.arguments === "string"
      ? block.arguments
      : JSON.stringify(block.arguments ?? {});
    return [{
      id: typeof block.id === "string" ? block.id : undefined,
      call_id: typeof block.call_id === "string" ? block.call_id : undefined,
      name: block.name,
      arguments: args,
    }];
  });
}

export function parseJson<T>(text: string, fallback: T): T {
  let cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const objectStart = cleaned.indexOf("{");
  const objectEnd = cleaned.lastIndexOf("}");
  const arrayStart = cleaned.indexOf("[");
  const arrayEnd = cleaned.lastIndexOf("]");
  if (arrayStart !== -1 && arrayEnd > arrayStart && (objectStart === -1 || arrayStart < objectStart)) {
    cleaned = cleaned.slice(arrayStart, arrayEnd + 1);
  } else if (objectStart !== -1 && objectEnd > objectStart) {
    cleaned = cleaned.slice(objectStart, objectEnd + 1);
  }
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return fallback;
  }
}

export function functionTool(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
): ResponsesFunctionTool {
  return { type: "function", name, description, parameters };
}

export function inputText(text: string): InputTextPart {
  return { type: "input_text", text };
}

export function functionOutput(callId: string, output: unknown): ResponsesFunctionOutput {
  return { type: "function_call_output", call_id: callId, output: typeof output === "string" ? output : JSON.stringify(output) };
}

export function inputImage(data: string, mimeType: string): InputImagePart {
  return { type: "input_image", image_url: `data:${mimeType};base64,${data}` };
}

export function inputFile(data: string, mimeType: string, filename?: string): InputFilePart {
  return { type: "input_file", file_data: `data:${mimeType};base64,${data}`, ...(filename ? { filename } : {}) };
}
