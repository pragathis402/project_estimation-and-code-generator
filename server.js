import express from "express";
import fetch from "node-fetch";
import dotenv from "dotenv";
import path from "path";
import cors from "cors";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const port = process.env.PORT || 3000;

// ES module dirname fix
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Middleware
app.use(cors());
app.use(express.json());

// ===============================
// ✅ STATIC FILES (optional frontend)
// ===============================
app.use(express.static(path.join(__dirname, "public")));

// ===============================
// ✅ ROOT ROUTE FIX (IMPORTANT)
// ===============================
app.get("/", (req, res) => {
  res.send("🚀 Server is running successfully. Use POST /generate");
});

/**
 * Robust JSON extractor
 */
function extractJSON(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1) {
    throw new Error("JSON not found in AI response");
  }
  return JSON.parse(text.substring(start, end + 1));
}

/**
 * Fetch with retry
 */
async function fetchWithRetry(url, options, retries = 3, delay = 2000) {
  for (let i = 0; i < retries; i++) {
    const response = await fetch(url, options);

    if (response.ok) return response;

    if (response.status === 429) {
      throw new Error("Quota exceeded. Try again later.");
    }

    if (response.status === 503) {
      await new Promise(r => setTimeout(r, delay));
      continue;
    }

    throw new Error(`Google API error ${response.status}`);
  }
  throw new Error("Model overloaded after retries");
}

// ===============================
// 🔥 GENERATE ENDPOINT
// ===============================
app.post("/generate", async (req, res) => {
  try {
    const topic = req.body.topic || req.body.prompt;
    const API_KEY = process.env.GOOGLE_API_KEY;

    if (!API_KEY) throw new Error("GOOGLE_API_KEY missing");
    if (!topic) return res.status(400).json({ error: "Prompt required" });

    const MODELS = [
      "gemini-2.5-flash-lite",
      "gemini-2.5-flash",
      "gemini-2.5-pro"
    ];

    const prompt = `
You are an expert web developer.
Generate a modern single-page website for: "${topic}"

Return ONLY valid JSON:
{"html":"...","css":"...","js":"..."}
`;

    let result = null;

    for (const model of MODELS) {
      try {
        const response = await fetchWithRetry(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }]
            })
          }
        );

        const data = await response.json();
        result = extractJSON(
          data.candidates[0].content.parts[0].text
        );
        break;

      } catch (err) {
        console.warn(`⚠️ ${model} failed`);
      }
    }

    if (!result) {
      throw new Error("All Gemini models unavailable or quota exhausted");
    }

    res.json(result);

  } catch (err) {
    res.status(503).json({ error: err.message });
  }
});

// ===============================
// 🚀 START SERVER
// ===============================
app.listen(port, () => {
  console.log(`🚀 Server running on port ${port}`);
});
