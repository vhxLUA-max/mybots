"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// server.ts
var dotenv2 = __toESM(require("dotenv"));
var import_express = __toESM(require("express"));


// bot/bot.ts
var dotenv = __toESM(require("dotenv"));
var import_discord = require("discord.js");

// bot/gemini.ts
var import_openai = __toESM(require("openai"));
var import_axios = __toESM(require("axios"));
var SYSTEM_INSTRUCTION = `You are a helpful and neutral AI assistant operating within a Discord server. You are fully aware that you are on Discord and should behave accordingly.
- Use Discord markdown formatting where appropriate (bold, italics, code blocks, etc.)
- Keep responses concise and readable for a chat environment
- Do NOT wrap your entire response in a code block unless the user specifically asks for code. Use normal text for explanations and only use code blocks (\`\`\`) for actual code snippets
- You may use Discord-style mentions, and formatting naturally
- If the user asks for information that requires up-to-date data, use your search tools if available`;
var modelCache = {
  text: [],
  image: [],
  vision: [],
  audio: [],
  video: [],
  all: [],
  fetchedAt: 0
};
var CACHE_TTL_MS = 60 * 60 * 1e3;
var TEXT_MODEL_PRIORITY = [
  "nvidia/nemotron-3-super-120b-a12b:free",
  "stepfun/step-3.5-flash:free",
  "minimax/minimax-m2.5:free"
];
var CODE_MODEL_PRIORITY = [
  "nvidia/nemotron-3-super-120b-a12b:free",
  "stepfun/step-3.5-flash:free",
  "minimax/minimax-m2.5:free"
];
var IMAGE_MODEL_PRIORITY = [
  "black-forest-labs/flux-1-schnell",
  "black-forest-labs/flux-1-pro",
  "stabilityai/stable-diffusion-3-medium"
];
var AUDIO_MODEL_PRIORITY = [
  "openai/tts-1",
  "openai/tts-1-hd"
];
var VIDEO_MODEL_PRIORITY = [
  "minimax/video-01",
  "wan-ai/wan2.1-t2v-turbo"
];
var VISION_MODEL_PRIORITY = [
  "nvidia/nemotron-nano-12b-v2-vl:free"
];
async function fetchModelCatalog() {
  const now = Date.now();
  if (now - modelCache.fetchedAt < CACHE_TTL_MS && modelCache.all.length > 0) return;
  console.log("\u{1F4CB} Fetching OpenRouter model catalog...");
  try {
    const allRes = await import_axios.default.get("https://openrouter.ai/api/v1/models");
    modelCache.all = allRes.data.data || [];
    const allIds = new Set(modelCache.all.map((m) => m.id));
    // Text: must output text and not take image input
    modelCache.text = modelCache.all.filter((m) => {
      const out = m.architecture?.output_modalities || [];
      const inp = m.architecture?.input_modalities || [];
      return out.includes("text") && !out.includes("image") && !inp.includes("image");
    });
    // Image: use priority list directly — bypass modality filter since OpenRouter catalog
    // does not always tag newer image models correctly
    modelCache.image = IMAGE_MODEL_PRIORITY.map((id) => ({ id }));
    // Vision: use priority list directly — same reason
    modelCache.vision = VISION_MODEL_PRIORITY.map((id) => ({ id }));
    // Audio: use priority list directly
    modelCache.audio = AUDIO_MODEL_PRIORITY.map((id) => ({ id }));
    // Video: use priority list directly
    modelCache.video = VIDEO_MODEL_PRIORITY.map((id) => ({ id }));
    modelCache.fetchedAt = now;
    console.log(`\u2705 Model catalog loaded \u2014 text: ${modelCache.text.length}, image: ${modelCache.image.length}, vision: ${modelCache.vision.length}, audio: ${modelCache.audio.length}, video: ${modelCache.video.length}`);
  } catch (err) {
    console.warn(`\u26A0\uFE0F Could not fetch model catalog: ${err.message}. Using hardcoded defaults.`);
  }
}
function pickBestModel(priority, available, fallback) {
  if (available.length === 0) return fallback;
  const availableIds = new Set(available.map((m) => m.id));
  for (const preferred of priority) {
    if (availableIds.has(preferred)) return preferred;
  }
  return available[0]?.id || fallback;
}
async function getBestTextModel() {
  await fetchModelCatalog();
  return pickBestModel(TEXT_MODEL_PRIORITY, modelCache.text, TEXT_MODEL_PRIORITY[0]);
}
async function getBestCodeModel() {
  await fetchModelCatalog();
  return pickBestModel(CODE_MODEL_PRIORITY, modelCache.text, CODE_MODEL_PRIORITY[0]);
}
async function getBestImageModel(preferred) {
  await fetchModelCatalog();
  if (preferred) return preferred;
  return pickBestModel(IMAGE_MODEL_PRIORITY, modelCache.image, IMAGE_MODEL_PRIORITY[0]);
}
async function getBestVisionModel() {
  await fetchModelCatalog();
  return pickBestModel(VISION_MODEL_PRIORITY, modelCache.vision, VISION_MODEL_PRIORITY[0]);
}
async function getBestAudioModel() {
  await fetchModelCatalog();
  return pickBestModel(AUDIO_MODEL_PRIORITY, modelCache.audio, AUDIO_MODEL_PRIORITY[0]);
}
async function getBestVideoModel() {
  await fetchModelCatalog();
  return pickBestModel(VIDEO_MODEL_PRIORITY, modelCache.video, VIDEO_MODEL_PRIORITY[0]);
}
function getAllOpenRouterKeys() {
  const keys = [];
  const seen = /* @__PURE__ */ new Set();
  for (const [envKey, value] of Object.entries(process.env)) {
    if (!value) continue;
    const v = value.trim();
    if (!v || v.includes("YOUR_") || v.includes("MY_") || v === "undefined" || v === "null") continue;
    if (envKey === "OPENROUTER_API_KEY" || envKey.startsWith("OPENROUTER_API_KEY_") || envKey === "API_KEY") {
      if (!seen.has(v)) {
        seen.add(v);
        keys.push(v);
      }
    }
  }
  return keys;
}
function createOpenRouterClient(apiKey) {
  return new import_openai.default({
    baseURL: "https://openrouter.ai/api/v1",
    apiKey,
    defaultHeaders: {
      "HTTP-Referer": "https://discord.com",
      "X-Title": "VHX Bot Assistant"
    }
  });
}
async function withFallback(keys, fn) {
  if (keys.length === 0) throw new Error("No OpenRouter API keys found. Please set OPENROUTER_API_KEY in your environment.");
  let lastError = null;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    try {
      if (i > 0) console.log(`\u{1F504} Retrying with fallback key #${i + 1} (${key.substring(0, 8)}...)...`);
      return await fn(createOpenRouterClient(key), key);
    } catch (err) {
      console.warn(`\u26A0\uFE0F Key #${i + 1} (${key.substring(0, 8)}...) failed: ${err.message}`);
      lastError = err;
    }
  }
  throw new Error(`All ${keys.length} OpenRouter key(s) exhausted. Last error: ${lastError?.message}`);
}
async function generateAI(messages, systemContext, options = {}) {
  const finalSystemInstruction = systemContext ? `${SYSTEM_INSTRUCTION}

${systemContext}` : SYSTEM_INSTRUCTION;
  const keys = options.apiKey ? [options.apiKey, ...getAllOpenRouterKeys()] : getAllOpenRouterKeys();
  const model = await getBestTextModel();
  console.log(`\u{1F916} Text model selected: ${model}`);
  return withFallback(keys, async (openai, key) => {
    console.log(`\u{1F511} Using key: ${key.substring(0, 8)}...`);
    const response = await openai.chat.completions.create({
      model,
      messages: [
        { role: "system", content: finalSystemInstruction },
        ...messages.map((m) => ({ role: m.role, content: m.content }))
      ],
      temperature: 0.8
    });
    const text = response.choices[0]?.message?.content;
    if (!text) throw new Error("OpenRouter returned an empty response.");
    console.log(`\u2705 Response received (${text.length} chars)`);
    return { text };
  });
}
async function generateImage(prompt, options = {}) {
  const keys = options.apiKey ? [options.apiKey, ...getAllOpenRouterKeys()] : getAllOpenRouterKeys();
  const model = options.model || await getBestImageModel();
  console.log(`\u{1F3A8} Image model selected: ${model}`);
  return withFallback(keys, async (openai, key) => {
    console.log(`\u{1F511} Using key: ${key.substring(0, 8)}...`);
    try {
      // Use the proper images/generations endpoint
      const imgRes = await import_axios.default.post(
        "https://openrouter.ai/api/v1/images/generations",
        { model, prompt, n: 1, size: "1024x1024" },
        {
          headers: {
            "Authorization": `Bearer ${key}`,
            "Content-Type": "application/json",
            "HTTP-Referer": "https://discord.com",
            "X-Title": "VHX Bot Assistant"
          }
        }
      );
      const imageUrl = imgRes.data?.data?.[0]?.url;
      if (!imageUrl) throw new Error("No image URL in response.");
      console.log(`\u2705 Image generated: ${imageUrl}`);
      return imageUrl;
    } catch (imgErr) {
      console.warn(`\u26A0\uFE0F images/generations failed (${imgErr.message}), trying chat completions...`);
      // Fallback: some models return image URLs inline in chat
      const chatRes = await openai.chat.completions.create({
        model,
        messages: [{ role: "user", content: `Generate an image of: ${prompt}` }]
      });
      const content = chatRes.choices?.[0]?.message?.content || "";
      const urlMatch = content.match(/https?:\/\/\S+/);
      const imageUrl = urlMatch ? urlMatch[0].replace(/[)>.,]+$/, "") : null;
      if (!imageUrl) throw new Error("OpenRouter did not return a valid image URL.");
      console.log(`\u2705 Image generated via chat: ${imageUrl}`);
      return imageUrl;
    }
  });
}
async function generateVision(prompt, imageBase64, mimeType, options = {}) {
  const keys = options.apiKey ? [options.apiKey, ...getAllOpenRouterKeys()] : getAllOpenRouterKeys();
  const model = await getBestVisionModel();
  console.log(`\u{1F441}\uFE0F Vision model selected: ${model}`);
  return withFallback(keys, async (openai, key) => {
    console.log(`\u{1F511} Using key: ${key.substring(0, 8)}...`);
    const response = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            {
              type: "image_url",
              image_url: { url: `data:${mimeType};base64,${imageBase64}` }
            }
          ]
        }
      ]
    });
    return response.choices[0].message.content || "No response from OpenRouter.";
  });
}
async function generateTTS(text, options = {}) {
  const voice = options.voice || "alloy";
  const validVoices = ["alloy", "echo", "fable", "onyx", "nova", "shimmer"];
  const resolvedVoice = validVoices.includes(voice.toLowerCase()) ? voice.toLowerCase() : "alloy";
  // Try OpenAI TTS directly if OPENAI_API_KEY is set
  const openaiKey = process.env.OPENAI_API_KEY;
  if (openaiKey) {
    console.log(`\uD83D\uDDE3\uFE0F Using OpenAI TTS (voice: ${resolvedVoice})`);
    try {
      const ttsRes = await import_axios.default.post(
        "https://api.openai.com/v1/audio/speech",
        { model: "tts-1", input: text, voice: resolvedVoice },
        {
          headers: { "Authorization": `Bearer ${openaiKey}`, "Content-Type": "application/json" },
          responseType: "arraybuffer"
        }
      );
      const base64Audio = Buffer.from(ttsRes.data).toString("base64");
      console.log(`\u2705 TTS audio generated via OpenAI (${base64Audio.length} bytes)`);
      return { base64: base64Audio, model: "openai/tts-1" };
    } catch (err) {
      console.warn(`\u26A0\uFE0F OpenAI TTS failed: ${err.message}. Falling back to OpenRouter...`);
    }
  }
  // Fallback: try OpenRouter audio models
  const keys = options.apiKey ? [options.apiKey, ...getAllOpenRouterKeys()] : getAllOpenRouterKeys();
  const model = await getBestAudioModel();
  console.log(`\uD83D\uDDE3\uFE0F Audio model selected: ${model} (Voice: ${resolvedVoice})`);
  return withFallback(keys, async (openai, key) => {
    console.log(`\uD83D\uDD11 Using key: ${key.substring(0, 8)}...`);
    const response = await openai.chat.completions.create({
      model,
      messages: [{ role: "user", content: `Please speak the following text aloud in voice "${resolvedVoice}": ${text}` }]
    });
    const content = response.choices?.[0]?.message?.content || "";
    const urlMatch = content.match(/https?:\/\/\S+/);
    if (urlMatch) {
      const audioUrl = urlMatch[0].replace(/[)>.,]+$/, "");
      const audioRes = await import_axios.default.get(audioUrl, { responseType: "arraybuffer" });
      const base64Audio = Buffer.from(audioRes.data).toString("base64");
      console.log(`\u2705 Audio fetched from URL (${base64Audio.length} bytes)`);
      return { base64: base64Audio, model };
    }
    console.log(`\u26A0\uFE0F Audio model returned text instead of audio URL`);
    return { text: content, model };
  });
}
async function generateCodeReview(code, language, options = {}) {
  const keys = options.apiKey ? [options.apiKey, ...getAllOpenRouterKeys()] : getAllOpenRouterKeys();
  const langText = language || "the detected language";
  const model = await getBestCodeModel();
  console.log(`\u{1F50D} Code review model selected: ${model} (lang: ${langText})`);
  const prompt = `Review the following code. ${language ? `The language is ${language}.` : "Please auto-detect the language."}
Distinguish severity levels: 
- critical: crashes the program or major security risk.
- moderate: logic errors or performance issues.
- minor: style issues or best practices.

Special rules for Lua (if detected):
- Remember that single-argument calls like 'print "hello"' or 'func {a=1}' are valid syntax. Do not mark them as errors.

Provide a list of issues, a summary, and the fully corrected code.

Code:
\`\`\`${language || ""}
${code}
\`\`\``;
  return withFallback(keys, async (openai) => {
    const response = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: "You are a code reviewer. Output ONLY valid JSON matching this schema: { issues: [{ severity: 'critical'|'moderate'|'minor', line: number, issue: string, suggestion: string }], summary: string, correctedCode: string }"
        },
        { role: "user", content: prompt }
      ],
      response_format: { type: "json_object" }
    });
    const content = response.choices[0].message.content;
    if (!content) throw new Error("OpenRouter returned an empty response.");
    return JSON.parse(content);
  });
}
async function generateCodeFix(code, language, options = {}) {
  const keys = options.apiKey ? [options.apiKey, ...getAllOpenRouterKeys()] : getAllOpenRouterKeys();
  const model = await getBestCodeModel();
  console.log(`\u{1F6E0}\uFE0F Code fix model selected: ${model} (lang: ${language})`);
  const prompt = `Fix the following ${language} code. Output ONLY the corrected code block. No explanation.

Code:
\`\`\`${language}
${code}
\`\`\``;
  return withFallback(keys, async (openai) => {
    const response = await openai.chat.completions.create({
      model,
      messages: [{ role: "user", content: prompt }]
    });
    return response.choices[0].message.content || "No response from OpenRouter.";
  });
}

