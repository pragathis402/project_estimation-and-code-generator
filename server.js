import express from 'express';
import fetch from 'node-fetch';
import dotenv from 'dotenv';
import path from 'path';
import cors from 'cors';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// --- Correct __dirname for ES modules ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

/**
 * Robust JSON extractor
 * Handles extra text before/after JSON (Gemini common behavior)
 */
function extractJSON(text) {
  try {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start === -1 || end === -1) {
      throw new Error("JSON not found");
    }
    const jsonString = text.substring(start, end + 1);
    return JSON.parse(jsonString);
  } catch {
    throw new Error("Failed to parse JSON from AI response.");
  }
}

/**
 * Fetch with retry (503 only)
 * Skips retry for 429 (quota exceeded)
 */
async function fetchWithRetry(url, options, retries = 3, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    const response = await fetch(url, options);

    if (response.ok) return response;

    if (response.status === 429) {
      const body = await response.text();
      console.error("🚫 Quota exceeded:", body);
      throw new Error("Quota exceeded. Please try again later.");
    }

    if (response.status === 503) {
      console.warn(`⚠️ Model overloaded (${i + 1}/${retries}), retrying...`);
      await new Promise(r => setTimeout(r, delay));
      continue;
    }

    const errorBody = await response.text();
    throw new Error(`Google API failed (${response.status}): ${errorBody}`);
  }

  throw new Error("Model overloaded after multiple retries.");
}

// --- Generate endpoint ---
app.post("/generate", async (req, res) => {
  try {
    const topic = req.body.topic || req.body.prompt;
    const API_KEY = process.env.GOOGLE_API_KEY;

    if (!API_KEY) {
      throw new Error("GOOGLE_API_KEY missing in .env");
    }

    if (!topic) {
      return res.status(400).json({ error: "Topic or prompt is required." });
    }

    /**
     * Model priority:
     * 1. Gemini 3.0 (try if enabled)
     * 2. Flash-lite (best free-tier reliability)
     * 3. Flash
     * 4. Pro (usually quota-blocked)
     */
    const MODELS = [
      "gemini-3.0",
      "gemini-2.5-flash-lite",
      "gemini-2.5-flash",
      "gemini-2.5-pro"
    ];

    const prompt = `
You are an expert web developer.
Generate a complete modern single-page website for topic: "${topic}"

Return ONLY valid JSON:
{"html":"...","css":"...","js":"..."}

Each section must be at least 50 lines.
No markdown. No explanation.
`;

    let finalResponse = null;

    for (const model of MODELS) {
      const API_URL =
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`;

      console.log(`🔹 Trying model: ${model}`);

      try {
        const response = await fetchWithRetry(API_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            safetySettings: [
              { category: "HARM_CATEGORY_HARASSMENT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_HATE_SPEECH", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_SEXUALLY_EXPLICIT", threshold: "BLOCK_NONE" },
              { category: "HARM_CATEGORY_DANGEROUS_CONTENT", threshold: "BLOCK_NONE" }
            ]
          })
        });

        const data = await response.json();

        if (!data?.candidates?.[0]?.content?.parts?.[0]?.text) {
          throw new Error("Invalid Gemini response structure.");
        }

        finalResponse = extractJSON(
          data.candidates[0].content.parts[0].text
        );

        console.log(`✅ Success using model: ${model}`);
        break;

      } catch (err) {
        console.error(`❌ ${model} failed: ${err.message}`);
      }
    }

    if (!finalResponse) {
      throw new Error(
        "All Gemini models are unavailable or quota exhausted."
      );
    }

    res.json(finalResponse);

  } catch (error) {
    console.error("❌ Generation error:", error.message);
    res.status(503).json({ error: error.message });
  }
});

// --- Start server ---
app.listen(port, () => {
  console.log(`🚀 Server running at http://localhost:${port}`);
});
