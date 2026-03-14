// ═══════════════════════════════════════════════════════════
// LLM Client — Minimal provider-agnostic LLM caller
// ═══════════════════════════════════════════════════════════
//
// Uses native fetch. No SDK dependencies.
// Supports OpenAI-compatible APIs (OpenAI, OpenRouter, Gemini, local).
//
// Configure via environment variables:
//   LLM_API_KEY     — API key
//   LLM_BASE_URL    — Base URL (see examples below)
//   LLM_MODEL       — Model to use (default: gemini-2.5-flash)
//
// Provider examples:
//   OpenAI:     LLM_BASE_URL=https://api.openai.com/v1
//   Gemini:     LLM_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai
//   OpenRouter: LLM_BASE_URL=https://openrouter.ai/api/v1
//   Ollama:     LLM_BASE_URL=http://localhost:11434/v1

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMResponse {
  content: string;
  model: string;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface LLMClientConfig {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}

function getConfig(): Required<LLMClientConfig> {
  return {
    apiKey: process.env.LLM_API_KEY ?? "",
    baseUrl: process.env.LLM_BASE_URL ?? "https://generativelanguage.googleapis.com/v1beta/openai",
    model: process.env.LLM_MODEL ?? "gemini-2.5-flash",
  };
}

/**
 * Call an OpenAI-compatible chat completion endpoint.
 *
 * Works with: OpenAI, Gemini, OpenRouter, LM Studio, Ollama (with /v1), etc.
 * For Anthropic native API, a separate adapter would be needed.
 */
export async function chatCompletion(
  messages: LLMMessage[],
  options?: {
    model?: string;
    temperature?: number;
    max_tokens?: number;
    response_format?: { type: "json_object" };
  }
): Promise<LLMResponse> {
  const config = getConfig();

  if (!config.apiKey) {
    throw new Error(
      "LLM_API_KEY not set. Configure it in your environment to enable the Master Orchestrator Planner."
    );
  }

  const model = options?.model ?? config.model;
  const url = `${config.baseUrl}/chat/completions`;

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: options?.temperature ?? 0.2,
    max_tokens: options?.max_tokens ?? 2000,
  };

  if (options?.response_format) {
    body.response_format = options.response_format;
  }

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`LLM API error (${res.status}): ${errorText}`);
  }

  const data = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
    model: string;
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  };

  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("LLM returned empty response");
  }

  return {
    content,
    model: data.model,
    usage: data.usage,
  };
}