// bot/supabase.ts
var import_supabase_js = require("@supabase/supabase-js");
var _client = null;
function getSupabase() {
  if (!_client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error("SUPABASE_URL and SUPABASE_ANON_KEY must be set.");
    }
    _client = (0, import_supabase_js.createClient)(url, key);
  }
  return _client;
}

// bot/utils.ts
function fmt(n) {
  try {
    const val = typeof n === "string" ? parseInt(n, 10) : n;
    return (val || 0).toLocaleString();
  } catch (e) {
    return "0";
  }
}
function timeAgo(dateStr) {
  if (!dateStr) return "never";
  try {
    const dt = new Date(dateStr);
    const now = /* @__PURE__ */ new Date();
    const diffSeconds = Math.floor((now.getTime() - dt.getTime()) / 1e3);
    if (diffSeconds < 60) return `${diffSeconds}s ago`;
    if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
    if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
    return `${Math.floor(diffSeconds / 86400)}d ago`;
  } catch (e) {
    return "unknown";
  }
}
function fmtDate(dateStr) {
  if (!dateStr) return "N/A";
  try {
    const dt = new Date(dateStr);
    return dt.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    });
  } catch (e) {
    return "N/A";
  }
}
function codeBlock(lines) {
  return "```\n" + lines.join("\n") + "\n```";
}
function chunkString(str, size) {
  const chunks = [];
  for (let i = 0; i < str.length; i += size) {
    chunks.push(str.slice(i, i + size));
  }
  return chunks;
}

