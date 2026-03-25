"use strict";

// ─────────────────────────────────────────────────────────────────────────────
//  VHX BOT  —  Fully Upgraded index.js
//  Features:
//    • Long-term memory via Supabase (preferences, chat history, server context)
//    • Tool-use: web search (SerpAPI), calculator, weather, code execution
//    • Auto-moderation AI
//    • AI-generated quizzes / events
//    • Smart model routing
//    • /review now returns the fixed file automatically (no need for /fix)
//    • Raw code pasting in Discord (no file required)
//    • Autonomous mode (multi-step tool reasoning loop)
// ─────────────────────────────────────────────────────────────────────────────

const dotenv   = require("dotenv");
dotenv.config({ path: require("path").join(process.cwd(), "env") });
dotenv.config();

const {
  Client, GatewayIntentBits, Partials, EmbedBuilder,
  SlashCommandBuilder, REST, Routes, ActivityType
} = require("discord.js");
const OpenAI   = require("openai").default ?? require("openai");
const axios    = require("axios").default ?? require("axios");
const { createClient } = require("@supabase/supabase-js");
const express  = require("express");
const fs       = require("fs");
const path     = require("path");
const vm       = require("vm");

// ─── Environment ──────────────────────────────────────────────────────────────
const DISCORD_TOKEN              = process.env.DISCORD_TOKEN;
const VHXAI_TOKEN                = process.env.VHXAI_TOKEN;
const GUILD_ID                   = process.env.GUILD_ID;
const EXECUTION_COUNT_CHANNEL_ID = process.env.EXECUTION_COUNT_CHANNEL_ID;
const BOT_COMMANDS_CHANNEL_ID    = process.env.BOT_COMMANDS_CHANNEL_ID;
const CHAT_CHANNEL_ID            = process.env.CHAT_CHANNEL_ID;
const ADMIN_DISCORD_ID           = process.env.ADMIN_DISCORD_ID;
const VHXBOT_API_KEY             = process.env.VHXBOT_API_KEY;
const VHXAI_API_KEY              = process.env.VHXAI_API_KEY;
const VHXBOT_PROVIDER            = process.env.VHXBOT_PROVIDER  || "openrouter";
const VHXAI_PROVIDER             = process.env.VHXAI_PROVIDER   || "openrouter";
const SERP_API_KEY               = process.env.SERP_API_KEY      || "";
const WEATHER_API_KEY            = process.env.WEATHER_API_KEY   || "";
const AUTOMOD_CHANNEL_ID         = process.env.AUTOMOD_CHANNEL_ID || "";
let   AUTOMOD_ENABLED            = process.env.AUTOMOD_ENABLED   === "true";

// ─── Supabase ──────────────────────────────────────────────────────────────────
let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set.");
    _supabase = createClient(url, key);
  }
  return _supabase;
}

// ─── Long-term Memory ─────────────────────────────────────────────────────────
// Requires Supabase table:  bot_memory (user_id TEXT PK, history JSONB, preferences JSONB, server_context JSONB, updated_at TIMESTAMPTZ)
async function loadMemory(userId) {
  try {
    const { data } = await getSupabase().from("bot_memory").select("*").eq("user_id", userId).single();
    return data || { history: [], preferences: {}, server_context: {} };
  } catch { return { history: [], preferences: {}, server_context: {} }; }
}
async function saveMemory(userId, memory) {
  try {
    await getSupabase().from("bot_memory").upsert({ user_id: userId, ...memory, updated_at: new Date().toISOString() });
  } catch (e) { console.warn("⚠️ Memory save failed:", e.message); }
}
async function updatePreference(userId, key, value) {
  const mem = await loadMemory(userId);
  mem.preferences = mem.preferences || {};
  mem.preferences[key] = value;
  await saveMemory(userId, mem);
}

// In-memory history fallback
const userHistory = new Map();

// ─── OpenRouter Keys ──────────────────────────────────────────────────────────
function getAllOpenRouterKeys() {
  const keys = []; const seen = new Set();
  for (const [k, v] of Object.entries(process.env)) {
    if (!v) continue;
    const val = v.trim();
    if (!val || val.includes("YOUR_") || val === "undefined" || val === "null") continue;
    if (k === "OPENROUTER_API_KEY" || k.startsWith("OPENROUTER_API_KEY_") || k === "API_KEY" || k === "VHXBOT_API_KEY" || k === "VHXAI_API_KEY") {
      if (!seen.has(val)) { seen.add(val); keys.push(val); }
    }
  }
  return keys;
}
function createOpenRouterClient(apiKey) {
  return new OpenAI({ baseURL:"https://openrouter.ai/api/v1", apiKey, defaultHeaders:{ "HTTP-Referer":"https://discord.com", "X-Title":"VHX Bot Assistant" } });
}
async function withFallback(keys, fn) {
  if (!keys.length) throw new Error("No OpenRouter API keys found.");
  let lastError;
  for (let i = 0; i < keys.length; i++) {
    try { if (i > 0) console.log(`🔄 Retrying key #${i+1}`); return await fn(createOpenRouterClient(keys[i]), keys[i]); }
    catch (e) { console.warn(`⚠️ Key #${i+1} failed: ${e.message}`); lastError = e; }
  }
  throw new Error(`All keys exhausted. Last: ${lastError?.message}`);
}

// ─── Model Routing ─────────────────────────────────────────────────────────────
const modelCache = { text:[], image:[], vision:[], audio:[], video:[], all:[], fetchedAt:0 };
const CACHE_TTL  = 60 * 60 * 1000;
const TEXT_MODEL_PRIORITY   = ["nvidia/nemotron-3-super-120b-a12b:free","openai/gpt-oss-120b:free","meta-llama/llama-3.3-70b-instruct:free","minimax/minimax-m2.5:free","stepfun/step-3.5-flash:free","google/gemma-3-27b-it:free"];
const CODE_MODEL_PRIORITY   = ["openai/gpt-oss-120b:free","qwen/qwen3-coder:free","nvidia/nemotron-3-super-120b-a12b:free","meta-llama/llama-3.3-70b-instruct:free","openai/gpt-oss-20b:free"];
const IMAGE_MODEL_PRIORITY  = ["google/gemini-2.5-flash-image","black-forest-labs/flux.2-pro","black-forest-labs/flux.2-flex"];
const AUDIO_MODEL_PRIORITY  = ["openai/tts-1","openai/tts-1-hd"];
const VIDEO_MODEL_PRIORITY  = ["minimax/video-01","wan-ai/wan2.1-t2v-turbo"];
const VISION_MODEL_PRIORITY = ["nvidia/nemotron-nano-12b-v2-vl:free","nvidia/llama-nemotron-embed-vl-1b-v2:free","google/gemma-3-27b-it:free"];
const FAST_MODEL            = "meta-llama/llama-3.3-70b-instruct:free";

async function fetchModelCatalog() {
  if (Date.now() - modelCache.fetchedAt < CACHE_TTL && modelCache.all.length) return;
  try {
    const r = await axios.get("https://openrouter.ai/api/v1/models");
    modelCache.all    = r.data.data || [];
    modelCache.text   = modelCache.all.filter(m => (m.architecture?.output_modalities||[]).includes("text") && !(m.architecture?.output_modalities||[]).includes("image") && !(m.architecture?.input_modalities||[]).includes("image"));
    modelCache.image  = IMAGE_MODEL_PRIORITY.map(id => ({ id }));
    modelCache.vision = VISION_MODEL_PRIORITY.map(id => ({ id }));
    modelCache.audio  = AUDIO_MODEL_PRIORITY.map(id => ({ id }));
    modelCache.video  = VIDEO_MODEL_PRIORITY.map(id => ({ id }));
    modelCache.fetchedAt = Date.now();
    console.log(`✅ Model catalog loaded — text:${modelCache.text.length}`);
  } catch (e) { console.warn("⚠️ Model catalog fetch failed:", e.message); }
}
function pickBest(priority, available, fallback) {
  if (!available.length) return fallback;
  const ids = new Set(available.map(m => m.id));
  for (const p of priority) if (ids.has(p)) return p;
  return available[0]?.id || fallback;
}
async function getBestTextModel()    { await fetchModelCatalog(); return pickBest(TEXT_MODEL_PRIORITY,   modelCache.text,   TEXT_MODEL_PRIORITY[0]); }
async function getBestCodeModel()    { await fetchModelCatalog(); return pickBest(CODE_MODEL_PRIORITY,   modelCache.text,   CODE_MODEL_PRIORITY[0]); }
async function getBestImageModel(p)  { await fetchModelCatalog(); return p || pickBest(IMAGE_MODEL_PRIORITY,  modelCache.image,  IMAGE_MODEL_PRIORITY[0]); }
async function getBestVisionModel()  { await fetchModelCatalog(); return pickBest(VISION_MODEL_PRIORITY, modelCache.vision, VISION_MODEL_PRIORITY[0]); }
async function getBestAudioModel()   { await fetchModelCatalog(); return pickBest(AUDIO_MODEL_PRIORITY,  modelCache.audio,  AUDIO_MODEL_PRIORITY[0]); }
async function getBestVideoModel()   { await fetchModelCatalog(); return pickBest(VIDEO_MODEL_PRIORITY,  modelCache.video,  VIDEO_MODEL_PRIORITY[0]); }

