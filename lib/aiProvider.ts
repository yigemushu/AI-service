type AiProvider = "openai" | "openai-compatible";

type AiProviderInput = {
  prompt: string;
  schema: unknown;
  responseMode?: "fast" | "full";
  minOutputTokens?: number;
};

type ResponsesApiPayload = {
  output_text?: string;
  output?: Array<{ content?: Array<{ text?: string }> }>;
};

type ChatCompletionPayload = {
  choices?: Array<{ message?: { content?: string } }>;
};

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function safeString(value: unknown) {
  return typeof value === "string" ? value : String(value ?? "");
}

function safeLower(value: unknown) {
  return safeString(value).toLowerCase();
}

function getProvider() {
  const raw = safeLower(process.env.AI_PROVIDER || "openai");
  return raw === "openai-compatible" ? "openai-compatible" : "openai";
}

function readResponsesText(response: unknown) {
  const data = response as ResponsesApiPayload;
  if (data.output_text) return data.output_text;
  return data.output?.flatMap((item) => item.content || []).map((content) => content.text || "").join("") || "";
}

function readChatCompletionText(response: unknown) {
  const data = response as ChatCompletionPayload;
  return data.choices?.[0]?.message?.content || "";
}

export async function callAiProvider(input: AiProviderInput) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured");

  const provider = getProvider();
  const model = process.env.OPENAI_FAST_MODEL || process.env.OPENAI_MODEL || "gpt-4.1-mini";
  const timeoutMs = Number(process.env.OPENAI_TIMEOUT_MS || "18000");
  const configuredMaxOutputTokens = Number(process.env.OPENAI_MAX_OUTPUT_TOKENS || (input.responseMode === "full" ? "1100" : "800"));
  const maxOutputTokens = Math.max(configuredMaxOutputTokens, input.minOutputTokens || 0);
  const baseUrl = normalizeBaseUrl(process.env.OPENAI_BASE_URL || "https://api.openai.com/v1");

  if (provider === "openai-compatible") {
    return callOpenAICompatible({ apiKey, baseUrl, model, maxOutputTokens, prompt: input.prompt, timeoutMs });
  }

  return callOpenAIResponses({ apiKey, baseUrl, model, maxOutputTokens, prompt: input.prompt, schema: input.schema, timeoutMs });
}

async function callOpenAIResponses({
  apiKey,
  baseUrl,
  maxOutputTokens,
  model,
  prompt,
  schema,
  timeoutMs,
}: {
  apiKey: string;
  baseUrl: string;
  maxOutputTokens: number;
  model: string;
  prompt: string;
  schema: unknown;
  timeoutMs: number;
}) {
  const response = await fetch(`${baseUrl}/responses`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: "You are a fast customer-service order assistant. Extract facts and draft a reply. Return only valid JSON that matches the schema.",
        },
        { role: "user", content: prompt },
      ],
      text: { format: { type: "json_schema", name: "customer_order_analysis", strict: true, schema } },
      max_output_tokens: maxOutputTokens,
      temperature: 0.2,
      store: false,
    }),
  });
  if (!response.ok) throw new Error(`OpenAI request failed: ${response.status} ${await response.text()}`);
  const outputText = readResponsesText(await response.json());
  if (!outputText) throw new Error("OpenAI returned empty output");
  return outputText;
}

async function callOpenAICompatible({
  apiKey,
  baseUrl,
  maxOutputTokens,
  model,
  prompt,
  timeoutMs,
}: {
  apiKey: string;
  baseUrl: string;
  maxOutputTokens: number;
  model: string;
  prompt: string;
  timeoutMs: number;
}) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: "You are a fast customer-service order assistant. Return only valid JSON. Do not wrap it in markdown.",
        },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      max_tokens: maxOutputTokens,
      temperature: 0.2,
    }),
  });
  if (!response.ok) throw new Error(`OpenAI-compatible request failed: ${response.status} ${await response.text()}`);
  const outputText = readChatCompletionText(await response.json());
  if (!outputText) throw new Error("OpenAI-compatible provider returned empty output");
  return outputText;
}