// bot/bot.ts
var import_axios2 = __toESM(require("axios"));
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
dotenv.config();
var DISCORD_TOKEN = process.env.DISCORD_TOKEN;
var VHXAI_TOKEN = process.env.VHXAI_TOKEN;
var GUILD_ID = process.env.GUILD_ID;
var EXECUTION_COUNT_CHANNEL_ID = process.env.EXECUTION_COUNT_CHANNEL_ID;
var BOT_COMMANDS_CHANNEL_ID = process.env.BOT_COMMANDS_CHANNEL_ID;
var CHAT_CHANNEL_ID = process.env.CHAT_CHANNEL_ID;
var ADMIN_DISCORD_ID = process.env.ADMIN_DISCORD_ID;
var VHXBOT_API_KEY = process.env.VHXBOT_API_KEY;
var VHXAI_API_KEY = process.env.VHXAI_API_KEY;
var VHXBOT_PROVIDER = process.env.VHXBOT_PROVIDER || "openrouter";
var VHXAI_PROVIDER = process.env.VHXAI_PROVIDER || "openrouter";
if (!DISCORD_TOKEN || !GUILD_ID) {
  console.error("\u274C DISCORD_TOKEN and GUILD_ID must be set.");
  console.log("Current Environment Variables (Keys):", Object.keys(process.env).filter((k) => k.includes("TOKEN") || k.includes("ID")));
} else {
  console.log("\u2705 Main Bot Tokens loaded.");
}
if (!VHXAI_TOKEN) {
  console.warn("\u26A0\uFE0F VHXAI_TOKEN is not set. vhxAI bot will not start.");
} else {
  console.log("\u2705 vhxAI Bot Token loaded.");
}
var client = new import_discord.Client({
  intents: [
    import_discord.GatewayIntentBits.Guilds,
    import_discord.GatewayIntentBits.GuildMessages,
    import_discord.GatewayIntentBits.MessageContent,
    import_discord.GatewayIntentBits.GuildMembers,
    import_discord.GatewayIntentBits.DirectMessages
  ],
  partials: [import_discord.Partials.Channel, import_discord.Partials.Message]
});
var vhxAI = new import_discord.Client({
  intents: [
    import_discord.GatewayIntentBits.Guilds,
    import_discord.GatewayIntentBits.GuildMessages,
    import_discord.GatewayIntentBits.MessageContent,
    import_discord.GatewayIntentBits.DirectMessages
  ],
  partials: [import_discord.Partials.Channel, import_discord.Partials.Message]
});
var botStatus = {
  main: "OFFLINE",
  vhxAI: "OFFLINE",
  slashCommands: "SUPPORTED"
};
var counterMessage = null;
var lastKnownCount = null;
var isAdmin = (interaction) => {
  const userId = typeof interaction === "string" ? interaction : interaction.user.id;
  return userId === ADMIN_DISCORD_ID;
};
async function getTotalExecutions() {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.from("game_executions").select("count");
    if (error) throw error;
    return data.reduce((acc, r) => acc + (r.count || 0), 0);
  } catch (e) {
    console.error(`\u274C Supabase error: ${e}`);
    return null;
  }
}
function buildCounterEmbed(total) {
  const now = /* @__PURE__ */ new Date();
  const ts = now.toLocaleString("en-US", { month: "2-digit", day: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: true });
  return new import_discord.EmbedBuilder().setTitle("Script Execution Counter").setColor(5793266).addFields({ name: "Total Executions", value: `\`\`\`
${fmt(total)}
\`\`\`` }).setFooter({ text: `Updates every 30s  \u2022  Last updated | ${ts}` });
}
async function updateCounterEmbed() {
  if (!EXECUTION_COUNT_CHANNEL_ID) return;
  const total = await getTotalExecutions();
  if (total === null) return;
  lastKnownCount = total;
  const channel = client.channels.cache.get(EXECUTION_COUNT_CHANNEL_ID);
  if (!channel) {
    console.error("\u274C Execution count channel not found");
    return;
  }
  const embed = buildCounterEmbed(total);
  try {
    if (!counterMessage) {
      const msgs = await channel.messages.fetch({ limit: 10 });
      const existing = msgs.find((m) => m.author.id === client.user?.id && m.embeds.length > 0);
      if (existing) {
        counterMessage = await existing.edit({ embeds: [embed] });
      } else {
        counterMessage = await channel.send({ embeds: [embed] });
      }
    } else {
      await counterMessage.edit({ embeds: [embed] });
    }
  } catch (e) {
    console.error(`\u274C Embed update failed: ${e}`);
    counterMessage = null;
  }
}
async function updateChannelName() {
  if (lastKnownCount === null || !EXECUTION_COUNT_CHANNEL_ID) return;
  const channel = client.channels.cache.get(EXECUTION_COUNT_CHANNEL_ID);
  if (!channel) return;
  const newName = `\u26A1 Executions \u203A ${fmt(lastKnownCount)}`;
  if (channel.name === newName) return;
  try {
    await channel.setName(newName);
  } catch (e) {
    if (e.status !== 429) {
      console.error(`\u274C Rename failed: ${e}`);
    }
  }
}
var commands = [
  new import_discord.SlashCommandBuilder().setName("ask").setDescription("Ask the AI assistant a question").addStringOption((option) => option.setName("question").setDescription("Your question").setRequired(true)),
  new import_discord.SlashCommandBuilder().setName("lookup").setDescription("View your profile via token").addStringOption((option) => option.setName("token").setDescription("Your token").setRequired(true)),
  new import_discord.SlashCommandBuilder().setName("lookup_user").setDescription("[Admin] Look up by username").addStringOption((option) => option.setName("username").setDescription("Roblox username").setRequired(true)),
  new import_discord.SlashCommandBuilder().setName("lookup_id").setDescription("[Admin] Look up by Roblox ID").addStringOption((option) => option.setName("roblox_id").setDescription("Roblox ID").setRequired(true)),
  new import_discord.SlashCommandBuilder().setName("stats").setDescription("Global execution overview"),
  new import_discord.SlashCommandBuilder().setName("stats_game").setDescription("Per-game stats").addStringOption((option) => option.setName("game_name").setDescription("Game name").setRequired(true)),
  new import_discord.SlashCommandBuilder().setName("stats_top").setDescription("Top games by executions"),
  new import_discord.SlashCommandBuilder().setName("ban").setDescription("[Admin] Ban a user").addStringOption((option) => option.setName("roblox_id").setDescription("Roblox ID").setRequired(true)).addStringOption((option) => option.setName("reason").setDescription("Reason").setRequired(true)),
  new import_discord.SlashCommandBuilder().setName("unban").setDescription("[Admin] Unban a user").addStringOption((option) => option.setName("roblox_id").setDescription("Roblox ID").setRequired(true)),
  new import_discord.SlashCommandBuilder().setName("maintenance").setDescription("[Admin] Toggle game maintenance").addStringOption((option) => option.setName("game_name").setDescription("Game name").setRequired(true)).addBooleanOption((option) => option.setName("enabled").setDescription("On or off").setRequired(true)),
  new import_discord.SlashCommandBuilder().setName("announce_add").setDescription("[Admin] Post announcement").addStringOption(
    (option) => option.setName("type").setDescription("Type").setRequired(true).addChoices(
      { name: "info", value: "info" },
      { name: "warning", value: "warning" },
      { name: "success", value: "success" },
      { name: "error", value: "error" }
    )
  ).addStringOption((option) => option.setName("message").setDescription("Message").setRequired(true)),
  new import_discord.SlashCommandBuilder().setName("announce_list").setDescription("List active announcements"),
  new import_discord.SlashCommandBuilder().setName("imagine").setDescription("Generate an AI image using OpenRouter").addStringOption((option) => option.setName("prompt").setDescription("The image prompt").setRequired(true)).addStringOption(
    (option) => option.setName("model").setDescription("The image model to use (defaults to best available)").addChoices(
      { name: "Riverflow v2 Pro", value: "sourceful/riverflow-v2-pro" },
      { name: "Riverflow v2 Fast", value: "sourceful/riverflow-v2-fast" },
      { name: "Flux.2 Klein 4B", value: "black-forest-labs/flux.2-klein-4b" }
    )
  ),
  new import_discord.SlashCommandBuilder().setName("vision").setDescription("Analyze an image using AI").addAttachmentOption((option) => option.setName("image").setDescription("The image to analyze").setRequired(true)).addStringOption((option) => option.setName("prompt").setDescription("What to ask about the image").setRequired(false)),
  new import_discord.SlashCommandBuilder().setName("speak").setDescription("Convert text to speech using AI audio models").addStringOption((option) => option.setName("text").setDescription("The text to speak").setRequired(true)).addStringOption(
    (option) => option.setName("voice").setDescription("The voice style to request").addChoices(
      { name: "Kore (Female)", value: "Kore" },
      { name: "Puck (Male)", value: "Puck" },
      { name: "Charon (Deep)", value: "Charon" },
      { name: "Fenrir (Gruff)", value: "Fenrir" },
      { name: "Zephyr (Soft)", value: "Zephyr" }
    )
  ),
  new import_discord.SlashCommandBuilder().setName("video").setDescription("Generate an AI video").addStringOption((option) => option.setName("prompt").setDescription("The video prompt").setRequired(true)),
  new import_discord.SlashCommandBuilder().setName("submit-script").setDescription("Submit a script for line-by-line AI review").addAttachmentOption((option) => option.setName("script").setDescription("The script file to review").setRequired(true)),
  new import_discord.SlashCommandBuilder().setName("review").setDescription("Review code from a file or URL").addAttachmentOption((option) => option.setName("file").setDescription("Code file to review").setRequired(false)).addStringOption((option) => option.setName("url").setDescription("URL to code file").setRequired(false)).addStringOption((option) => option.setName("language").setDescription("Programming language (optional, will auto-detect)").setRequired(false)),
  new import_discord.SlashCommandBuilder().setName("fix").setDescription("Get a corrected version of your code").addAttachmentOption((option) => option.setName("file").setDescription("Code file to fix").setRequired(false)).addStringOption((option) => option.setName("url").setDescription("URL to code file").setRequired(false)).addStringOption((option) => option.setName("language").setDescription("Programming language (optional, will auto-detect)").setRequired(false)),
  new import_discord.SlashCommandBuilder().setName("changelog_add").setDescription("[Admin] Add changelog entry").addStringOption((option) => option.setName("version").setDescription("Version").setRequired(true)).addStringOption((option) => option.setName("title").setDescription("Title").setRequired(true)).addStringOption((option) => option.setName("body").setDescription("Body").setRequired(true)),
  new import_discord.SlashCommandBuilder().setName("role_set").setDescription("[Admin] Set user role").addStringOption((option) => option.setName("discord_id").setDescription("Discord ID").setRequired(true)).addStringOption(
    (option) => option.setName("role").setDescription("Role").setRequired(true).addChoices(
      { name: "founder", value: "founder" },
      { name: "admin", value: "admin" },
      { name: "moderator", value: "moderator" }
    )
  ),
  new import_discord.SlashCommandBuilder().setName("help").setDescription("List all available commands")
].map((command) => command.toJSON());
async function registerCommands() {
  if (!DISCORD_TOKEN) return;
  const rest = new import_discord.REST({ version: "10" }).setToken(DISCORD_TOKEN);
  try {
    console.log("Started refreshing application (/) commands.");
    if (GUILD_ID) {
      await rest.put(
        import_discord.Routes.applicationGuildCommands(client.user?.id || "", GUILD_ID),
        { body: commands }
      );
      console.log(`\u2705 Guild commands registered for ${GUILD_ID}`);
    }
    await rest.put(
      import_discord.Routes.applicationCommands(client.user?.id || ""),
      { body: commands }
    );
    console.log("\u2705 Global commands registered (Badge update may take up to 1h)");
    botStatus.slashCommands = "ACTIVE";
  } catch (error) {
    console.error(`\u274C Command Registration Error: ${error}`);
    botStatus.slashCommands = "ERROR";
  }
}
var commandLogs = [];
var userHistory = /* @__PURE__ */ new Map();
function logCommand(user, avatar, command, response) {
  commandLogs.unshift({
    user,
    avatar,
    command,
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    response: response.length > 100 ? response.slice(0, 100) + "..." : response
  });
  if (commandLogs.length > 50) commandLogs.pop();
}
var COMMANDS_FILE = path.join(process.cwd(), "custom_commands.json");
var customCommands = /* @__PURE__ */ new Map();
function loadCustomCommands() {
  try {
    if (fs.existsSync(COMMANDS_FILE)) {
      const data = fs.readFileSync(COMMANDS_FILE, "utf8");
      const parsed = JSON.parse(data);
      Object.entries(parsed).forEach(([key, value]) => {
        customCommands.set(key.toLowerCase(), value);
      });
      console.log(`\u2705 Loaded ${customCommands.size} custom commands from file.`);
    }
  } catch (e) {
    console.error(`\u274C Failed to load custom commands: ${e}`);
  }
}
function saveCustomCommands() {
  try {
    const obj = Object.fromEntries(customCommands);
    fs.writeFileSync(COMMANDS_FILE, JSON.stringify(obj, null, 2));
  } catch (e) {
    console.error(`\u274C Failed to save custom commands: ${e}`);
  }
}
function addCustomCommand(name, response, createdBy) {
  customCommands.set(name.toLowerCase(), { name, response, createdBy });
  saveCustomCommands();
}
function removeCustomCommand(name) {
  customCommands.delete(name.toLowerCase());
  saveCustomCommands();
}
loadCustomCommands();
async function getDatabaseSnapshot() {
  try {
    const sb = getSupabase();
    const { data: execData } = await sb.from("game_executions").select("count");
    const totalExec = execData?.reduce((acc, r) => acc + (r.count || 0), 0) || 0;
    const { count: totalUsers } = await sb.from("unique_users").select("*", { count: "exact", head: true });
    const { count: activeScripts } = await sb.from("game_status").select("*", { count: "exact", head: true }).eq("maintenance", false);
    const { data: topGames } = await sb.from("game_executions").select("game_name,count").order("count", { ascending: false }).limit(3);
    const topGamesStr = topGames?.map((g) => `${g.game_name} (${fmt(g.count)})`).join(", ") || "None";
    return `You are the official VHX Assistant. VHX is a Roblox script service.
Current Live Stats:
- Total Script Executions: ${fmt(totalExec)}
- Total Unique Users: ${fmt(totalUsers || 0)}
- Active Scripts (Online): ${fmt(activeScripts || 0)}
- Top 3 Games: ${topGamesStr}

Instructions:
- Use the stats above to answer general questions about VHX performance.
- If a user asks for their personal profile, explain that they can use the /lookup [token] command.
- If they ask about a specific game's details, you can give them the general stats if available, or suggest /stats_game [name] for a deep dive.
- Be helpful, concise, and professional.`;
  } catch (e) {
    return "You are the VHX Assistant. Database stats are currently loading...";
  }
}
async function executeCommandLogic(commandName, options, userId = "DASHBOARD_TESTER", isUserAdmin = true) {
  if (customCommands.has(commandName.toLowerCase())) {
    return customCommands.get(commandName.toLowerCase()).response;
  }
  try {
    if (commandName === "help") {
      return new import_discord.EmbedBuilder().setTitle("VHX Bot Help").setColor(5793266).setDescription(codeBlock([
        `  /ask [question]     Ask the VHX Observer`,
        `  /lookup [token]     View your profile`,
        `  /stats              Global statistics`,
        `  /stats_game [name]  Per-game statistics`,
        `  /stats_top          Top games leaderboard`,
        `  /help               Show this message`,
        `  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`,
        `  Custom Commands:`,
        Array.from(customCommands.keys()).map((k) => `  /${k}`).join("\n") || "  None"
      ]));
    }
    if (commandName === "ask") {
      const question = options.question || "Hello";
      try {
        const snapshot = await getDatabaseSnapshot();
        let history = userHistory.get(userId) || [];
        history.push({ role: "user", content: question });
        if (history.length > 10) history = history.slice(-10);
        const aiResponse = await generateAI(history, snapshot, {
          provider: VHXBOT_PROVIDER,
          apiKey: VHXBOT_API_KEY
        });
        const response = aiResponse.text;
        const groundingUrls = aiResponse.groundingUrls || [];
        history.push({ role: "assistant", content: response });
        userHistory.set(userId, history);
        const embed = new import_discord.EmbedBuilder().setTitle("VHX Observer").setDescription(response.length > 4e3 ? response.slice(0, 4e3) + "..." : response).setColor(5793266);
        if (groundingUrls.length > 0) {
          const sources = groundingUrls.map((u) => `\u2022 [${u.title}](${u.uri})`).join("\n");
          embed.addFields({ name: "Sources", value: sources.length > 1024 ? sources.slice(0, 1021) + "..." : sources });
        }
        return embed;
      } catch (aiError) {
        return `\u274C **AI Error:** ${aiError.message}`;
      }
    }
    if (commandName === "lookup" || commandName === "lookup_user" || commandName === "lookup_id") {
      const sb = getSupabase();
      const token = options.token;
      const username = options.username;
      const robloxId = options.roblox_id;
      let foundUser = null;
      if (commandName === "lookup" && token) {
        const { data: tokenData } = await sb.from("user_tokens").select("roblox_user_id").eq("token", token).single();
        if (tokenData) {
          const { data: user } = await sb.from("unique_users").select("*").eq("roblox_user_id", tokenData.roblox_user_id).single();
          foundUser = user;
        } else {
          const { data: user } = await sb.from("unique_users").select("*").ilike("username", `%${token}%`).limit(1).single();
          foundUser = user;
        }
      } else if (commandName === "lookup_user" && username) {
        if (!isUserAdmin) return "\u274C Admin only.";
        const { data: user } = await sb.from("unique_users").select("*").ilike("username", username).limit(1).single();
        foundUser = user;
      } else if (commandName === "lookup_id" && robloxId) {
        if (!isUserAdmin) return "\u274C Admin only.";
        const { data: user } = await sb.from("unique_users").select("*").eq("roblox_user_id", robloxId).limit(1).single();
        foundUser = user;
      }
      if (!foundUser) return "\u274C User not found.";
      return new import_discord.EmbedBuilder().setTitle("Player Profile").setColor(5793266).setDescription(codeBlock([
        `  Username        ${foundUser.username || "N/A"}`,
        `  Roblox ID       ${foundUser.roblox_user_id || "N/A"}`,
        `  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`,
        `  First Seen      ${fmtDate(foundUser.first_seen)}`,
        `  Last Seen       ${timeAgo(foundUser.last_seen)}`,
        `  Executions      ${fmt(foundUser.execution_count)}`,
        `  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`,
        `  Country         ${foundUser.country_name || "Unknown"}`,
        `  City            ${foundUser.city || "Unknown"}`
      ]));
    }
    if (commandName === "stats") {
      const sb = getSupabase();
      const { data: execData } = await sb.from("game_executions").select("count,daily_count,last_executed_at");
      const totalExec = execData?.reduce((acc, r) => acc + (r.count || 0), 0) || 0;
      const todayExec = execData?.reduce((acc, r) => acc + (r.daily_count || 0), 0) || 0;
      const lastExec = execData?.sort((a, b) => new Date(b.last_executed_at).getTime() - new Date(a.last_executed_at).getTime())[0];
      const { count: totalUsers } = await sb.from("unique_users").select("*", { count: "exact", head: true });
      const yesterday = new Date(Date.now() - 864e5).toISOString();
      const { count: activeUsers } = await sb.from("unique_users").select("*", { count: "exact", head: true }).gte("last_seen", yesterday);
      const { count: newUsers } = await sb.from("unique_users").select("*", { count: "exact", head: true }).gte("first_seen", yesterday);
      const { count: activeScripts } = await sb.from("game_status").select("*", { count: "exact", head: true }).eq("maintenance", false);
      return new import_discord.EmbedBuilder().setTitle("Global Statistics").setColor(1752220).setDescription(codeBlock([
        `  Total Executions    ${fmt(totalExec)}`,
        `  Today               ${fmt(todayExec)}`,
        `  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`,
        `  Active Users (24h)  ${fmt(activeUsers || 0)}`,
        `  New Users (24h)     ${fmt(newUsers || 0)}`,
        `  Total Users         ${fmt(totalUsers || 0)}`,
        `  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`,
        `  Last Execution      ${lastExec ? timeAgo(lastExec.last_executed_at) : "N/A"}`,
        `  Active Scripts      ${fmt(activeScripts || 0)}`
      ]));
    }
    if (commandName === "stats_game") {
      const sb = getSupabase();
      const gameName = options.game_name;
      if (!gameName) return "\u274C Missing game name.";
      const { data: gd } = await sb.from("game_executions").select("*").ilike("game_name", `%${gameName}%`);
      if (!gd || gd.length === 0) return "\u274C Game not found.";
      const totalCount = gd.reduce((acc, r) => acc + (r.count || 0), 0);
      const dailyCount = gd.reduce((acc, r) => acc + (r.daily_count || 0), 0);
      const lastExecuted = gd.sort((a, b) => new Date(b.last_executed_at).getTime() - new Date(a.last_executed_at).getTime())[0].last_executed_at;
      const actualGameName = gd[0].game_name;
      const { data: s } = await sb.from("game_status").select("maintenance").ilike("game_name", `%${gameName}%`).single();
      const status = s?.maintenance ? "MAINTENANCE" : "ONLINE";
      return new import_discord.EmbedBuilder().setTitle("Game Stats").setColor(1752220).setDescription(codeBlock([
        `  Game            ${actualGameName}`,
        `  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`,
        `  Total           ${fmt(totalCount)}`,
        `  Today           ${fmt(dailyCount)}`,
        `  Last Executed   ${timeAgo(lastExecuted)}`,
        `  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`,
        `  Status          ${status}`
      ]));
    }
    if (commandName === "stats_top") {
      const sb = getSupabase();
      const { data: games } = await sb.from("game_executions").select("game_name,count").order("count", { ascending: false }).limit(10);
      if (!games || games.length === 0) return "\u274C No data.";
      const lines = games.map((g, idx) => `  #${(idx + 1).toString().padEnd(3)} ${(g.game_name || "Unknown").padEnd(24)}${fmt(g.count)}`);
      return new import_discord.EmbedBuilder().setTitle("Top Games").setColor(1752220).setDescription(codeBlock(lines));
    }
    if (commandName === "ban") {
      if (!isUserAdmin) return "\u274C No permission.";
      const sb = getSupabase();
      const robloxId = options.roblox_id;
      const reason = options.reason || "No reason provided";
      if (!robloxId) return "\u274C Missing Roblox ID.";
      const { data: u } = await sb.from("unique_users").select("username").eq("roblox_user_id", robloxId).limit(1).single();
      const username = u?.username || "Unknown";
      await sb.from("banned_users").upsert({ roblox_user_id: robloxId, username, reason });
      await sb.from("audit_log").insert({ action: "ban_user", details: { roblox_user_id: robloxId, username, reason, by: userId } });
      return new import_discord.EmbedBuilder().setTitle("User Banned").setColor(15548997).setDescription(codeBlock([`  Username    ${username}`, `  Roblox ID   ${robloxId}`, `  \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`, `  Reason      ${reason}`]));
    }
    if (commandName === "maintenance") {
      if (!isUserAdmin) return "\u274C No permission.";
      const sb = getSupabase();
      const gameName = options.game_name;
      const enabled = options.enabled;
      if (!gameName) return "\u274C Missing game name.";
      const { data: g } = await sb.from("game_status").select("game_name").ilike("game_name", `%${gameName}%`).single();
      if (!g) return "\u274C Game not found.";
      await sb.from("game_status").update({ maintenance: enabled }).ilike("game_name", `%${gameName}%`);
      await sb.from("audit_log").insert({ action: "maintenance_toggle", details: { game: g.game_name, enabled, by: userId } });
      return new import_discord.EmbedBuilder().setTitle(enabled ? "\u{1F527} Maintenance Enabled" : "\u2705 Maintenance Disabled").setColor(enabled ? 15105570 : 5763719).setDescription(codeBlock([`  Game    ${g.game_name}`, `  Status  ${enabled ? "MAINTENANCE" : "ONLINE"}`]));
    }
    if (commandName === "announce_list") {
      const sb = getSupabase();
      const { data: anns } = await sb.from("announcements").select("*").order("created_at", { ascending: false }).limit(5);
      if (!anns || anns.length === 0) return "\u274C No active announcements.";
      return new import_discord.EmbedBuilder().setTitle("Recent Announcements").setColor(5793266).setDescription(anns.map((a) => `**[${a.type.toUpperCase()}]** ${a.message}`).join("\n\n"));
    }
    if (commandName === "imagine") {
      const prompt = options.prompt;
      const model = options.model || null;
      if (!prompt) return "\u274C Missing prompt.";
      try {
        const resolvedModel = model || await getBestImageModel();
        const imageUrl = await generateImage(prompt, {
          apiKey: VHXBOT_API_KEY,
          model: resolvedModel
        });
        return new import_discord.EmbedBuilder().setTitle("AI Image Generation").setDescription(`**Prompt:** ${prompt}
**Model:** ${resolvedModel}`).setImage(imageUrl).setColor(5793266).setFooter({ text: "Powered by OpenRouter" });
      } catch (err) {
        return `\u274C **Image Generation Error:** ${err.message}`;
      }
    }
    if (commandName === "vision") {
      const imageUrl = options.image_url;
      const prompt = options.prompt || "Describe this image in detail.";
      const mimeType = options.mime_type || "image/png";
      if (!imageUrl) return "\u274C Missing image.";
      try {
        const response = await import_axios2.default.get(imageUrl, { responseType: "arraybuffer" });
        const base64 = Buffer.from(response.data, "binary").toString("base64");
        const analysis = await generateVision(prompt, base64, mimeType, {
          apiKey: VHXBOT_API_KEY,
          provider: VHXBOT_PROVIDER
        });
        return new import_discord.EmbedBuilder().setTitle("AI Vision Analysis").setDescription(`**Prompt:** ${prompt}

${analysis}`).setThumbnail(imageUrl).setColor(5793266);
      } catch (err) {
        return `\u274C **Vision Error:** ${err.message}`;
      }
    }
    if (commandName === "speak") {
      const text = options.text;
      const voice = options.voice || "alloy";
      if (!text) return "\u274C Missing text.";
      try {
        const ttsResult = await generateTTS(text, { apiKey: VHXBOT_API_KEY, voice });
        if (ttsResult.base64) {
          const buffer = Buffer.from(ttsResult.base64, "base64");
          return {
            content: `\u{1F5E3}\uFE0F **Model:** ${ttsResult.model}\n**Voice:** ${voice}\n**Text:** ${text}`,
            files: [{ attachment: buffer, name: "speech.mp3" }]
          };
        } else {
          // Model returned text instead of audio
          return `\u{1F5E3}\uFE0F **Model:** ${ttsResult.model}\n**Voice:** ${voice}\n**Response:** ${ttsResult.text}`;
        }
      } catch (err) {
        return `\u274C **TTS Error:** ${err.message}`;
      }
    }
    if (commandName === "video") {
      const prompt = options.prompt;
      if (!prompt) return "\u274C Missing prompt.";
      try {
        const model = await getBestVideoModel();
        const keys = VHXBOT_API_KEY ? [VHXBOT_API_KEY, ...getAllOpenRouterKeys()] : getAllOpenRouterKeys();
        const key = keys[0];
        // Try OpenRouter video generation endpoint
        let videoUrl = null;
        try {
          const vidRes = await import_axios.default.post(
            "https://openrouter.ai/api/v1/images/generations",
            { model, prompt, n: 1 },
            {
              headers: {
                "Authorization": `Bearer ${key}`,
                "Content-Type": "application/json",
                "HTTP-Referer": "https://discord.com",
                "X-Title": "VHX Bot Assistant"
              }
            }
          );
          videoUrl = vidRes.data?.data?.[0]?.url || null;
        } catch (vidErr) {
          console.warn(`\u26A0\uFE0F Video generations endpoint failed: ${vidErr.message}`);
        }
        // Fallback to chat completions
        if (!videoUrl) {
          const openai = createOpenRouterClient(key);
          const response = await openai.chat.completions.create({
            model,
            messages: [{ role: "user", content: prompt }]
          });
          const content2 = response.choices?.[0]?.message?.content || "";
          const urlMatch = content2.match(/https?:\/\/\S+/);
          videoUrl = urlMatch ? urlMatch[0].replace(/[)>.,]+$/, "") : null;
          if (!videoUrl) {
            return `\uD83C\uDFA5 **Model:** ${model}\n\nVideo generation is not yet supported for this model on OpenRouter. Try a different prompt or check back later.\n\n**Raw response:** ${content2}`;
          }
        }
        return new import_discord.EmbedBuilder()
          .setTitle("AI Video Generation")
          .setDescription(`**Prompt:** ${prompt}\n**Model:** ${model}\n**Video:** [Click to view](${videoUrl})`)
          .setColor(5793266)
          .setFooter({ text: "Powered by OpenRouter" });
      } catch (err) {
        return `\u274C **Video Error:** ${err.message}`;
      }
    }
    if (commandName === "submit-script" || commandName === "review") {
      const codeUrl = options.script_url || options.file_url || options.url;
      let language = options.language;
      console.log(`\u{1F50D} Review command triggered. URL: ${codeUrl}, Lang: ${language}`);
      if (!codeUrl) return "\u274C Missing code file or URL. Please upload a file or provide a URL.";
      try {
        const response = await import_axios2.default.get(codeUrl);
        const codeContent = typeof response.data === "string" ? response.data : JSON.stringify(response.data, null, 2);
        if (!codeContent || codeContent.trim() === "") {
          return "\u274C The provided code file/URL is empty.";
        }
        if (codeContent.length > 2e4) {
          return "\u274C Code is too large (max 20,000 characters).";
        }
        if (!language) {
          const ext = codeUrl.split("?")[0].split(".").pop()?.toLowerCase();
          if (ext === "lua") language = "lua";
          else if (["js", "mjs", "cjs"].includes(ext || "")) language = "javascript";
          else if (["ts", "tsx"].includes(ext || "")) language = "typescript";
          else if (ext === "py") language = "python";
          else if (ext === "cpp" || ext === "h") language = "cpp";
          else if (ext === "cs") language = "csharp";
          else if (ext === "java") language = "java";
          else if (ext === "go") language = "go";
        }
        console.log(`\u{1F50D} Sending code to AI for review (Lang: ${language || "Auto"})...`);
        const review = await generateCodeReview(codeContent, language, {
          apiKey: VHXBOT_API_KEY,
          provider: VHXBOT_PROVIDER
        });
        console.log(`\u2705 AI Review completed. Issues found: ${review.issues.length}`);
        const embed = new import_discord.EmbedBuilder().setTitle(`${(language || "Detected Language").toUpperCase()} Code Review`).setDescription(review.summary.length > 2e3 ? review.summary.slice(0, 2e3) + "..." : review.summary).setColor(5793266).setTimestamp();
        review.issues.slice(0, 10).forEach((issue, index) => {
          const severityEmoji = issue.severity === "critical" ? "\u{1F534}" : issue.severity === "moderate" ? "\u{1F7E0}" : "\u{1F7E1}";
          embed.addFields({
            name: `${severityEmoji} Issue #${index + 1} (${issue.severity.toUpperCase()})`,
            value: `**Line:** ${issue.line || "N/A"}
**Problem:** ${issue.issue}
**Fix:** ${issue.suggestion}`
          });
        });
        if (review.issues.length > 10) {
          embed.setFooter({ text: `...and ${review.issues.length - 10} more issues. See corrected code below.` });
        }
        const langForExt = language || "txt";
        const fileExtension = langForExt.toLowerCase() === "lua" ? "lua" : ["javascript", "js"].includes(langForExt.toLowerCase()) ? "js" : ["typescript", "ts"].includes(langForExt.toLowerCase()) ? "ts" : "txt";
        const buffer = Buffer.from(review.correctedCode, "utf-8");
        return {
          embeds: [embed],
          files: [{
            attachment: buffer,
            name: `reviewed_code.${fileExtension}`
          }],
          correctedCode: review.correctedCode,
          language
        };
      } catch (err) {
        return `\u274C **Review Error:** ${err.message}`;
      }
    }
    if (commandName === "fix") {
      const codeUrl = options.file_url || options.url;
      let language = options.language;
      if (!codeUrl) return "\u274C Missing code file or URL.";
      try {
        const response = await import_axios2.default.get(codeUrl);
        const codeContent = typeof response.data === "string" ? response.data : JSON.stringify(response.data, null, 2);
        if (codeContent.length > 2e4) {
          return "\u274C Code is too large (max 20,000 characters).";
        }
        if (!language) {
          const ext = codeUrl.split(".").pop()?.toLowerCase();
          if (ext === "lua") language = "lua";
          else if (["js", "mjs", "cjs"].includes(ext || "")) language = "javascript";
          else if (["ts", "tsx"].includes(ext || "")) language = "typescript";
          else if (ext === "py") language = "python";
        }
        const fixedCode = await generateCodeFix(codeContent, language || "lua", {
          apiKey: VHXBOT_API_KEY,
          provider: VHXBOT_PROVIDER
        });
        const fileExtension = language ? language.toLowerCase() === "lua" ? "lua" : ["javascript", "js"].includes(language.toLowerCase()) ? "js" : ["typescript", "ts"].includes(language.toLowerCase()) ? "ts" : "txt" : "txt";
        const buffer = Buffer.from(fixedCode, "utf-8");
        return {
          content: `\u2705 **Corrected ${(language || "Code").toUpperCase()}:**`,
          files: [{
            attachment: buffer,
            name: `fixed_code.${fileExtension}`
          }],
          correctedCode: fixedCode,
          language: language || "lua"
        };
      } catch (err) {
        return `\u274C **Fix Error:** ${err.message}`;
      }
    }
    return "\u274C Command logic not implemented for tester yet.";
  } catch (e) {
    console.error(`\u274C Logic Error: ${e}`);
    return "\u274C Execution failed.";
  }
}
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const { commandName, channelId } = interaction;
  const userTag = interaction.user.tag;
  const userAvatar = interaction.user.displayAvatarURL();
  if (BOT_COMMANDS_CHANNEL_ID && channelId !== BOT_COMMANDS_CHANNEL_ID && !isAdmin(interaction)) {
    return await interaction.reply({
      content: `\u274C Commands can only be used in <#${BOT_COMMANDS_CHANNEL_ID}>.`,
      ephemeral: true
    });
  }
  if (commandName === "ask" || commandName === "imagine" || commandName === "submit-script" || commandName === "vision" || commandName === "speak" || commandName === "review" || commandName === "fix") {
    await interaction.deferReply();
    if (commandName === "ask") {
      await interaction.editReply("\u{1F50D} **Searching and thinking...**");
    } else if (commandName === "review" || commandName === "submit-script") {
      await interaction.editReply("\u{1F50D} **Analyzing your code...**");
    }
  }
  try {
    const result = await executeCommandLogic(commandName, {
      question: interaction.options.getString("question"),
      token: interaction.options.getString("token"),
      game_name: interaction.options.getString("game_name"),
      roblox_id: interaction.options.getString("roblox_id"),
      username: interaction.options.getString("username"),
      reason: interaction.options.getString("reason"),
      enabled: interaction.options.getBoolean("enabled"),
      type: interaction.options.getString("type"),
      message: interaction.options.getString("message"),
      script_url: interaction.options.getAttachment("script")?.url,
      file_url: interaction.options.getAttachment("file")?.url,
      url: interaction.options.getString("url"),
      language: interaction.options.getString("language"),
      image_url: interaction.options.getAttachment("image")?.url,
      mime_type: interaction.options.getAttachment("image")?.contentType,
      prompt: interaction.options.getString("prompt"),
      text: interaction.options.getString("text"),
      voice: interaction.options.getString("voice")
    }, interaction.user.id, isAdmin(interaction));
    if (typeof result === "string") {
      logCommand(userTag, userAvatar, `/${commandName}`, result);
      if (interaction.deferred) {
        return await interaction.editReply({ content: result });
      }
      return await interaction.reply(result);
    } else if (result instanceof import_discord.EmbedBuilder) {
      if (interaction.deferred) {
        await interaction.editReply({ content: "", embeds: [result] });
      } else {
        await interaction.reply({ embeds: [result] });
      }
      logCommand(userTag, userAvatar, `/${commandName}`, "Embed response");
      return;
    } else if (result.correctedCode) {
      const data = result;
      const embeds = data.embeds || [];
      const content = data.content || "";
      const files = data.files || [];
      if (interaction.deferred) {
        await interaction.editReply({ content: content || "", embeds, files });
      } else {
        await interaction.reply({ content, embeds, files });
      }
      if (data.correctedCode.length < 4e3) {
        const codeBlock2 = `\`\`\`${data.language}
${data.correctedCode}
\`\`\``;
        const chunks = chunkString(codeBlock2, 2e3);
        for (const chunk of chunks) {
          await interaction.followUp({ content: chunk });
        }
      } else {
        await interaction.followUp({ content: "\u2139\uFE0F Corrected code is too long for a preview. Please download the attached file." });
      }
      logCommand(userTag, userAvatar, `/${commandName}`, "Review/Fix response");
      return;
    } else {
      if (interaction.deferred) {
        await interaction.editReply(result);
      } else {
        await interaction.reply(result);
      }
      logCommand(userTag, userAvatar, `/${commandName}`, "File response");
      return;
    }
  } catch (error) {
    console.error(`\u274C Interaction Error: ${error}`);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply("\u274C An error occurred while processing your request.");
    } else {
      await interaction.reply({ content: "\u274C An error occurred while processing your request.", ephemeral: true });
    }
  }
});
var VHXBOT_TRIGGER_WORDS = (process.env.VHXBOT_TRIGGER_WORDS || "!vhx,!bot,!ask").split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);
async function handleChatbotMessage(message, botClient) {
  if (message.author.bot) return;
  const botId = botClient.user?.id;
  const isMentioned = botId ? message.mentions.has(botId) : false;
  const isDM = !message.guild;
  const isChatChannel = CHAT_CHANNEL_ID && message.channelId === CHAT_CHANNEL_ID;
  const isMainBot = botClient === client;
  const msgLower = message.content.toLowerCase();
  const hasTrigger = VHXBOT_TRIGGER_WORDS.some((w) => msgLower.startsWith(w));
  if (isMainBot && !isMentioned && !isDM && !hasTrigger) return;
  if (isMentioned || isDM || isChatChannel || hasTrigger) {
    console.log(`\u{1F916} Chatbot triggered by ${message.author.tag} in ${message.guild ? message.guild.name : "DM"}`);
    try {
      if ("sendTyping" in message.channel) {
        await message.channel.sendTyping();
      }
      const mentionRegex = new RegExp(`<@!?${botClient.user?.id}>`, "g");
      const triggerRegex = new RegExp(`^(${VHXBOT_TRIGGER_WORDS.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\s*`, "i");
      const prompt = message.content.replace(mentionRegex, "").replace(triggerRegex, "").trim();
      if (!prompt && isMentioned) {
        return await message.reply("Hello! How can I help you today?");
      }
      if (!prompt) return;
      const snapshot = isMainBot ? await getDatabaseSnapshot() : void 0;
      const aiOptions = isMainBot ? { provider: VHXBOT_PROVIDER, apiKey: VHXBOT_API_KEY } : { provider: VHXAI_PROVIDER, apiKey: VHXAI_API_KEY };
      let history = userHistory.get(message.author.id) || [];
      const discordContext = `[Discord Context: User=${message.author.username}, Channel=${message.channel.name || "DM"}, Guild=${message.guild?.name || "DM"}]`;
      history.push({ role: "user", content: `${discordContext}
${prompt}` });
      if (history.length > 10) history = history.slice(-10);
      const aiResponse = await generateAI(history, snapshot, aiOptions);
      const response = aiResponse.text;
      history.push({ role: "assistant", content: response });
      userHistory.set(message.author.id, history);
      let finalResponse = response;
      if (aiResponse.groundingUrls && aiResponse.groundingUrls.length > 0) {
        finalResponse += "\n\n**Sources:**\n" + aiResponse.groundingUrls.map((u) => `\u2022 [${u.title}](${u.uri})`).join("\n");
      }
      const chunks = chunkString(finalResponse, 1900);
      for (let i = 0; i < chunks.length; i++) {
        if (i === 0) {
          await message.reply(chunks[i]);
        } else if (message.channel && "send" in message.channel) {
          await message.channel.send(chunks[i]);
        }
      }
      const botName = isMainBot ? "[vhxBOT]" : "[vhxAI]";
      logCommand(message.author.tag, message.author.displayAvatarURL(), `${botName} ${prompt}`, response);
    } catch (e) {
      console.error(`\u274C Chatbot Error: ${e}`);
      await message.reply(`\u274C **Chatbot Error:** ${e.message || "An unexpected error occurred."}`);
    }
  }
}
vhxAI.on("messageCreate", (message) => {
  if (VHXAI_TOKEN) {
    handleChatbotMessage(message, vhxAI);
  }
});
vhxAI.once("ready", () => {
  console.log(`\u2705 vhxAI logged in as ${vhxAI.user?.tag}`);
  botStatus.vhxAI = "ONLINE";
  vhxAI.user?.setActivity({
    name: "Minecraft",
    type: import_discord.ActivityType.Playing
  });
});
client.on("messageCreate", (message) => {
  if (DISCORD_TOKEN) {
    handleChatbotMessage(message, client);
  }
});
client.once("ready", async () => {
  console.log(`\u2705 Logged in as ${client.user?.tag}`);
  botStatus.main = "ONLINE";
  client.user?.setActivity({
    name: "Roblox",
    type: import_discord.ActivityType.Playing
  });
  await registerCommands();
  await updateCounterEmbed();
  setInterval(updateCounterEmbed, 3e4);
  setInterval(updateChannelName, 3e5);
});
function startBot() {
  if (DISCORD_TOKEN) {
    client.login(DISCORD_TOKEN).catch((e) => console.error(`\u274C Main Bot Login Failed: ${e}`));
  } else {
    console.warn("\u26A0\uFE0F DISCORD_TOKEN not found. Main bot will not start.");
  }
  if (VHXAI_TOKEN) {
    vhxAI.login(VHXAI_TOKEN).catch((e) => console.error(`\u274C vhxAI Login Failed: ${e}`));
  } else {
    console.warn("\u26A0\uFE0F VHXAI_TOKEN not found. vhxAI bot will not start.");
  }
}