// ─── Tool Implementations ──────────────────────────────────────────────────────
async function toolWebSearch(query) {
  if (!SERP_API_KEY) return "Web search unavailable — set SERP_API_KEY in your env file.";
  try {
    const r = await axios.get("https://serpapi.com/search", { params:{ q:query, api_key:SERP_API_KEY, num:5 }, timeout:8000 });
    const results = r.data.organic_results || [];
    if (!results.length) return "No results found.";
    return results.slice(0,5).map((x,i) => `${i+1}. **${x.title}**\n${x.snippet}\n${x.link}`).join("\n\n");
  } catch (e) { return `Search error: ${e.message}`; }
}
function toolCalculate(expr) {
  try {
    const safe = expr.replace(/[^0-9+\-*/.()% \t]/g,"");
    if (!safe.trim()) return "Invalid expression.";
    const result = vm.runInNewContext(safe, {}, { timeout:500 });
    return `${expr} = ${result}`;
  } catch (e) { return `Calculation error: ${e.message}`; }
}
async function toolWeather(location) {
  if (!WEATHER_API_KEY) return "Weather unavailable — set WEATHER_API_KEY in your env file.";
  try {
    const r = await axios.get("https://api.openweathermap.org/data/2.5/weather", { params:{ q:location, appid:WEATHER_API_KEY, units:"metric" }, timeout:6000 });
    const d = r.data;
    return `**${d.name}, ${d.sys.country}** — ${d.weather[0].description}\nTemp: ${d.main.temp}°C (feels ${d.main.feels_like}°C), Humidity: ${d.main.humidity}%, Wind: ${d.wind.speed} m/s`;
  } catch (e) { return `Weather error: ${e.message}`; }
}
function toolCodeExec(code) {
  try {
    const logs = [];
    const sandbox = { console:{ log:(...a) => logs.push(a.map(String).join(" ")), error:(...a) => logs.push("ERR: "+a.join(" ")) }, Math, JSON, parseInt, parseFloat, String, Number, Boolean, Array, Object, Date };
    vm.runInNewContext(code, sandbox, { timeout:2000 });
    return logs.length ? logs.join("\n") : "(no output)";
  } catch (e) { return `Runtime error: ${e.message}`; }
}
async function dispatchTool(name, args) {
  switch (name) {
    case "web_search": return toolWebSearch(args.query);
    case "calculate":  return toolCalculate(args.expression);
    case "weather":    return toolWeather(args.location);
    case "code_exec":  return toolCodeExec(args.code);
    default:           return `Unknown tool: ${name}`;
  }
}
const AI_TOOLS = [
  { type:"function", function:{ name:"web_search",  description:"Search the web for current information.", parameters:{ type:"object", properties:{ query:{ type:"string" } }, required:["query"] } } },
  { type:"function", function:{ name:"calculate",   description:"Evaluate a math expression.",              parameters:{ type:"object", properties:{ expression:{ type:"string" } }, required:["expression"] } } },
  { type:"function", function:{ name:"weather",     description:"Get current weather for a city.",          parameters:{ type:"object", properties:{ location:{ type:"string" } }, required:["location"] } } },
  { type:"function", function:{ name:"code_exec",   description:"Run JavaScript code and return output.",   parameters:{ type:"object", properties:{ code:{ type:"string" } }, required:["code"] } } }
];

// ─── Core AI Generator (autonomous tool loop) ─────────────────────────────────
const SYSTEM_INSTRUCTION = `You are a helpful and neutral AI assistant operating within a Discord server.
- Use Discord markdown formatting where appropriate (bold, italics, code blocks, etc.)
- Keep responses concise and readable for a chat environment
- Do NOT wrap your entire response in a code block unless the user specifically asks for code
- You have tools available: web_search, calculate, weather, code_exec — use them when they genuinely help
- If the user asks for information that requires up-to-date data, use web_search`;

async function generateAI(messages, systemContext, options = {}) {
  const sysContent = systemContext ? `${SYSTEM_INSTRUCTION}\n\n${systemContext}` : SYSTEM_INSTRUCTION;
  const keys  = options.apiKey ? [options.apiKey, ...getAllOpenRouterKeys()] : getAllOpenRouterKeys();
  const model = options.model || await getBestTextModel();
  console.log(`🤖 Text model: ${model}`);
  return withFallback(keys, async (openai) => {
    const msgs = [{ role:"system", content:sysContent }, ...messages.map(m => ({ role:m.role, content:m.content }))];
    for (let iter = 0; iter < 5; iter++) {
      const response = await openai.chat.completions.create({ model, messages:msgs, tools:AI_TOOLS, tool_choice:"auto", temperature:0.8 });
      const msg = response.choices[0].message;
      if (!msg.tool_calls || !msg.tool_calls.length) return { text: msg.content || "No response.", groundingUrls: [] };
      msgs.push(msg);
      for (const tc of msg.tool_calls) {
        let args = {};
        try { args = JSON.parse(tc.function.arguments); } catch {}
        console.log(`🔧 Tool: ${tc.function.name}(${JSON.stringify(args)})`);
        const result = await dispatchTool(tc.function.name, args);
        msgs.push({ role:"tool", tool_call_id:tc.id, content:result });
      }
    }
    return { text:"Reached reasoning limit.", groundingUrls:[] };
  });
}

// ─── Code Review ──────────────────────────────────────────────────────────────
async function generateCodeReview(code, language, options = {}) {
  const keys  = options.apiKey ? [options.apiKey, ...getAllOpenRouterKeys()] : getAllOpenRouterKeys();
  const model = await getBestCodeModel();
  const sysMsg = [
    "You are an expert code reviewer. Respond with ONLY a raw JSON object, no markdown fences.",
    'Schema: {"issues":[{"severity":"critical"|"moderate"|"minor","line":number|null,"issue":string,"suggestion":string}],"summary":string,"correctedCode":string}',
    "critical=crash/security, moderate=logic/perf, minor=style.",
    "Lua: single-arg calls like 'print \"hi\"' or 'f{a=1}' are VALID — do not flag.",
    "correctedCode must be the COMPLETE fixed file."
  ].join(" ");
  const userMsg = `Review this ${language||"code"} and return JSON only:\n\`\`\`${language||""}\n${code}\n\`\`\``;
  return withFallback(keys, async (openai) => {
    const res = await openai.chat.completions.create({ model, temperature:0.1, messages:[{ role:"system", content:sysMsg },{ role:"user", content:userMsg }] });
    const raw = res.choices[0]?.message?.content;
    if (!raw) throw new Error("Model returned empty response.");
    const cleaned = raw.replace(/^```(?:json)?\n?/i,"").replace(/\n?```$/i,"").trim();
    let parsed;
    try { parsed = JSON.parse(cleaned); }
    catch { const m = cleaned.match(/\{[\s\S]*\}/); if (!m) throw new Error("No JSON found. Preview: "+raw.slice(0,150)); parsed = JSON.parse(m[0]); }
    if (!parsed.issues)        parsed.issues        = [];
    if (!parsed.summary)       parsed.summary       = "Review complete.";
    if (!parsed.correctedCode) parsed.correctedCode = code;
    return parsed;
  });
}

// ─── Code Fix ─────────────────────────────────────────────────────────────────
async function generateCodeFix(code, language, options = {}) {
  const keys  = options.apiKey ? [options.apiKey, ...getAllOpenRouterKeys()] : getAllOpenRouterKeys();
  const model = await getBestCodeModel();
  return withFallback(keys, async (openai) => {
    const res = await openai.chat.completions.create({ model, temperature:0.1, messages:[
      { role:"system", content:"You are a code fixing assistant. Output ONLY raw fixed code. No markdown fences, no explanation." },
      { role:"user",   content:`Fix ALL bugs in this ${language||"code"}. Return only the fixed code.\n\n${code}` }
    ]});
    let r = res.choices[0]?.message?.content || "";
    if (!r) throw new Error("Empty response.");
    return r.replace(/^```[\w]*\n?/i,"").replace(/\n?```$/i,"").trim();
  });
}

