// Quick test: verify Gemini API key works with the OpenAI-compatible endpoint
// Run: node --import tsx src/scripts/testLLM.ts

const API_KEY = process.env.LLM_API_KEY;
const BASE_URL = process.env.LLM_BASE_URL || "https://generativelanguage.googleapis.com/v1beta/openai";
const MODEL = process.env.LLM_MODEL || "gemini-2.5-flash";

async function main() {
  if (!API_KEY) {
    console.error("❌ LLM_API_KEY is required. Set it in your environment before running this script.");
    process.exit(1);
  }

  console.log(`Testing LLM connection...`);
  console.log(`  URL: ${BASE_URL}/chat/completions`);
  console.log(`  Model: ${MODEL}`);
  console.log();

  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${API_KEY}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.1,
      max_tokens: 200,
      messages: [
        { role: "system", content: "Respond with valid JSON only." },
        { role: "user", content: 'Return exactly: {"status": "ok", "model": "gemini"}' },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error(`❌ API error (${res.status}): ${err}`);
    process.exit(1);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;

  console.log(`✅ API responded successfully`);
  console.log(`  Model used: ${data.model}`);
  console.log(`  Response: ${content}`);
  console.log(`  Usage: ${JSON.stringify(data.usage)}`);
}

main().catch((err) => {
  console.error("❌ Failed:", err.message);
  process.exit(1);
});