// server.ts
dotenv2.config();
var app = (0, import_express.default)();
var port = 3e3;
app.use(import_express.default.json());
app.use(import_express.default.urlencoded({ extended: true }));
app.set("trust proxy", 1);
app.post("/api/commands", (req, res) => {
  const { name, response } = req.body;
  if (!name || !response) return res.status(400).json({ error: "Missing name or response" });
  addCustomCommand(name, response, "API");
  res.json({ ok: true });
});
app.post("/api/commands/delete", (req, res) => {
  const { name } = req.body;
  removeCustomCommand(name);
  res.json({ ok: true });
});
app.post("/api/logs/clear", (req, res) => {
  commandLogs.length = 0;
  res.json({ ok: true });
});
app.get("/api/analytics", async (req, res) => {
  try {
    const commandCounts = {};
    commandLogs.forEach((log) => {
      const cmd = log.command.split(" ")[0].replace("/", "");
      commandCounts[cmd] = (commandCounts[cmd] || 0) + 1;
    });
    const now = /* @__PURE__ */ new Date();
    const hourlyUsage = {};
    for (let i = 0; i < 24; i++) {
      const d = new Date(now.getTime() - i * 36e5);
      const hourStr = d.getHours().toString().padStart(2, "0") + ":00";
      hourlyUsage[hourStr] = 0;
    }
    commandLogs.forEach((log) => {
      const d = new Date(log.timestamp);
      const hourStr = d.getHours().toString().padStart(2, "0") + ":00";
      if (hourlyUsage[hourStr] !== void 0) {
        hourlyUsage[hourStr]++;
      }
    });
    let gameExecs = [];
    try {
      const sb = getSupabase();
      const { data } = await sb.from("game_executions").select("game_name, count").order("count", { ascending: false }).limit(5);
      gameExecs = data || [];
    } catch (e) {
      console.error("Supabase analytics error:", e);
    }
    res.json({
      commandCounts,
      hourlyUsage: Object.entries(hourlyUsage).reverse().map(([hour, count]) => ({ hour, count })),
      gameExecs
    });
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});
app.post("/api/test-command", async (req, res) => {
  const { command, options } = req.body;
  if (!command) return res.status(400).json({ error: "Command name is required" });
  try {
    const result = await executeCommandLogic(command, options || {}, "DASHBOARD_TESTER", true);
    if (typeof result === "string") {
      res.json({ type: "text", content: result });
    } else {
      res.json({ type: "embed", content: result.toJSON() });
    }
  } catch (error) {
    console.error(`\u274C Test Command Error: ${error}`);
    res.status(500).json({ error: "Command execution failed" });
  }
});
app.get("/", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});
app.listen(port, () => {
  console.log(`\u{1F680} Status server running at http://localhost:${port}`);
  startBot();
});