// ─── Image / Vision / TTS / Video ─────────────────────────────────────────────
async function generateImage(prompt, options = {}) {
  const keys  = options.apiKey ? [options.apiKey, ...getAllOpenRouterKeys()] : getAllOpenRouterKeys();
  const model = options.model || await getBestImageModel();
  return withFallback(keys, async (_, key) => {
    const res = await axios.post("https://openrouter.ai/api/v1/chat/completions",
      { model, messages:[{ role:"user", content:prompt }], modalities:["image","text"] },
      { headers:{ Authorization:`Bearer ${key}`, "Content-Type":"application/json", "HTTP-Referer":"https://discord.com", "X-Title":"VHX Bot Assistant" } }
    );
    const message = res.data?.choices?.[0]?.message;
    if (!message) throw new Error("No message in response.");
    if (message.images?.length) { const url = message.images[0]?.image_url?.url; if (url) return url; }
    const urlMatch = (message.content||"").match(/https?:\/\/\S+/);
    if (urlMatch) return urlMatch[0].replace(/[)>.,]+$/,"");
    throw new Error("OpenRouter did not return a valid image.");
  });
}
async function generateVision(prompt, imageBase64, mimeType, options = {}) {
  const keys  = options.apiKey ? [options.apiKey, ...getAllOpenRouterKeys()] : getAllOpenRouterKeys();
  const model = await getBestVisionModel();
  return withFallback(keys, async (openai) => {
    const res = await openai.chat.completions.create({ model, messages:[{ role:"user", content:[{ type:"text", text:prompt },{ type:"image_url", image_url:{ url:`data:${mimeType};base64,${imageBase64}` } }] }] });
    return res.choices[0].message.content || "No response.";
  });
}
async function generateTTS(text, options = {}) {
  const voice = ["alloy","echo","fable","onyx","nova","shimmer"].includes((options.voice||"").toLowerCase()) ? options.voice.toLowerCase() : "alloy";
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    try {
      const r = await axios.post("https://api.openai.com/v1/audio/speech", { model:"tts-1", input:text, voice }, { headers:{ Authorization:`Bearer ${openaiKey}`, "Content-Type":"application/json" }, responseType:"arraybuffer" });
      return { base64:Buffer.from(r.data).toString("base64"), model:"openai/tts-1" };
    } catch (e) { console.warn("⚠️ OpenAI TTS failed:", e.message); }
  }
  const keys  = options.apiKey ? [options.apiKey, ...getAllOpenRouterKeys()] : getAllOpenRouterKeys();
  const model = await getBestAudioModel();
  return withFallback(keys, async (openai) => {
    const res  = await openai.chat.completions.create({ model, messages:[{ role:"user", content:`Speak in voice "${voice}": ${text}` }] });
    const content = res.choices?.[0]?.message?.content || "";
    const urlMatch = content.match(/https?:\/\/\S+/);
    if (urlMatch) {
      const ar = await axios.get(urlMatch[0].replace(/[)>.,]+$/,""), { responseType:"arraybuffer" });
      return { base64:Buffer.from(ar.data).toString("base64"), model };
    }
    return { text:content, model };
  });
}

// ─── Auto-Moderation AI ───────────────────────────────────────────────────────
const AUTOMOD_SYSTEM = `You are a Discord automod AI. Analyze the message and return ONLY JSON:
{"action":"none"|"warn"|"delete","reason":string}
Flag: hate speech, harassment, doxxing, spam, NSFW content, severe toxicity. Be strict but fair.`;

async function automodCheck(content, userId) {
  if (!AUTOMOD_ENABLED) return { action:"none", reason:"" };
  try {
    const keys = getAllOpenRouterKeys();
    if (!keys.length) return { action:"none", reason:"" };
    const openai = createOpenRouterClient(keys[0]);
    const res = await openai.chat.completions.create({ model:FAST_MODEL, temperature:0, messages:[{ role:"system", content:AUTOMOD_SYSTEM },{ role:"user", content:`User ${userId}: "${content}"` }] });
    const raw = (res.choices[0]?.message?.content||"").replace(/```json?\n?/g,"").replace(/```/g,"").trim();
    return JSON.parse(raw);
  } catch { return { action:"none", reason:"" }; }
}

// ─── Quiz Generator ────────────────────────────────────────────────────────────
async function generateQuiz(topic, numQuestions = 5) {
  const keys = getAllOpenRouterKeys();
  const model = await getBestTextModel();
  const prompt = `Generate a ${numQuestions}-question multiple-choice quiz about "${topic}". Return ONLY a JSON array — no markdown, no preamble:
[{"question":string,"options":["A) ...","B) ...","C) ...","D) ..."],"answer":"A"|"B"|"C"|"D","explanation":string}]`;
  return withFallback(keys, async (openai) => {
    const res = await openai.chat.completions.create({ model, temperature:0.7, messages:[{ role:"user", content:prompt }] });
    const raw = (res.choices[0]?.message?.content||"").replace(/```json?\n?/g,"").replace(/```/g,"").trim();
    return JSON.parse(raw);
  });
}
const activeQuizzes = new Map();

// ─── Utilities ─────────────────────────────────────────────────────────────────
function fmt(n) { try { return (parseInt(String(n),10)||0).toLocaleString(); } catch { return "0"; } }
function timeAgo(d) {
  if (!d) return "never";
  const diff = Math.floor((Date.now()-new Date(d).getTime())/1000);
  if (diff < 60) return `${diff}s ago`; if (diff < 3600) return `${Math.floor(diff/60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff/3600)}h ago`; return `${Math.floor(diff/86400)}d ago`;
}
function fmtDate(d) { if (!d) return "N/A"; try { return new Date(d).toLocaleDateString("en-US",{ month:"short",day:"numeric",year:"numeric" }); } catch { return "N/A"; } }
function codeBlock(lines) { return "```\n"+lines.join("\n")+"\n```"; }
function chunkString(str, size) { const c=[]; for (let i=0;i<str.length;i+=size) c.push(str.slice(i,i+size)); return c; }
function getFileExtension(lang) {
  return ({ lua:"lua",javascript:"js",js:"js",typescript:"ts",ts:"ts",python:"py",py:"py",cpp:"cpp",csharp:"cs",java:"java",go:"go",rust:"rs",ruby:"rb",php:"php",swift:"swift",kotlin:"kt",shell:"sh",bash:"sh",html:"html",css:"css",json:"json",yaml:"yml" })[(lang||"").toLowerCase()]||"txt";
}
function detectLanguageFromUrl(url) {
  const ext=(url||"").split("?")[0].split(".").pop().toLowerCase();
  return ({ lua:"lua",js:"javascript",mjs:"javascript",ts:"typescript",tsx:"typescript",py:"python",cpp:"cpp",h:"cpp",cs:"csharp",java:"java",go:"go",rs:"rust",rb:"ruby",php:"php",swift:"swift",kt:"kotlin",sh:"shell",html:"html",css:"css" })[ext]||null;
}
function detectLanguageFromContent(code) {
  if (/^local\s|game:|workspace\.|script\.|require\(|pcall\(/.test(code)) return "lua";
  if (/^import\s|^from\s|def\s/.test(code)) return "python";
  if (/function\s*\(|const\s|let\s|=>\s*{/.test(code)) return "javascript";
  if (/public\s+(class|static|void)|System\.out/.test(code)) return "java";
  if (/#include|int main\(/.test(code)) return "cpp";
  return null;
}

// ─── Database Snapshot ─────────────────────────────────────────────────────────
async function getDatabaseSnapshot() {
  try {
    const sb = getSupabase();
    const { data: ed }  = await sb.from("game_executions").select("count");
    const totalExec     = ed?.reduce((a,r)=>a+(r.count||0),0)||0;
    const { count: tu } = await sb.from("unique_users").select("*",{ count:"exact",head:true });
    const { count: as } = await sb.from("game_status").select("*",{ count:"exact",head:true }).eq("maintenance",false);
    const { data: tg }  = await sb.from("game_executions").select("game_name,count").order("count",{ ascending:false }).limit(3);
    const topGamesStr   = tg?.map(g=>`${g.game_name} (${fmt(g.count)})`).join(", ")||"None";
    return `You are the official VHX Assistant. VHX is a Roblox script service.\nCurrent Live Stats:\n- Total Script Executions: ${fmt(totalExec)}\n- Total Unique Users: ${fmt(tu||0)}\n- Active Scripts: ${fmt(as||0)}\n- Top 3 Games: ${topGamesStr}\n\nBe helpful, concise, and professional. Direct users to /lookup [token] for profile info.`;
  } catch { return "You are the VHX Assistant. Database stats are currently loading..."; }
}

// ─── Custom Commands ───────────────────────────────────────────────────────────
const COMMANDS_FILE  = path.join(process.cwd(),"custom_commands.json");
const customCommands = new Map();
function loadCustomCommands() { try { if (fs.existsSync(COMMANDS_FILE)) { const p=JSON.parse(fs.readFileSync(COMMANDS_FILE,"utf8")); Object.entries(p).forEach(([k,v])=>customCommands.set(k.toLowerCase(),v)); console.log(`✅ Loaded ${customCommands.size} custom commands.`); } } catch(e){console.error("❌ Load custom commands:",e);} }
function saveCustomCommands() { try { fs.writeFileSync(COMMANDS_FILE,JSON.stringify(Object.fromEntries(customCommands),null,2)); } catch(e){console.error("❌ Save custom commands:",e);} }
function addCustomCommand(name,response,createdBy) { customCommands.set(name.toLowerCase(),{ name,response,createdBy }); saveCustomCommands(); }
function removeCustomCommand(name) { customCommands.delete(name.toLowerCase()); saveCustomCommands(); }
loadCustomCommands();

// ─── Logs ──────────────────────────────────────────────────────────────────────
const commandLogs = [];
function logCommand(user,avatar,command,response) {
  commandLogs.unshift({ user,avatar,command,timestamp:new Date().toISOString(),response:response.length>100?response.slice(0,100)+"...":response });
  if (commandLogs.length>50) commandLogs.pop();
}

// ─── Admin Check ───────────────────────────────────────────────────────────────
const isAdmin = (interaction) => { const id=typeof interaction==="string"?interaction:interaction.user.id; return id===ADMIN_DISCORD_ID; };

// ─── Slash Command Definitions ─────────────────────────────────────────────────
const slashCommands = [
  new SlashCommandBuilder().setName("ask").setDescription("Ask the AI (web search, calculator, weather built-in)").addStringOption(o=>o.setName("question").setDescription("Your question").setRequired(true)),
  new SlashCommandBuilder().setName("lookup").setDescription("View your profile via token").addStringOption(o=>o.setName("token").setDescription("Your token").setRequired(true)),
  new SlashCommandBuilder().setName("lookup_user").setDescription("[Admin] Look up by username").addStringOption(o=>o.setName("username").setDescription("Roblox username").setRequired(true)),
  new SlashCommandBuilder().setName("lookup_id").setDescription("[Admin] Look up by Roblox ID").addStringOption(o=>o.setName("roblox_id").setDescription("Roblox ID").setRequired(true)),
  new SlashCommandBuilder().setName("stats").setDescription("Global execution overview"),
  new SlashCommandBuilder().setName("stats_game").setDescription("Per-game stats").addStringOption(o=>o.setName("game_name").setDescription("Game name").setRequired(true)),
  new SlashCommandBuilder().setName("stats_top").setDescription("Top games by executions"),
  new SlashCommandBuilder().setName("ban").setDescription("[Admin] Ban a user").addStringOption(o=>o.setName("roblox_id").setDescription("Roblox ID").setRequired(true)).addStringOption(o=>o.setName("reason").setDescription("Reason").setRequired(true)),
  new SlashCommandBuilder().setName("unban").setDescription("[Admin] Unban a user").addStringOption(o=>o.setName("roblox_id").setDescription("Roblox ID").setRequired(true)),
  new SlashCommandBuilder().setName("maintenance").setDescription("[Admin] Toggle maintenance").addStringOption(o=>o.setName("game_name").setDescription("Game name").setRequired(true)).addBooleanOption(o=>o.setName("enabled").setDescription("On or off").setRequired(true)),
  new SlashCommandBuilder().setName("announce_add").setDescription("[Admin] Post announcement")
    .addStringOption(o=>o.setName("type").setDescription("Type").setRequired(true).addChoices({ name:"info",value:"info" },{ name:"warning",value:"warning" },{ name:"success",value:"success" },{ name:"error",value:"error" }))
    .addStringOption(o=>o.setName("message").setDescription("Message").setRequired(true)),
  new SlashCommandBuilder().setName("announce_list").setDescription("List active announcements"),
  new SlashCommandBuilder().setName("imagine").setDescription("Generate an AI image").addStringOption(o=>o.setName("prompt").setDescription("Image prompt").setRequired(true))
    .addStringOption(o=>o.setName("model").setDescription("Model override").addChoices({ name:"Riverflow v2 Pro",value:"sourceful/riverflow-v2-pro" },{ name:"Riverflow v2 Fast",value:"sourceful/riverflow-v2-fast" },{ name:"Flux.2 Klein 4B",value:"black-forest-labs/flux.2-klein-4b" })),
  new SlashCommandBuilder().setName("vision").setDescription("Analyze an image").addAttachmentOption(o=>o.setName("image").setDescription("Image to analyze").setRequired(true)).addStringOption(o=>o.setName("prompt").setDescription("What to ask").setRequired(false)),
  new SlashCommandBuilder().setName("speak").setDescription("Text to speech").addStringOption(o=>o.setName("text").setDescription("Text to speak").setRequired(true))
    .addStringOption(o=>o.setName("voice").setDescription("Voice").addChoices({ name:"Kore (Female)",value:"Kore" },{ name:"Puck (Male)",value:"Puck" },{ name:"Charon (Deep)",value:"Charon" },{ name:"Fenrir (Gruff)",value:"Fenrir" },{ name:"Zephyr (Soft)",value:"Zephyr" })),
  new SlashCommandBuilder().setName("video").setDescription("Generate a video").addStringOption(o=>o.setName("prompt").setDescription("Video prompt").setRequired(true)),
  new SlashCommandBuilder().setName("submit-script").setDescription("Submit a script for AI review").addAttachmentOption(o=>o.setName("script").setDescription("Script file").setRequired(true)),
  // UPGRADED /review — file, URL, or raw code paste. Always returns fixed file.
  new SlashCommandBuilder().setName("review").setDescription("Review & auto-fix code (file, URL, or paste)")
    .addAttachmentOption(o=>o.setName("file").setDescription("Code file").setRequired(false))
    .addStringOption(o=>o.setName("url").setDescription("URL to code").setRequired(false))
    .addStringOption(o=>o.setName("code").setDescription("Paste raw code here").setRequired(false))
    .addStringOption(o=>o.setName("language").setDescription("Language (auto-detected if omitted)").setRequired(false)),
  // /fix kept for backwards compat — also supports raw paste
  new SlashCommandBuilder().setName("fix").setDescription("Get fixed code (file, URL, or paste)")
    .addAttachmentOption(o=>o.setName("file").setDescription("Code file").setRequired(false))
    .addStringOption(o=>o.setName("url").setDescription("URL to code").setRequired(false))
    .addStringOption(o=>o.setName("code").setDescription("Paste raw code here").setRequired(false))
    .addStringOption(o=>o.setName("language").setDescription("Language (auto-detected if omitted)").setRequired(false)),
  new SlashCommandBuilder().setName("changelog_add").setDescription("[Admin] Add changelog entry")
    .addStringOption(o=>o.setName("version").setDescription("Version").setRequired(true))
    .addStringOption(o=>o.setName("title").setDescription("Title").setRequired(true))
    .addStringOption(o=>o.setName("body").setDescription("Body").setRequired(true)),
  new SlashCommandBuilder().setName("role_set").setDescription("[Admin] Set user role")
    .addStringOption(o=>o.setName("discord_id").setDescription("Discord ID").setRequired(true))
    .addStringOption(o=>o.setName("role").setDescription("Role").setRequired(true).addChoices({ name:"founder",value:"founder" },{ name:"admin",value:"admin" },{ name:"moderator",value:"moderator" })),
  // NEW COMMANDS
  new SlashCommandBuilder().setName("memory").setDescription("View or clear your AI memory").addStringOption(o=>o.setName("action").setDescription("Action").setRequired(true).addChoices({ name:"view",value:"view" },{ name:"clear",value:"clear" })),
  new SlashCommandBuilder().setName("search").setDescription("Web search with AI summary").addStringOption(o=>o.setName("query").setDescription("Search query").setRequired(true)),
  new SlashCommandBuilder().setName("weather").setDescription("Get current weather").addStringOption(o=>o.setName("location").setDescription("City name").setRequired(true)),
  new SlashCommandBuilder().setName("calc").setDescription("Calculate a math expression").addStringOption(o=>o.setName("expression").setDescription("e.g. (5+3)*2").setRequired(true)),
  new SlashCommandBuilder().setName("quiz").setDescription("Start an AI quiz").addStringOption(o=>o.setName("topic").setDescription("Quiz topic").setRequired(true)).addIntegerOption(o=>o.setName("questions").setDescription("Number of questions (1-10)").setRequired(false)),
  new SlashCommandBuilder().setName("automod").setDescription("[Admin] Toggle AI auto-moderation").addBooleanOption(o=>o.setName("enabled").setDescription("Enable or disable").setRequired(true)),
  new SlashCommandBuilder().setName("preference").setDescription("Set your AI preferences").addStringOption(o=>o.setName("key").setDescription("e.g. language, tone").setRequired(true)).addStringOption(o=>o.setName("value").setDescription("Value").setRequired(true)),
  new SlashCommandBuilder().setName("help").setDescription("List all available commands")
].map(c=>c.toJSON());

// ─── Discord Clients ───────────────────────────────────────────────────────────
const client = new Client({ intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent,GatewayIntentBits.GuildMembers,GatewayIntentBits.DirectMessages], partials:[Partials.Channel,Partials.Message] });
const vhxAI  = new Client({ intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMessages,GatewayIntentBits.MessageContent,GatewayIntentBits.DirectMessages], partials:[Partials.Channel,Partials.Message] });
const botStatus = { main:"OFFLINE", vhxAI:"OFFLINE", slashCommands:"SUPPORTED" };

// ─── Register Commands ─────────────────────────────────────────────────────────
async function registerCommands() {
  if (!DISCORD_TOKEN) return;
  const rest = new REST({ version:"10" }).setToken(DISCORD_TOKEN);
  try {
    console.log("Refreshing slash commands…");
    if (GUILD_ID) await rest.put(Routes.applicationGuildCommands(client.user?.id||"",GUILD_ID),{ body:slashCommands });
    await rest.put(Routes.applicationCommands(client.user?.id||""),{ body:slashCommands });
    console.log("✅ Commands registered."); botStatus.slashCommands="ACTIVE";
  } catch(e) { console.error("❌ Command registration failed:",e); botStatus.slashCommands="ERROR"; }
}

// ─── Counter Embed ─────────────────────────────────────────────────────────────
let counterMessage=null, lastKnownCount=null;
async function getTotalExecutions() { try { const { data }=await getSupabase().from("game_executions").select("count"); return data?.reduce((a,r)=>a+(r.count||0),0)||0; } catch { return null; } }
function buildCounterEmbed(total) { const ts=new Date().toLocaleString("en-US",{ month:"2-digit",day:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit",hour12:true }); return new EmbedBuilder().setTitle("Script Execution Counter").setColor(5793266).addFields({ name:"Total Executions", value:`\`\`\`\n${fmt(total)}\n\`\`\`` }).setFooter({ text:`Updates every 30s  •  Last updated | ${ts}` }); }
async function updateCounterEmbed() {
  if (!EXECUTION_COUNT_CHANNEL_ID) return;
  const total=await getTotalExecutions(); if (total===null) return; lastKnownCount=total;
  const channel=client.channels.cache.get(EXECUTION_COUNT_CHANNEL_ID); if (!channel) return;
  const embed=buildCounterEmbed(total);
  try {
    if (!counterMessage) { const msgs=await channel.messages.fetch({ limit:10 }); const ex=msgs.find(m=>m.author.id===client.user?.id&&m.embeds.length>0); counterMessage=ex?await ex.edit({ embeds:[embed] }):await channel.send({ embeds:[embed] }); }
    else await counterMessage.edit({ embeds:[embed] });
  } catch { counterMessage=null; }
}
async function updateChannelName() {
  if (lastKnownCount===null||!EXECUTION_COUNT_CHANNEL_ID) return;
  const channel=client.channels.cache.get(EXECUTION_COUNT_CHANNEL_ID); if (!channel) return;
  const newName=`⚡ Executions › ${fmt(lastKnownCount)}`; if (channel.name===newName) return;
  try { await channel.setName(newName); } catch(e) { if (e.status!==429) console.error("❌ Rename failed:",e); }
}

// ─── Command Logic ─────────────────────────────────────────────────────────────
async function executeCommandLogic(commandName, options, userId="DASHBOARD_TESTER", isUserAdmin=true) {
  if (customCommands.has(commandName.toLowerCase())) return customCommands.get(commandName.toLowerCase()).response;
  try {

    if (commandName==="help") {
      return new EmbedBuilder().setTitle("VHX Bot Help").setColor(5793266).setDescription(codeBlock([
        "  /ask [question]         AI with web search + tools","  /search [query]         Web search","  /weather [city]         Current weather","  /calc [expression]      Calculator",
        "  /review [file|url|code] Review + auto-fix code","  /fix  [file|url|code]  Fix code only",
        "  /quiz [topic]           AI quiz","  /imagine [prompt]       Image generation","  /vision [image]         Image analysis","  /speak [text]           Text to speech","  /video [prompt]         Video generation",
        "  /lookup [token]         Your profile","  /stats                  Global statistics","  /stats_game [name]      Per-game stats","  /stats_top              Top games",
        "  /memory view|clear      AI memory","  /preference [k] [v]     Set AI preferences",
        "  ────────────────────────────────","  Custom: "+( Array.from(customCommands.keys()).map(k=>`/${k}`).join(", ")||"none" )
      ]));
    }

    if (commandName==="ask") {
      const question=options.question||"Hello";
      const snapshot=await getDatabaseSnapshot();
      const mem=await loadMemory(userId);
      let history=mem.history?.length?mem.history:(userHistory.get(userId)||[]);
      const prefCtx=Object.keys(mem.preferences||{}).length?`\n\nUser preferences: ${JSON.stringify(mem.preferences)}`:"";
      history.push({ role:"user", content:question });
      if (history.length>20) history=history.slice(-20);
      const aiResponse=await generateAI(history,snapshot+prefCtx,{ provider:VHXBOT_PROVIDER, apiKey:VHXBOT_API_KEY });
      const response=aiResponse.text;
      history.push({ role:"assistant", content:response });
      userHistory.set(userId,history);
      mem.history=history; await saveMemory(userId,mem);
      const embed=new EmbedBuilder().setTitle("VHX Observer").setDescription(response.length>4000?response.slice(0,4000)+"...":response).setColor(5793266);
      if (aiResponse.groundingUrls?.length) embed.addFields({ name:"Sources", value:aiResponse.groundingUrls.map(u=>`• [${u.title}](${u.uri})`).join("\n").slice(0,1024) });
      return embed;
    }

    if (commandName==="memory") {
      const mem=await loadMemory(userId);
      if (options.action==="view") {
        const prefKeys=Object.keys(mem.preferences||{});
        return new EmbedBuilder().setTitle("Your AI Memory").setColor(5793266).setDescription(codeBlock([`  Chat history:  ${mem.history?.length||0} messages stored`,`  Preferences:   ${prefKeys.length?prefKeys.map(k=>`${k}=${mem.preferences[k]}`).join(", "):"none"}`,`  Server ctx:    ${Object.keys(mem.server_context||{}).length} entries`]));
      }
      if (options.action==="clear") {
        await saveMemory(userId,{ history:[],preferences:{},server_context:{} }); userHistory.delete(userId);
        return "✅ Your AI memory has been cleared.";
      }
    }

    if (commandName==="preference") {
      if (!options.key||!options.value) return "❌ Missing key or value.";
      await updatePreference(userId,options.key,options.value);
      return `✅ Preference saved: **${options.key}** = **${options.value}**`;
    }

    if (commandName==="search") {
      if (!options.query) return "❌ Missing query.";
      const results=await toolWebSearch(options.query);
      return new EmbedBuilder().setTitle(`🔍 Search: ${options.query}`).setDescription(results.slice(0,4000)).setColor(5793266);
    }

    if (commandName==="weather") {
      if (!options.location) return "❌ Missing location.";
      const result=await toolWeather(options.location);
      return new EmbedBuilder().setTitle(`🌤 Weather: ${options.location}`).setDescription(result).setColor(1752220);
    }

    if (commandName==="calc") {
      if (!options.expression) return "❌ Missing expression.";
      return `🧮 **${toolCalculate(options.expression)}**`;
    }

    if (commandName==="quiz") {
      if (!options.topic) return "❌ Missing topic.";
      const num=Math.min(10,Math.max(1,options.num_questions||5));
      const questions=await generateQuiz(options.topic,num);
      if (!questions?.length) return "❌ Failed to generate quiz.";
      return { _quizData:{ questions, topic:options.topic } };
    }

    if (commandName==="automod") {
      if (!isUserAdmin) return "❌ Admin only.";
      AUTOMOD_ENABLED=options.enabled;
      return new EmbedBuilder().setTitle(options.enabled?"🛡️ AutoMod Enabled":"🔕 AutoMod Disabled").setColor(options.enabled?5763719:15548997).setDescription(options.enabled?"AI auto-moderation is now active.":"AI auto-moderation is now disabled.");
    }

    if (["lookup","lookup_user","lookup_id"].includes(commandName)) {
      const sb=getSupabase(); let foundUser=null;
      if (commandName==="lookup"&&options.token) {
        const { data:td }=await sb.from("user_tokens").select("roblox_user_id").eq("token",options.token).single();
        if (td) { const { data:u }=await sb.from("unique_users").select("*").eq("roblox_user_id",td.roblox_user_id).single(); foundUser=u; }
        else    { const { data:u }=await sb.from("unique_users").select("*").ilike("username",`%${options.token}%`).limit(1).single(); foundUser=u; }
      } else if (commandName==="lookup_user"&&options.username) {
        if (!isUserAdmin) return "❌ Admin only.";
        const { data:u }=await sb.from("unique_users").select("*").ilike("username",options.username).limit(1).single(); foundUser=u;
      } else if (commandName==="lookup_id"&&options.roblox_id) {
        if (!isUserAdmin) return "❌ Admin only.";
        const { data:u }=await sb.from("unique_users").select("*").eq("roblox_user_id",options.roblox_id).limit(1).single(); foundUser=u;
      }
      if (!foundUser) return "❌ User not found.";
      return new EmbedBuilder().setTitle("Player Profile").setColor(5793266).setDescription(codeBlock([`  Username        ${foundUser.username||"N/A"}`,`  Roblox ID       ${foundUser.roblox_user_id||"N/A"}`,`  ────────────────────────────────`,`  First Seen      ${fmtDate(foundUser.first_seen)}`,`  Last Seen       ${timeAgo(foundUser.last_seen)}`,`  Executions      ${fmt(foundUser.execution_count)}`,`  ────────────────────────────────`,`  Country         ${foundUser.country_name||"Unknown"}`,`  City            ${foundUser.city||"Unknown"}`]));
    }

    if (commandName==="stats") {
      const sb=getSupabase();
      const { data:ed }=await sb.from("game_executions").select("count,daily_count,last_executed_at");
      const totalExec=ed?.reduce((a,r)=>a+(r.count||0),0)||0; const todayExec=ed?.reduce((a,r)=>a+(r.daily_count||0),0)||0;
      const lastExec=ed?.sort((a,b)=>new Date(b.last_executed_at).getTime()-new Date(a.last_executed_at).getTime())[0];
      const { count:tu }=await sb.from("unique_users").select("*",{ count:"exact",head:true });
      const yest=new Date(Date.now()-864e5).toISOString();
      const { count:au }=await sb.from("unique_users").select("*",{ count:"exact",head:true }).gte("last_seen",yest);
      const { count:nu }=await sb.from("unique_users").select("*",{ count:"exact",head:true }).gte("first_seen",yest);
      const { count:as }=await sb.from("game_status").select("*",{ count:"exact",head:true }).eq("maintenance",false);
      return new EmbedBuilder().setTitle("Global Statistics").setColor(1752220).setDescription(codeBlock([`  Total Executions    ${fmt(totalExec)}`,`  Today               ${fmt(todayExec)}`,`  ────────────────────────────────`,`  Active Users (24h)  ${fmt(au||0)}`,`  New Users (24h)     ${fmt(nu||0)}`,`  Total Users         ${fmt(tu||0)}`,`  ────────────────────────────────`,`  Last Execution      ${lastExec?timeAgo(lastExec.last_executed_at):"N/A"}`,`  Active Scripts      ${fmt(as||0)}`]));
    }

    if (commandName==="stats_game") {
      const sb=getSupabase(); const gameName=options.game_name; if (!gameName) return "❌ Missing game name.";
      const { data:gd }=await sb.from("game_executions").select("*").ilike("game_name",`%${gameName}%`);
      if (!gd?.length) return "❌ Game not found.";
      const totalCount=gd.reduce((a,r)=>a+(r.count||0),0); const dailyCount=gd.reduce((a,r)=>a+(r.daily_count||0),0);
      const lastEx=gd.sort((a,b)=>new Date(b.last_executed_at).getTime()-new Date(a.last_executed_at).getTime())[0];
      const { data:s }=await sb.from("game_status").select("maintenance").ilike("game_name",`%${gameName}%`).single();
      return new EmbedBuilder().setTitle("Game Stats").setColor(1752220).setDescription(codeBlock([`  Game            ${gd[0].game_name}`,`  ────────────────────────────────`,`  Total           ${fmt(totalCount)}`,`  Today           ${fmt(dailyCount)}`,`  Last Executed   ${timeAgo(lastEx.last_executed_at)}`,`  ────────────────────────────────`,`  Status          ${s?.maintenance?"MAINTENANCE":"ONLINE"}`]));
    }

    if (commandName==="stats_top") {
      const { data:games }=await getSupabase().from("game_executions").select("game_name,count").order("count",{ ascending:false }).limit(10);
      if (!games?.length) return "❌ No data.";
      return new EmbedBuilder().setTitle("Top Games").setColor(1752220).setDescription(codeBlock(games.map((g,i)=>`  #${(i+1).toString().padEnd(3)} ${(g.game_name||"Unknown").padEnd(24)}${fmt(g.count)}`)));
    }

    if (commandName==="ban") {
      if (!isUserAdmin) return "❌ No permission.";
      const sb=getSupabase(); const robloxId=options.roblox_id; const reason=options.reason||"No reason provided";
      if (!robloxId) return "❌ Missing Roblox ID.";
      const { data:u }=await sb.from("unique_users").select("username").eq("roblox_user_id",robloxId).limit(1).single();
      const username=u?.username||"Unknown";
      await sb.from("banned_users").upsert({ roblox_user_id:robloxId, username, reason });
      await sb.from("audit_log").insert({ action:"ban_user", details:{ roblox_user_id:robloxId, username, reason, by:userId } });
      return new EmbedBuilder().setTitle("User Banned").setColor(15548997).setDescription(codeBlock([`  Username    ${username}`,`  Roblox ID   ${robloxId}`,`  ────────────────────────────────`,`  Reason      ${reason}`]));
    }

    if (commandName==="unban") {
      if (!isUserAdmin) return "❌ No permission.";
      const sb=getSupabase(); const robloxId=options.roblox_id; if (!robloxId) return "❌ Missing Roblox ID.";
      await sb.from("banned_users").delete().eq("roblox_user_id",robloxId);
      await sb.from("audit_log").insert({ action:"unban_user", details:{ roblox_user_id:robloxId, by:userId } });
      return `✅ Unbanned \`${robloxId}\`.`;
    }

    if (commandName==="maintenance") {
      if (!isUserAdmin) return "❌ No permission.";
      const sb=getSupabase(); const { game_name:gameName, enabled }=options; if (!gameName) return "❌ Missing game name.";
      const { data:g }=await sb.from("game_status").select("game_name").ilike("game_name",`%${gameName}%`).single();
      if (!g) return "❌ Game not found.";
      await sb.from("game_status").update({ maintenance:enabled }).ilike("game_name",`%${gameName}%`);
      await sb.from("audit_log").insert({ action:"maintenance_toggle", details:{ game:g.game_name, enabled, by:userId } });
      return new EmbedBuilder().setTitle(enabled?"🔧 Maintenance Enabled":"✅ Maintenance Disabled").setColor(enabled?15105570:5763719).setDescription(codeBlock([`  Game    ${g.game_name}`,`  Status  ${enabled?"MAINTENANCE":"ONLINE"}`]));
    }

    if (commandName==="announce_list") {
      const { data:anns }=await getSupabase().from("announcements").select("*").order("created_at",{ ascending:false }).limit(5);
      if (!anns?.length) return "❌ No active announcements.";
      return new EmbedBuilder().setTitle("Recent Announcements").setColor(5793266).setDescription(anns.map(a=>`**[${a.type.toUpperCase()}]** ${a.message}`).join("\n\n"));
    }

    if (commandName==="announce_add") {
      if (!isUserAdmin) return "❌ Admin only.";
      const { type, message }=options; if (!type||!message) return "❌ Missing type or message.";
      await getSupabase().from("announcements").insert({ type, message });
      return `✅ Announcement posted: **[${type.toUpperCase()}]** ${message}`;
    }

    if (commandName==="imagine") {
      const prompt=options.prompt; if (!prompt) return "❌ Missing prompt.";
      const resolvedModel=options.model||await getBestImageModel();
      const imageResult=await generateImage(prompt,{ apiKey:VHXBOT_API_KEY, model:resolvedModel });
      const embed=new EmbedBuilder().setTitle("AI Image Generation").setDescription(`**Prompt:** ${prompt}\n**Model:** ${resolvedModel}`).setColor(5793266).setFooter({ text:"Powered by OpenRouter" });
      if (imageResult.startsWith("data:")) {
        const [,mimeType,b64]=(imageResult.match(/^data:(.+);base64,(.+)$/)||[]);
        if (!b64) throw new Error("Invalid base64.");
        const ext=mimeType?.includes("png")?"png":mimeType?.includes("webp")?"webp":"jpg";
        embed.setImage(`attachment://image.${ext}`);
        return { embeds:[embed], files:[{ attachment:Buffer.from(b64,"base64"), name:`image.${ext}` }] };
      }
      embed.setImage(imageResult); return embed;
    }

    if (commandName==="vision") {
      const { image_url:imageUrl, prompt:prompt="Describe this image in detail.", mime_type:mimeType="image/png" }=options;
      if (!imageUrl) return "❌ Missing image.";
      const resp=await axios.get(imageUrl,{ responseType:"arraybuffer" });
      const base64=Buffer.from(resp.data,"binary").toString("base64");
      const analysis=await generateVision(prompt,base64,mimeType,{ apiKey:VHXBOT_API_KEY });
      return new EmbedBuilder().setTitle("AI Vision Analysis").setDescription(`**Prompt:** ${prompt}\n\n${analysis}`).setThumbnail(imageUrl).setColor(5793266);
    }

    if (commandName==="speak") {
      const text=options.text; const voice=options.voice||"alloy"; if (!text) return "❌ Missing text.";
      const ttsResult=await generateTTS(text,{ apiKey:VHXBOT_API_KEY, voice:options.voice||"alloy" });
      if (ttsResult.base64) return { content:`🗣️ **Model:** ${ttsResult.model}\n**Voice:** ${options.voice||"alloy"}\n**Text:** ${text}`, files:[{ attachment:Buffer.from(ttsResult.base64,"base64"), name:"speech.mp3" }] };
      return `🗣️ **Model:** ${ttsResult.model}\n**Response:** ${ttsResult.text}`;
    }

    if (commandName==="video") {
      const prompt=options.prompt; if (!prompt) return "❌ Missing prompt.";
      const model=await getBestVideoModel();
      const keys=VHXBOT_API_KEY?[VHXBOT_API_KEY,...getAllOpenRouterKeys()]:getAllOpenRouterKeys();
      const key=keys[0]; let videoUrl=null;
      try { const r=await axios.post("https://openrouter.ai/api/v1/images/generations",{ model,prompt,n:1 },{ headers:{ Authorization:`Bearer ${key}`,"Content-Type":"application/json","HTTP-Referer":"https://discord.com","X-Title":"VHX Bot Assistant" } }); videoUrl=r.data?.data?.[0]?.url||null; } catch {}
      if (!videoUrl) {
        const res=await createOpenRouterClient(key).chat.completions.create({ model, messages:[{ role:"user", content:prompt }] });
        const content=res.choices?.[0]?.message?.content||"";
        const m=content.match(/https?:\/\/\S+/); videoUrl=m?m[0].replace(/[)>.,]+$/,""):null;
        if (!videoUrl) return `🎥 **Model:** ${model}\n\nVideo generation not yet supported for this model.\n\n**Raw:** ${content}`;
      }
      return new EmbedBuilder().setTitle("AI Video Generation").setDescription(`**Prompt:** ${prompt}\n**Model:** ${model}\n**Video:** [Click to view](${videoUrl})`).setColor(5793266).setFooter({ text:"Powered by OpenRouter" });
    }

    // ── /submit-script  and  /review (UPGRADED)
    if (commandName==="submit-script"||commandName==="review") {
      const codeUrl=options.script_url||options.file_url||options.url;
      const rawCode=options.code;
      let language=options.language;
      let codeContent="";
      if (rawCode) { codeContent=rawCode; if (!language) language=detectLanguageFromContent(rawCode); }
      else if (codeUrl) {
        const resp=await axios.get(codeUrl,{ timeout:10000 });
        codeContent=typeof resp.data==="string"?resp.data:JSON.stringify(resp.data,null,2);
        if (!language) language=detectLanguageFromUrl(codeUrl);
      } else return "❌ Missing code. Attach a file, provide a URL, or use the `code` option to paste directly.";
      if (!codeContent?.trim()) return "❌ The provided code is empty.";
      if (codeContent.length>30000) return "❌ Code is too large (max 30,000 chars).";
      if (!language) language=detectLanguageFromContent(codeContent);
      console.log(`Reviewing (lang: ${language||"auto"})…`);
      const review=await generateCodeReview(codeContent,language,{ apiKey:VHXBOT_API_KEY });
      const critCount=review.issues.filter(i=>i.severity==="critical").length;
      const modCount=review.issues.filter(i=>i.severity==="moderate").length;
      const minCount=review.issues.filter(i=>i.severity==="minor").length;
      const embed=new EmbedBuilder()
        .setTitle(`🔍 ${(language||"Code").toUpperCase()} Review`)
        .setDescription((review.summary||"Review complete.").slice(0,2000))
        .setColor(critCount>0?15548997:modCount>0?15105570:5763719)
        .addFields({ name:"Issues Found", value:`🔴 Critical: **${critCount}**  🟠 Moderate: **${modCount}**  🟡 Minor: **${minCount}**` })
        .setTimestamp();
      review.issues.slice(0,8).forEach((issue,idx)=>{
        const emoji=issue.severity==="critical"?"🔴":issue.severity==="moderate"?"🟠":"🟡";
        embed.addFields({ name:`${emoji} Issue #${idx+1}${issue.line?` — Line ${issue.line}`:""}`, value:`**Problem:** ${(issue.issue||"").slice(0,200)}\n**Fix:** ${(issue.suggestion||"").slice(0,200)}` });
      });
      if (review.issues.length>8) embed.setFooter({ text:`…and ${review.issues.length-8} more. Fixed file attached below.` });
      const ext=getFileExtension(language);
      const buffer=Buffer.from(review.correctedCode||codeContent,"utf-8");
      const fixedPreview=review.correctedCode?.length<=1900?`\`\`\`${language||""}\n${review.correctedCode}\n\`\`\``:null;
      return { _reviewResult:true, embeds:[embed], files:[{ attachment:buffer, name:`fixed_code.${ext}` }], fixedPreview, language };
    }

    // ── /fix (backwards compat + raw paste support)
    if (commandName==="fix") {
      const codeUrl=options.file_url||options.url;
      const rawCode=options.code;
      let language=options.language;
      let codeContent="";
      if (rawCode) { codeContent=rawCode; if (!language) language=detectLanguageFromContent(rawCode); }
      else if (codeUrl) {
        const resp=await axios.get(codeUrl,{ timeout:10000 });
        codeContent=typeof resp.data==="string"?resp.data:JSON.stringify(resp.data,null,2);
        if (!language) language=detectLanguageFromUrl(codeUrl);
      } else return "❌ Missing code. Attach a file, provide a URL, or use the `code` option to paste directly.";
      if (!codeContent?.trim()) return "❌ Code is empty.";
      if (codeContent.length>30000) return "❌ Code is too large (max 30,000 chars).";
      if (!language) language=detectLanguageFromContent(codeContent);
      const fixedCode=await generateCodeFix(codeContent,language||null,{ apiKey:VHXBOT_API_KEY });
      const buffer=Buffer.from(fixedCode,"utf-8");
      const preview=fixedCode.length<=1900?`\`\`\`${language||""}\n${fixedCode}\n\`\`\``:null;
      return { _fixResult:true, content:`✅ **Fixed ${(language||"Code").toUpperCase()}** — corrected file attached:`, files:[{ attachment:buffer, name:`fixed_code.${getFileExtension(language)}` }], preview };
    }

    if (commandName==="changelog_add") {
      if (!isUserAdmin) return "❌ Admin only.";
      const { version,title,body }=options; if (!version||!title||!body) return "❌ Missing fields.";
      await getSupabase().from("changelogs").insert({ version,title,body });
      return `✅ Changelog added: **v${version}** — ${title}`;
    }

    if (commandName==="role_set") {
      if (!isUserAdmin) return "❌ Admin only.";
      const { discord_id:discordId,role }=options; if (!discordId||!role) return "❌ Missing fields.";
      await getSupabase().from("user_roles").upsert({ discord_id:discordId, role });
      return `✅ Role **${role}** assigned to \`${discordId}\`.`;
    }

    return "❌ Command not implemented.";
  } catch(e) { console.error("❌ Logic Error:",e); return "❌ Execution failed."; }
}

// ─── Interaction Handler ───────────────────────────────────────────────────────
const DEFER_COMMANDS=new Set(["ask","imagine","submit-script","vision","speak","review","fix","search","weather","calc","quiz","video","lookup","lookup_user","lookup_id","stats","stats_game","stats_top","memory","preference","automod"]);

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, channelId }=interaction;
  const userTag=interaction.user.tag;
  const userAvatar=interaction.user.displayAvatarURL();
  if (BOT_COMMANDS_CHANNEL_ID&&channelId!==BOT_COMMANDS_CHANNEL_ID&&!isAdmin(interaction))
    return interaction.reply({ content:`❌ Commands can only be used in <#${BOT_COMMANDS_CHANNEL_ID}>.`, ephemeral:true });
  if (DEFER_COMMANDS.has(commandName)) await interaction.deferReply();
  try {
    const result=await executeCommandLogic(commandName,{
      question:      interaction.options.getString("question"),
      token:         interaction.options.getString("token"),
      game_name:     interaction.options.getString("game_name"),
      roblox_id:     interaction.options.getString("roblox_id"),
      username:      interaction.options.getString("username"),
      reason:        interaction.options.getString("reason"),
      enabled:       interaction.options.getBoolean("enabled"),
      type:          interaction.options.getString("type"),
      message:       interaction.options.getString("message"),
      script_url:    interaction.options.getAttachment("script")?.url,
      file_url:      interaction.options.getAttachment("file")?.url,
      url:           interaction.options.getString("url"),
      code:          interaction.options.getString("code"),
      language:      interaction.options.getString("language"),
      image_url:     interaction.options.getAttachment("image")?.url,
      mime_type:     interaction.options.getAttachment("image")?.contentType,
      prompt:        interaction.options.getString("prompt"),
      text:          interaction.options.getString("text"),
      voice:         interaction.options.getString("voice"),
      action:        interaction.options.getString("action"),
      key:           interaction.options.getString("key"),
      value:         interaction.options.getString("value"),
      query:         interaction.options.getString("query"),
      location:      interaction.options.getString("location"),
      expression:    interaction.options.getString("expression"),
      topic:         interaction.options.getString("topic"),
      num_questions: interaction.options.getInteger("questions"),
      version:       interaction.options.getString("version"),
      title:         interaction.options.getString("title"),
      body:          interaction.options.getString("body"),
      discord_id:    interaction.options.getString("discord_id"),
      role:          interaction.options.getString("role"),
      model:         interaction.options.getString("model")
    }, interaction.user.id, isAdmin(interaction));

    // Quiz start
    if (result?._quizData) {
      const { questions, topic }=result._quizData;
      const q=questions[0];
      const embed=new EmbedBuilder().setTitle(`📚 Quiz: ${topic}  (1/${questions.length})`).setDescription(`**${q.question}**\n\n${q.options.join("\n")}`).setColor(5793266).setFooter({ text:"Reply with A, B, C, or D" });
      const msg=interaction.deferred?await interaction.editReply({ embeds:[embed] }):await interaction.reply({ embeds:[embed], fetchReply:true });
      activeQuizzes.set(interaction.channelId,{ questions, currentIndex:0, scores:{}, topic, userId:interaction.user.id });
      logCommand(userTag,userAvatar,`/${commandName}`,`Quiz started: ${topic}`); return;
    }
    // Review result
    if (result?._reviewResult) {
      const payload={ content:"", embeds:result.embeds, files:result.files };
      interaction.deferred?await interaction.editReply(payload):await interaction.reply(payload);
      if (result.fixedPreview) await interaction.followUp({ content:result.fixedPreview });
      logCommand(userTag,userAvatar,`/${commandName}`,"Review+Fix response"); return;
    }
    // Fix result
    if (result?._fixResult) {
      const payload={ content:result.content, files:result.files };
      interaction.deferred?await interaction.editReply(payload):await interaction.reply(payload);
      if (result.preview) await interaction.followUp({ content:result.preview });
      logCommand(userTag,userAvatar,`/${commandName}`,"Fix response"); return;
    }
    // String
    if (typeof result==="string") {
      logCommand(userTag,userAvatar,`/${commandName}`,result);
      interaction.deferred?await interaction.editReply({ content:result }):await interaction.reply(result); return;
    }
    // EmbedBuilder
    if (result instanceof EmbedBuilder) {
      interaction.deferred?await interaction.editReply({ content:"", embeds:[result] }):await interaction.reply({ embeds:[result] });
      logCommand(userTag,userAvatar,`/${commandName}`,"Embed response"); return;
    }
    // Object (files/embeds)
    if (result&&typeof result==="object") {
      const payload={ content:result.content||"", embeds:result.embeds||[], files:result.files||[] };
      interaction.deferred?await interaction.editReply(payload):await interaction.reply(payload);
      logCommand(userTag,userAvatar,`/${commandName}`,"File response"); return;
    }
  } catch(e) {
    console.error("❌ Interaction Error:",e);
    const msg="❌ An error occurred while processing your request.";
    interaction.deferred||interaction.replied?await interaction.editReply(msg):await interaction.reply({ content:msg, ephemeral:true });
  }
});

// ─── Quiz Answer + Chatbot Message Handler ─────────────────────────────────────
const VHXBOT_TRIGGER_WORDS=(process.env.VHXBOT_TRIGGER_WORDS||"!vhx,!bot,!ask").split(",").map(w=>w.trim().toLowerCase()).filter(Boolean);

async function handleChatbotMessage(message, botClient) {
  if (message.author.bot) return;
  const botId=botClient.user?.id;
  const isMentioned=botId?message.mentions.has(botId):false;
  const isDM=!message.guild;
  const isChatChannel=CHAT_CHANNEL_ID&&message.channelId===CHAT_CHANNEL_ID;
  const isMainBot=botClient===client;
  const msgLower=message.content.toLowerCase();
  const hasTrigger=VHXBOT_TRIGGER_WORDS.some(w=>msgLower.startsWith(w));
  if (isMainBot&&!isMentioned&&!isDM&&!hasTrigger) return;
  if (!isMentioned&&!isDM&&!isChatChannel&&!hasTrigger) return;

  console.log(`🤖 Chatbot triggered by ${message.author.tag}`);
  try {
    if ("sendTyping" in message.channel) await message.channel.sendTyping();
    const mentionRegex=new RegExp(`<@!?${botClient.user?.id}>`,"g");
    const triggerRegex=new RegExp(`^(${VHXBOT_TRIGGER_WORDS.map(w=>w.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")).join("|")})\\s*`,"i");
    const prompt=message.content.replace(mentionRegex,"").replace(triggerRegex,"").trim();
    if (!prompt&&isMentioned) return message.reply("Hello! How can I help you today?");
    if (!prompt) return;

    // Automod
    if (AUTOMOD_ENABLED&&isMainBot) {
      const mod=await automodCheck(message.content,message.author.id);
      if (mod.action==="delete") {
        try { await message.delete(); } catch {}
        if (AUTOMOD_CHANNEL_ID) { const ch=client.channels.cache.get(AUTOMOD_CHANNEL_ID); if (ch&&"send" in ch) await ch.send(`🛡️ AutoMod deleted message from <@${message.author.id}>: **${mod.reason}**`); }
        return;
      }
      if (mod.action==="warn") await message.reply(`⚠️ **AutoMod Warning:** ${mod.reason}`);
    }

    const snapshot=isMainBot?await getDatabaseSnapshot():undefined;
    const aiOptions=isMainBot?{ provider:VHXBOT_PROVIDER, apiKey:VHXBOT_API_KEY }:{ provider:VHXAI_PROVIDER, apiKey:VHXAI_API_KEY };
    const mem=isMainBot?await loadMemory(message.author.id):{ history:[],preferences:{},server_context:{} };
    let history=mem.history?.length?mem.history:(userHistory.get(message.author.id)||[]);
    const prefCtx=Object.keys(mem.preferences||{}).length?`\n\nUser preferences: ${JSON.stringify(mem.preferences)}`:"";
    const discordCtx=`[Discord Context: User=${message.author.username}, Channel=${message.channel.name||"DM"}, Guild=${message.guild?.name||"DM"}]`;
    history.push({ role:"user", content:`${discordCtx}\n${prompt}` });
    if (history.length>20) history=history.slice(-20);
    const aiResponse=await generateAI(history,(snapshot||"")+prefCtx,aiOptions);
    const response=aiResponse.text;
    history.push({ role:"assistant", content:response });
    userHistory.set(message.author.id,history);
    if (isMainBot) { mem.history=history; await saveMemory(message.author.id,mem); }
    let finalResponse=response;
    if (aiResponse.groundingUrls?.length) finalResponse+="\n\n**Sources:**\n"+aiResponse.groundingUrls.map(u=>`• [${u.title}](${u.uri})`).join("\n");
    const chunks=chunkString(finalResponse,1900);
    for (let i=0;i<chunks.length;i++) i===0?await message.reply(chunks[i]):await message.channel.send(chunks[i]);
    logCommand(message.author.tag,message.author.displayAvatarURL(),`${isMainBot?"[vhxBOT]":"[vhxAI]"} ${prompt}`,response);
  } catch(e) { console.error("❌ Chatbot Error:",e); await message.reply(`❌ **Chatbot Error:** ${e.message||"An unexpected error occurred."}`); }
}

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  // Handle quiz answers
  const quiz=activeQuizzes.get(message.channelId);
  if (quiz) {
    const ans=message.content.trim().toUpperCase();
    if (["A","B","C","D"].includes(ans)) {
      const q=quiz.questions[quiz.currentIndex];
      const correct=ans===q.answer;
      if (!quiz.scores[message.author.id]) quiz.scores[message.author.id]=0;
      if (correct) quiz.scores[message.author.id]++;
      await message.reply(correct?`✅ Correct! ${q.explanation}`:`❌ Wrong! The answer was **${q.answer}**. ${q.explanation}`);
      quiz.currentIndex++;
      if (quiz.currentIndex>=quiz.questions.length) {
        const scoreLines=Object.entries(quiz.scores).sort((a,b)=>b[1]-a[1]).map(([uid,s])=>`  <@${uid}>  ${s}/${quiz.questions.length}`);
        await message.channel.send({ embeds:[new EmbedBuilder().setTitle(`🏆 Quiz Over: ${quiz.topic}`).setColor(1752220).setDescription(scoreLines.join("\n")||"No scores.")] });
        activeQuizzes.delete(message.channelId);
      } else {
        const nq=quiz.questions[quiz.currentIndex];
        await message.channel.send({ embeds:[new EmbedBuilder().setTitle(`📚 Quiz: ${quiz.topic}  (${quiz.currentIndex+1}/${quiz.questions.length})`).setDescription(`**${nq.question}**\n\n${nq.options.join("\n")}`).setColor(5793266).setFooter({ text:"Reply with A, B, C, or D" })] });
      }
      return;
    }
  }
  handleChatbotMessage(message,client);
});
vhxAI.on("messageCreate",(message)=>{ if (VHXAI_TOKEN) handleChatbotMessage(message,vhxAI); });

// ─── Ready Events ──────────────────────────────────────────────────────────────
client.once("ready", async () => {
  console.log(`✅ Logged in as ${client.user?.tag}`); botStatus.main="ONLINE";
  client.user?.setActivity({ name:"Roblox", type:ActivityType.Playing });
  await registerCommands(); await updateCounterEmbed();
  setInterval(updateCounterEmbed,30000); setInterval(updateChannelName,300000);
});
vhxAI.once("ready",()=>{
  console.log(`✅ vhxAI logged in as ${vhxAI.user?.tag}`); botStatus.vhxAI="ONLINE";
  vhxAI.user?.setActivity({ name:"Minecraft", type:ActivityType.Playing });
});

// ─── Express API ───────────────────────────────────────────────────────────────
const app=express(); const port=3000;
app.use(express.json()); app.use(express.urlencoded({ extended:true })); app.set("trust proxy",1);
app.post("/api/commands",(req,res)=>{ const { name,response }=req.body; if (!name||!response) return res.status(400).json({ error:"Missing name or response" }); addCustomCommand(name,response,"API"); res.json({ ok:true }); });
app.post("/api/commands/delete",(req,res)=>{ removeCustomCommand(req.body.name); res.json({ ok:true }); });
app.post("/api/logs/clear",(req,res)=>{ commandLogs.length=0; res.json({ ok:true }); });
app.get("/api/analytics",async(req,res)=>{
  try {
    const commandCounts={}; commandLogs.forEach(l=>{ const cmd=l.command.split(" ")[0].replace("/",""); commandCounts[cmd]=(commandCounts[cmd]||0)+1; });
    const now=new Date(); const hourlyUsage={};
    for (let i=0;i<24;i++) { const d=new Date(now-i*3600000); hourlyUsage[d.getHours().toString().padStart(2,"0")+":00"]=0; }
    commandLogs.forEach(l=>{ const h=new Date(l.timestamp).getHours().toString().padStart(2,"0")+":00"; if (hourlyUsage[h]!==undefined) hourlyUsage[h]++; });
    let gameExecs=[]; try { const { data }=await getSupabase().from("game_executions").select("game_name,count").order("count",{ ascending:false }).limit(5); gameExecs=data||[]; } catch {}
    res.json({ commandCounts, hourlyUsage:Object.entries(hourlyUsage).reverse().map(([hour,count])=>({ hour,count })), gameExecs });
  } catch { res.status(500).json({ error:"Failed to fetch analytics" }); }
});
app.post("/api/test-command",async(req,res)=>{
  const { command,options }=req.body; if (!command) return res.status(400).json({ error:"Command name required" });
  try {
    const result=await executeCommandLogic(command,options||{},"DASHBOARD_TESTER",true);
    if (typeof result==="string") res.json({ type:"text", content:result });
    else if (result instanceof EmbedBuilder) res.json({ type:"embed", content:result.toJSON() });
    else res.json({ type:"object", content:result });
  } catch { res.status(500).json({ error:"Command execution failed" }); }
});
app.get("/",(req,res)=>res.json({ status:"ok", uptime:process.uptime(), bots:botStatus }));

// ─── Start ─────────────────────────────────────────────────────────────────────
function startBot() {
  if (DISCORD_TOKEN) client.login(DISCORD_TOKEN).catch(e=>console.error("❌ Main Bot Login Failed:",e));
  else console.warn("⚠️ DISCORD_TOKEN not set. Main bot will not start.");
  if (VHXAI_TOKEN) vhxAI.login(VHXAI_TOKEN).catch(e=>console.error("❌ vhxAI Login Failed:",e));
  else console.warn("⚠️ VHXAI_TOKEN not set. vhxAI will not start.");
}
app.listen(port,()=>{ console.log(`🚀 Status server running at http://localhost:${port}`); startBot(); });
