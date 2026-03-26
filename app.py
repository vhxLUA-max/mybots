#!/usr/bin/env python3
"""
VHX Bot – Fully functional Discord bot with AI, stats, moderation, and custom commands.
Uses NVIDIA NIM and Groq for AI tasks.
"""

import os
import re
import json
import asyncio
import logging
from datetime import datetime
from typing import Optional, Dict, List, Any, Tuple
from collections import defaultdict
from io import BytesIO

import discord
from discord.ext import commands, tasks
from discord import app_commands
import aiohttp
from supabase import create_client, Client
from dotenv import load_dotenv

# ------------------------------------------------------------------------------
#  Environment & Logging
# ------------------------------------------------------------------------------
load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Discord
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
GUILD_ID = int(os.getenv("GUILD_ID")) if os.getenv("GUILD_ID") else None
EXECUTION_COUNT_CHANNEL_ID = int(os.getenv("EXECUTION_COUNT_CHANNEL_ID")) if os.getenv("EXECUTION_COUNT_CHANNEL_ID") else None
BOT_COMMANDS_CHANNEL_ID = int(os.getenv("BOT_COMMANDS_CHANNEL_ID")) if os.getenv("BOT_COMMANDS_CHANNEL_ID") else None
CHAT_CHANNEL_ID = int(os.getenv("CHAT_CHANNEL_ID")) if os.getenv("CHAT_CHANNEL_ID") else None
ADMIN_DISCORD_ID = int(os.getenv("ADMIN_DISCORD_ID")) if os.getenv("ADMIN_DISCORD_ID") else None

# AI Providers
NVIDIA_API_KEY = os.getenv("NVIDIA_API_KEY")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

# External APIs
SERP_API_KEY = os.getenv("SERP_API_KEY", "")
WEATHER_API_KEY = os.getenv("WEATHER_API_KEY", "")

# Supabase
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")

# ------------------------------------------------------------------------------
#  Database (Supabase)
# ------------------------------------------------------------------------------
class Database:
    def __init__(self):
        self.client: Optional[Client] = None

    async def init(self):
        if SUPABASE_URL and SUPABASE_ANON_KEY:
            self.client = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
            logger.info("✅ Supabase client initialized")

    async def get_total_executions(self) -> int:
        if not self.client:
            return 0
        try:
            result = self.client.table("game_executions").select("count").execute()
            return sum(item.get("count", 0) for item in result.data) if result.data else 0
        except Exception:
            return 0

    async def get_game_stats(self, game_name: str = None):
        if not self.client:
            return None
        try:
            if game_name:
                result = self.client.table("game_executions").select("*").like("game_name", f"%{game_name}%").execute()
                return result.data
            result = self.client.table("game_executions").select("*").execute()
            return result.data
        except Exception:
            return None

    async def get_top_games(self, limit: int = 10):
        if not self.client:
            return []
        try:
            result = self.client.table("game_executions").select("game_name,count").order("count", desc=True).limit(limit).execute()
            return result.data or []
        except Exception:
            return []

    async def get_user_profile(self, token: str = None, username: str = None, roblox_id: str = None):
        if not self.client:
            return None
        try:
            if token:
                token_result = self.client.table("user_tokens").select("roblox_user_id").eq("token", token).execute()
                if token_result.data:
                    result = self.client.table("unique_users").select("*").eq("roblox_user_id", token_result.data[0]["roblox_user_id"]).execute()
                    return result.data[0] if result.data else None
            elif username:
                result = self.client.table("unique_users").select("*").like("username", f"%{username}%").limit(1).execute()
                return result.data[0] if result.data else None
            elif roblox_id:
                result = self.client.table("unique_users").select("*").eq("roblox_user_id", roblox_id).limit(1).execute()
                return result.data[0] if result.data else None
        except Exception as e:
            logger.error(f"User lookup failed: {e}")
        return None

    async def ban_user(self, roblox_id: str, reason: str, by_user: int):
        if not self.client:
            return False
        try:
            user = await self.get_user_profile(roblox_id=roblox_id)
            username = user.get("username", "Unknown") if user else "Unknown"
            self.client.table("banned_users").upsert({
                "roblox_user_id": roblox_id,
                "username": username,
                "reason": reason
            }).execute()
            self.client.table("audit_log").insert({
                "action": "ban_user",
                "details": {"roblox_user_id": roblox_id, "username": username, "reason": reason, "by": by_user}
            }).execute()
            return True
        except Exception as e:
            logger.error(f"Ban failed: {e}")
            return False

    async def unban_user(self, roblox_id: str, by_user: int):
        if not self.client:
            return False
        try:
            self.client.table("banned_users").delete().eq("roblox_user_id", roblox_id).execute()
            self.client.table("audit_log").insert({
                "action": "unban_user",
                "details": {"roblox_user_id": roblox_id, "by": by_user}
            }).execute()
            return True
        except Exception:
            return False

    async def toggle_maintenance(self, game_name: str, enabled: bool, by_user: int):
        if not self.client:
            return False
        try:
            self.client.table("game_status").update({"maintenance": enabled}).like("game_name", f"%{game_name}%").execute()
            self.client.table("audit_log").insert({
                "action": "maintenance_toggle",
                "details": {"game": game_name, "enabled": enabled, "by": by_user}
            }).execute()
            return True
        except Exception:
            return False

    async def add_announcement(self, type: str, message: str):
        if not self.client:
            return False
        try:
            self.client.table("announcements").insert({"type": type, "message": message}).execute()
            return True
        except Exception:
            return False

    async def get_announcements(self, limit: int = 5):
        if not self.client:
            return []
        try:
            result = self.client.table("announcements").select("*").order("created_at", desc=True).limit(limit).execute()
            return result.data or []
        except Exception:
            return []

db = Database()

# ------------------------------------------------------------------------------
#  Utilities
# ------------------------------------------------------------------------------
def fmt_number(n):
    try:
        return f"{int(n):,}"
    except (ValueError, TypeError):
        return "0"

def time_ago(dt_str: str) -> str:
    if not dt_str:
        return "never"
    try:
        dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
        diff = (datetime.utcnow() - dt).total_seconds()
        if diff < 60:
            return f"{int(diff)}s ago"
        elif diff < 3600:
            return f"{int(diff // 60)}m ago"
        elif diff < 86400:
            return f"{int(diff // 3600)}h ago"
        else:
            return f"{int(diff // 86400)}d ago"
    except:
        return "never"

def fmt_date(dt_str: str) -> str:
    if not dt_str:
        return "N/A"
    try:
        dt = datetime.fromisoformat(dt_str.replace("Z", "+00:00"))
        return dt.strftime("%b %d, %Y")
    except:
        return "N/A"

async def web_search(query: str) -> str:
    if not SERP_API_KEY:
        return "Web search unavailable – set SERP_API_KEY."
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                "https://serpapi.com/search",
                params={"q": query, "api_key": SERP_API_KEY, "num": 3}
            ) as resp:
                data = await resp.json()
                results = data.get("organic_results", [])
                if not results:
                    return "No results found."
                output = []
                for i, r in enumerate(results[:3]):
                    output.append(f"{i+1}. **{r.get('title', '')}**\n{r.get('snippet', '')}\n{r.get('link', '')}")
                return "\n\n".join(output)
    except Exception as e:
        return f"Search error: {e}"

def calculate(expr: str) -> str:
    try:
        safe_expr = re.sub(r"[^0-9+\-*/.()% \t]", "", expr)
        if not safe_expr.strip():
            return "Invalid expression."
        result = eval(safe_expr, {"__builtins__": {}}, {})
        return f"{expr} = {result}"
    except Exception as e:
        return f"Calculation error: {e}"

async def get_weather(location: str) -> str:
    if not WEATHER_API_KEY:
        return "Weather unavailable – set WEATHER_API_KEY."
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(
                "https://api.openweathermap.org/data/2.5/weather",
                params={"q": location, "appid": WEATHER_API_KEY, "units": "metric"}
            ) as resp:
                data = await resp.json()
                if data.get("cod") != 200:
                    return f"Weather error: {data.get('message', 'Unknown')}"
                return (f"**{data['name']}, {data['sys']['country']}** – {data['weather'][0]['description']}\n"
                        f"Temp: {data['main']['temp']}°C, Humidity: {data['main']['humidity']}%")
    except Exception as e:
        return f"Weather error: {e}"

# ------------------------------------------------------------------------------
#  AI Client (NVIDIA NIM + Groq)
# ------------------------------------------------------------------------------
class AIClient:
    def __init__(self):
        self.nvidia_client = None
        self.groq_client = None
        if NVIDIA_API_KEY:
            try:
                from openai import OpenAI
                self.nvidia_client = OpenAI(
                    base_url="https://integrate.api.nvidia.com/v1",
                    api_key=NVIDIA_API_KEY
                )
                logger.info("✅ NVIDIA NIM client initialized")
            except Exception as e:
                logger.error(f"NVIDIA init failed: {e}")
        if GROQ_API_KEY:
            try:
                from groq import Groq
                self.groq_client = Groq(api_key=GROQ_API_KEY)
                logger.info("✅ Groq client initialized")
            except Exception as e:
                logger.error(f"Groq init failed: {e}")

    async def chat_completion(
        self,
        messages: List[Dict],
        model: str,
        temperature: float = 0.7,
        max_tokens: int = 1024,
        tools: Optional[List[Dict]] = None,
        stream: bool = False
    ):
        # Route to appropriate client based on model
        if model.startswith("tiiuae/") or model.startswith("nvidia/"):
            if not self.nvidia_client:
                raise ValueError("NVIDIA client not configured")
            client = self.nvidia_client
            params = {
                "model": model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            }
            if tools:
                params["tools"] = tools
                params["tool_choice"] = "auto"
            if stream:
                params["stream"] = True
                return client.chat.completions.create(**params)
            else:
                return client.chat.completions.create(**params)
        else:
            if not self.groq_client:
                raise ValueError("Groq client not configured")
            client = self.groq_client
            params = {
                "model": model,
                "messages": messages,
                "temperature": temperature,
                "max_tokens": max_tokens,
            }
            if tools:
                params["tools"] = tools
                params["tool_choice"] = "auto"
            if stream:
                params["stream"] = True
                return client.chat.completions.create(**params)
            else:
                return client.chat.completions.create(**params)

    async def generate_text(
        self,
        prompt: str,
        system: Optional[str] = None,
        model: Optional[str] = None,
        temperature: float = 0.7,
        max_tokens: int = 1024,
        tools: Optional[List[Dict]] = None
    ) -> Tuple[str, List[str]]:
        messages = []
        if system:
            messages.append({"role": "system", "content": system})
        messages.append({"role": "user", "content": prompt})

        if not model:
            # Default: use Groq's GPT-OSS if available, else NVIDIA falcon
            model = "openai/gpt-oss-120b" if self.groq_client else "tiiuae/falcon3-7b-instruct"

        response = await self.chat_completion(
            messages=messages,
            model=model,
            temperature=temperature,
            max_tokens=max_tokens,
            tools=tools
        )
        msg = response.choices[0].message
        if msg.tool_calls:
            # For simplicity, we don't implement recursive tool calling here;
            # but the /ask command uses a separate loop.
            return msg.content or "", []
        return msg.content or "", []

ai_client = AIClient()

# Tool definitions for function calling
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "Search the web for current information.",
            "parameters": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"]}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "calculate",
            "description": "Evaluate a math expression.",
            "parameters": {"type": "object", "properties": {"expression": {"type": "string"}}, "required": ["expression"]}
        }
    },
    {
        "type": "function",
        "function": {
            "name": "weather",
            "description": "Get current weather for a city.",
            "parameters": {"type": "object", "properties": {"location": {"type": "string"}}, "required": ["location"]}
        }
    }
]

async def dispatch_tool(name: str, args: Dict) -> str:
    if name == "web_search":
        return await web_search(args.get("query", ""))
    elif name == "calculate":
        return calculate(args.get("expression", ""))
    elif name == "weather":
        return await get_weather(args.get("location", ""))
    return f"Unknown tool: {name}"

SYSTEM_PROMPT = """You are a helpful assistant in a Discord server. Keep responses concise and use markdown. You have tools: web_search, calculate, weather. Use them when needed."""

# ------------------------------------------------------------------------------
#  Custom Commands (non‑AI)
# ------------------------------------------------------------------------------
class CustomCommands:
    def __init__(self, filename: str = "custom_commands.json"):
        self.filename = filename
        self.commands: Dict[str, Dict] = {}
        self.load()

    def load(self):
        try:
            if os.path.exists(self.filename):
                with open(self.filename, "r") as f:
                    data = json.load(f)
                    self.commands = {k.lower(): v for k, v in data.items()}
                logger.info(f"✅ Loaded {len(self.commands)} custom commands")
        except Exception as e:
            logger.error(f"❌ Load custom commands: {e}")

    def save(self):
        try:
            with open(self.filename, "w") as f:
                json.dump({k: v for k, v in self.commands.items()}, f, indent=2)
        except Exception as e:
            logger.error(f"❌ Save custom commands: {e}")

    def add(self, name: str, response: str, created_by: str):
        self.commands[name.lower()] = {"name": name, "response": response, "created_by": created_by}
        self.save()

    def remove(self, name: str):
        if name.lower() in self.commands:
            del self.commands[name.lower()]
            self.save()

    def get(self, name: str) -> Optional[str]:
        cmd = self.commands.get(name.lower())
        return cmd["response"] if cmd else None

custom_commands = CustomCommands()

# ------------------------------------------------------------------------------
#  Discord Bot
# ------------------------------------------------------------------------------
class VHXBot(commands.Bot):
    def __init__(self):
        intents = discord.Intents.default()
        intents.message_content = True
        intents.guild_messages = True
        intents.guilds = True
        intents.members = True
        super().__init__(command_prefix="!", intents=intents)
        self.counter_message: Optional[discord.Message] = None
        self.last_known_count: Optional[int] = None
        self.active_quizzes: Dict[int, Dict] = {}  # channel_id -> quiz data

    async def setup_hook(self):
        await db.init()
        await self.tree.sync()
        self.update_counter.start()
        self.update_channel_name.start()
        logger.info("✅ Bot setup complete")

    @tasks.loop(seconds=30)
    async def update_counter(self):
        if not EXECUTION_COUNT_CHANNEL_ID:
            return
        await self.wait_until_ready()
        total = await db.get_total_executions()
        if total is None:
            return
        self.last_known_count = total
        channel = self.get_channel(EXECUTION_COUNT_CHANNEL_ID)
        if not channel:
            return
        embed = discord.Embed(
            title="Script Execution Counter",
            color=0x5865F2
        )
        embed.add_field(name="Total Executions", value=f"```\n{fmt_number(total)}\n```")
        embed.set_footer(text=f"Updates every 30s • Last updated | {datetime.utcnow().strftime('%m/%d/%Y %I:%M %p')}")
        try:
            if not self.counter_message:
                async for msg in channel.history(limit=10):
                    if msg.author == self.user and msg.embeds:
                        self.counter_message = msg
                        await msg.edit(embed=embed)
                        break
                if not self.counter_message:
                    self.counter_message = await channel.send(embed=embed)
            else:
                await self.counter_message.edit(embed=embed)
        except Exception as e:
            logger.error(f"Counter update failed: {e}")
            self.counter_message = None

    @tasks.loop(minutes=5)
    async def update_channel_name(self):
        if not self.last_known_count or not EXECUTION_COUNT_CHANNEL_ID:
            return
        await self.wait_until_ready()
        channel = self.get_channel(EXECUTION_COUNT_CHANNEL_ID)
        if not channel:
            return
        new_name = f"⚡ Executions › {fmt_number(self.last_known_count)}"
        if channel.name != new_name:
            try:
                await channel.edit(name=new_name)
            except discord.HTTPException as e:
                if e.status != 429:
                    logger.error(f"Rename failed: {e}")

    @update_counter.before_loop
    async def before_update_counter(self):
        await self.wait_until_ready()

    @update_channel_name.before_loop
    async def before_update_channel_name(self):
        await self.wait_until_ready()

    async def on_ready(self):
        logger.info(f"✅ Logged in as {self.user}")
        await self.change_presence(activity=discord.Game(name="VHX Assistant"))

    async def on_message(self, message: discord.Message):
        if message.author.bot:
            return

        # Custom commands (!command)
        if message.content.startswith("!"):
            parts = message.content[1:].split()
            if parts:
                cmd_name = parts[0].lower()
                response = custom_commands.get(cmd_name)
                if response:
                    await message.channel.send(response)
                    return

        # Quiz answers
        if message.channel.id in self.active_quizzes:
            quiz = self.active_quizzes[message.channel.id]
            answer = message.content.strip().upper()
            if answer in ["A", "B", "C", "D"]:
                q = quiz["questions"][quiz["current"]]
                correct = answer == q["answer"]
                if message.author.id not in quiz["scores"]:
                    quiz["scores"][message.author.id] = 0
                if correct:
                    quiz["scores"][message.author.id] += 1
                await message.reply(
                    f"✅ Correct! {q['explanation']}" if correct
                    else f"❌ Wrong! The answer was **{q['answer']}**. {q['explanation']}"
                )
                quiz["current"] += 1
                if quiz["current"] >= len(quiz["questions"]):
                    # Quiz finished
                    scores = sorted(quiz["scores"].items(), key=lambda x: x[1], reverse=True)
                    score_lines = [f"  <@{uid}>  {score}/{len(quiz['questions'])}" for uid, score in scores]
                    embed = discord.Embed(
                        title=f"🏆 Quiz Over: {quiz['topic']}",
                        color=0x1ABC9C,
                        description="\n".join(score_lines) or "No scores."
                    )
                    await message.channel.send(embed=embed)
                    del self.active_quizzes[message.channel.id]
                else:
                    nq = quiz["questions"][quiz["current"]]
                    embed = discord.Embed(
                        title=f"📚 Quiz: {quiz['topic']}  ({quiz['current']+1}/{len(quiz['questions'])})",
                        description=f"**{nq['question']}**\n\n" + "\n".join(nq["options"]),
                        color=0x5865F2
                    )
                    embed.set_footer(text="Reply with A, B, C, or D")
                    await message.channel.send(embed=embed)
                return

        # Chatbot
        is_mentioned = self.user in message.mentions
        is_chat_channel = CHAT_CHANNEL_ID and message.channel.id == CHAT_CHANNEL_ID
        trigger_words = ["!vhx", "!bot", "!ask"]
        has_trigger = any(message.content.lower().startswith(w) for w in trigger_words)

        if is_mentioned or is_chat_channel or has_trigger:
            # Extract prompt
            prompt = message.content
            for w in trigger_words:
                if prompt.lower().startswith(w):
                    prompt = prompt[len(w):].strip()
            for mention in message.mentions:
                prompt = prompt.replace(f"<@{mention.id}>", "").replace(f"<@!{mention.id}>", "").strip()
            if not prompt and is_mentioned:
                await message.reply("Hello! How can I help?")
                return
            if prompt:
                async with message.channel.typing():
                    try:
                        answer, _ = await ai_client.generate_text(prompt, system=SYSTEM_PROMPT)
                        for chunk in [answer[i:i+1900] for i in range(0, len(answer), 1900)]:
                            if chunk == answer[:1900]:
                                await message.reply(chunk)
                            else:
                                await message.channel.send(chunk)
                    except Exception as e:
                        await message.reply(f"❌ AI error: {e}")
                return

        # Process commands if any
        await self.process_commands(message)

bot = VHXBot()

# ------------------------------------------------------------------------------
#  Slash Commands
# ------------------------------------------------------------------------------

# ---- AI-powered commands ----
@bot.tree.command(name="ask", description="Ask AI (web search, calculator, weather)")
@app_commands.describe(question="Your question")
async def ask(interaction: discord.Interaction, question: str):
    await interaction.response.defer()
    # Use Groq model with tools if available, else fallback to NVIDIA without tools
    try:
        model = "openai/gpt-oss-120b" if ai_client.groq_client else None
        messages = [{"role": "user", "content": question}]
        # First call with tools
        response = await ai_client.chat_completion(
            messages=messages,
            model=model,
            tools=TOOLS,
            temperature=0.7,
            max_tokens=1024
        )
        msg = response.choices[0].message
        if msg.tool_calls:
            # Execute tools
            for tc in msg.tool_calls:
                args = json.loads(tc.function.arguments)
                result = await dispatch_tool(tc.function.name, args)
                messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})
            # Second call with results
            response2 = await ai_client.chat_completion(
                messages=messages,
                model=model,
                temperature=0.7,
                max_tokens=1024
            )
            answer = response2.choices[0].message.content or "No response."
        else:
            answer = msg.content or "No response."
    except Exception as e:
        logger.warning(f"Tool call failed, falling back: {e}")
        answer, _ = await ai_client.generate_text(question, system=SYSTEM_PROMPT, model="tiiuae/falcon3-7b-instruct")
    await interaction.followup.send(answer[:2000])

@bot.tree.command(name="review", description="Review code with AI")
@app_commands.describe(code="Paste code", language="Language (optional)")
async def review(interaction: discord.Interaction, code: str, language: str = None):
    await interaction.response.defer()
    prompt = f"Review this {language or 'code'} and return a JSON object with 'summary', 'issues', and 'fixed_code'. Issues should be list of objects with 'severity', 'line', 'issue', 'suggestion'.\n\n```{language or ''}\n{code}\n```"
    try:
        response, _ = await ai_client.generate_text(
            prompt,
            system="You are an expert code reviewer. Output only JSON.",
            model="openai/gpt-oss-120b" if ai_client.groq_client else "tiiuae/falcon3-7b-instruct",
            temperature=0.2,
            max_tokens=4096
        )
        # Extract JSON
        json_match = re.search(r"\{[\s\S]*\}", response)
        if json_match:
            data = json.loads(json_match.group())
        else:
            data = json.loads(response)
        summary = data.get("summary", "Review complete.")
        issues = data.get("issues", [])
        fixed_code = data.get("fixed_code", code)

        embed = discord.Embed(title="Code Review", description=summary[:2000], color=0x5865F2)
        for i, issue in enumerate(issues[:5]):
            severity = issue.get("severity", "minor")
            emoji = "🔴" if severity == "critical" else ("🟠" if severity == "moderate" else "🟡")
            embed.add_field(
                name=f"{emoji} Issue #{i+1} (Line {issue.get('line', '?')})",
                value=f"**Problem:** {issue.get('issue', '')}\n**Fix:** {issue.get('suggestion', '')}",
                inline=False
            )
        await interaction.followup.send(embed=embed)
        if fixed_code != code:
            file = discord.File(BytesIO(fixed_code.encode()), filename=f"fixed.{language or 'txt'}")
            await interaction.followup.send("Fixed code:", file=file)
    except Exception as e:
        await interaction.followup.send(f"❌ Failed to parse review: {e}\n```{response}```")

@bot.tree.command(name="quiz", description="Generate a quiz on a topic")
@app_commands.describe(topic="Topic", questions="Number of questions (1-10)")
async def quiz(interaction: discord.Interaction, topic: str, questions: int = 5):
    await interaction.response.defer()
    prompt = f"Generate a {questions}-question multiple-choice quiz about '{topic}'. Return ONLY a JSON array: [{{'question':str,'options':[str],'answer':str,'explanation':str}}]"
    try:
        response, _ = await ai_client.generate_text(prompt, temperature=0.7, max_tokens=4096)
        json_match = re.search(r"\[[\s\S]*\]", response)
        if json_match:
            data = json.loads(json_match.group())
        else:
            data = json.loads(response)
        bot.active_quizzes[interaction.channel_id] = {
            "questions": data,
            "current": 0,
            "scores": {},
            "topic": topic
        }
        q = data[0]
        embed = discord.Embed(
            title=f"📚 Quiz: {topic} (1/{len(data)})",
            description=f"**{q['question']}**\n\n" + "\n".join(q["options"]),
            color=0x5865F2
        )
        embed.set_footer(text="Reply with A, B, C, or D")
        await interaction.followup.send(embed=embed)
    except Exception as e:
        await interaction.followup.send(f"❌ Failed to generate quiz: {e}")

# ---- Non‑AI commands ----
@bot.tree.command(name="lookup", description="View your profile via token")
@app_commands.describe(token="Your token")
async def lookup(interaction: discord.Interaction, token: str):
    user = await db.get_user_profile(token=token)
    if not user:
        await interaction.response.send_message("❌ User not found.", ephemeral=True)
        return
    embed = discord.Embed(title="Player Profile", color=0x5865F2)
    embed.add_field(name="Username", value=user.get("username", "N/A"), inline=False)
    embed.add_field(name="Roblox ID", value=user.get("roblox_user_id", "N/A"), inline=False)
    embed.add_field(name="First Seen", value=fmt_date(user.get("first_seen")), inline=True)
    embed.add_field(name="Last Seen", value=time_ago(user.get("last_seen")), inline=True)
    embed.add_field(name="Executions", value=fmt_number(user.get("execution_count", 0)), inline=True)
    embed.add_field(name="Country", value=user.get("country_name", "Unknown"), inline=True)
    embed.add_field(name="City", value=user.get("city", "Unknown"), inline=True)
    await interaction.response.send_message(embed=embed)

@bot.tree.command(name="stats", description="Global execution overview")
async def stats(interaction: discord.Interaction):
    await interaction.response.defer()
    game_stats = await db.get_game_stats()
    total_exec = sum(s.get("count", 0) for s in game_stats) if game_stats else 0
    today_exec = sum(s.get("daily_count", 0) for s in game_stats) if game_stats else 0
    top_games = await db.get_top_games(5)
    embed = discord.Embed(title="Global Statistics", color=0x1ABC9C)
    embed.add_field(name="Total Executions", value=fmt_number(total_exec), inline=True)
    embed.add_field(name="Today", value=fmt_number(today_exec), inline=True)
    embed.add_field(name="\u200b", value="\u200b", inline=True)
    if top_games:
        top_list = "\n".join(f"**{i+1}.** {g['game_name']} — {fmt_number(g['count'])}" for i, g in enumerate(top_games))
        embed.add_field(name="Top Games", value=top_list[:1024], inline=False)
    await interaction.followup.send(embed=embed)

@bot.tree.command(name="stats_game", description="Per-game stats")
@app_commands.describe(game_name="Game name")
async def stats_game(interaction: discord.Interaction, game_name: str):
    await interaction.response.defer()
    stats_data = await db.get_game_stats(game_name)
    if not stats_data:
        await interaction.followup.send("❌ Game not found.")
        return
    total_count = sum(s.get("count", 0) for s in stats_data)
    daily_count = sum(s.get("daily_count", 0) for s in stats_data)
    last_exec = max((s.get("last_executed_at") for s in stats_data if s.get("last_executed_at")), default=None)
    embed = discord.Embed(title="Game Stats", color=0x1ABC9C)
    embed.add_field(name="Game", value=stats_data[0]["game_name"], inline=False)
    embed.add_field(name="Total", value=fmt_number(total_count), inline=True)
    embed.add_field(name="Today", value=fmt_number(daily_count), inline=True)
    embed.add_field(name="Last Executed", value=time_ago(last_exec) if last_exec else "N/A", inline=True)
    await interaction.followup.send(embed=embed)

@bot.tree.command(name="stats_top", description="Top games by executions")
async def stats_top(interaction: discord.Interaction):
    await interaction.response.defer()
    top_games = await db.get_top_games(10)
    if not top_games:
        await interaction.followup.send("❌ No data available.")
        return
    lines = [f"**{i+1}.** {g['game_name']} — {fmt_number(g['count'])}" for i, g in enumerate(top_games)]
    embed = discord.Embed(title="Top Games", description="\n".join(lines), color=0x1ABC9C)
    await interaction.followup.send(embed=embed)

@bot.tree.command(name="search", description="Web search")
@app_commands.describe(query="Search query")
async def search(interaction: discord.Interaction, query: str):
    await interaction.response.defer()
    results = await web_search(query)
    embed = discord.Embed(title=f"🔍 Search: {query}", description=results[:4000], color=0x5865F2)
    await interaction.followup.send(embed=embed)

@bot.tree.command(name="weather", description="Get current weather")
@app_commands.describe(location="City name")
async def weather(interaction: discord.Interaction, location: str):
    await interaction.response.defer()
    result = await get_weather(location)
    embed = discord.Embed(title=f"🌤 Weather: {location}", description=result, color=0x1ABC9C)
    await interaction.followup.send(embed=embed)

@bot.tree.command(name="calc", description="Calculate a math expression")
@app_commands.describe(expression="e.g. (5+3)*2")
async def calc(interaction: discord.Interaction, expression: str):
    result = calculate(expression)
    await interaction.response.send_message(f"🧮 **{result}**")

@bot.tree.command(name="help", description="List all available commands")
async def help_command(interaction: discord.Interaction):
    commands_list = [
        "`/ask [question]` - Ask AI (web search, calculator, weather)",
        "`/review [code]` - Review code with AI",
        "`/quiz [topic]` - Generate a quiz",
        "`/lookup [token]` - View your profile",
        "`/stats` - Global statistics",
        "`/stats_game [name]` - Per-game stats",
        "`/stats_top` - Top games",
        "`/search [query]` - Web search",
        "`/weather [city]` - Current weather",
        "`/calc [expression]` - Calculator",
    ]
    custom = [f"`/{k}`" for k in custom_commands.commands.keys()]
    if custom:
        commands_list.append(f"\n**Custom Commands:**\n{', '.join(custom)}")
    embed = discord.Embed(title="VHX Bot Help", description="\n".join(commands_list), color=0x5865F2)
    await interaction.response.send_message(embed=embed)

# Admin commands
@bot.tree.command(name="ban", description="[Admin] Ban a user")
@app_commands.describe(roblox_id="Roblox ID", reason="Reason")
async def ban(interaction: discord.Interaction, roblox_id: str, reason: str):
    if interaction.user.id != ADMIN_DISCORD_ID:
        await interaction.response.send_message("❌ Admin only.", ephemeral=True)
        return
    success = await db.ban_user(roblox_id, reason, interaction.user.id)
    if success:
        embed = discord.Embed(title="User Banned", color=0xED4245)
        embed.add_field(name="Roblox ID", value=roblox_id, inline=False)
        embed.add_field(name="Reason", value=reason, inline=False)
        await interaction.response.send_message(embed=embed)
    else:
        await interaction.response.send_message("❌ Failed to ban user.")

@bot.tree.command(name="unban", description="[Admin] Unban a user")
@app_commands.describe(roblox_id="Roblox ID")
async def unban(interaction: discord.Interaction, roblox_id: str):
    if interaction.user.id != ADMIN_DISCORD_ID:
        await interaction.response.send_message("❌ Admin only.", ephemeral=True)
        return
    success = await db.unban_user(roblox_id, interaction.user.id)
    if success:
        await interaction.response.send_message(f"✅ Unbanned `{roblox_id}`.")
    else:
        await interaction.response.send_message("❌ Failed to unban user.")

@bot.tree.command(name="maintenance", description="[Admin] Toggle maintenance")
@app_commands.describe(game_name="Game name", enabled="On or off")
async def maintenance(interaction: discord.Interaction, game_name: str, enabled: bool):
    if interaction.user.id != ADMIN_DISCORD_ID:
        await interaction.response.send_message("❌ Admin only.", ephemeral=True)
        return
    success = await db.toggle_maintenance(game_name, enabled, interaction.user.id)
    if success:
        color = 0xED4245 if enabled else 0x57F287
        embed = discord.Embed(
            title="🔧 Maintenance Enabled" if enabled else "✅ Maintenance Disabled",
            color=color
        )
        embed.add_field(name="Game", value=game_name, inline=False)
        embed.add_field(name="Status", value="MAINTENANCE" if enabled else "ONLINE", inline=False)
        await interaction.response.send_message(embed=embed)
    else:
        await interaction.response.send_message("❌ Failed to toggle maintenance.")

@bot.tree.command(name="announce_add", description="[Admin] Add announcement")
@app_commands.describe(type="Announcement type", message="Message")
async def announce_add(interaction: discord.Interaction, type: str, message: str):
    if interaction.user.id != ADMIN_DISCORD_ID:
        await interaction.response.send_message("❌ Admin only.", ephemeral=True)
        return
    success = await db.add_announcement(type, message)
    if success:
        await interaction.response.send_message(f"✅ Announcement posted: **[{type.upper()}]** {message}")
    else:
        await interaction.response.send_message("❌ Failed to add announcement.")

@bot.tree.command(name="announce_list", description="List active announcements")
async def announce_list(interaction: discord.Interaction):
    announcements = await db.get_announcements(5)
    if not announcements:
        await interaction.response.send_message("❌ No active announcements.")
        return
    lines = [f"**[{a['type'].upper()}]** {a['message']}" for a in announcements]
    embed = discord.Embed(title="Recent Announcements", description="\n\n".join(lines), color=0x5865F2)
    await interaction.response.send_message(embed=embed)

@bot.tree.command(name="custom", description="[Admin] Add or remove custom command")
@app_commands.describe(action="add or remove", name="Command name", response="Response text (for add)")
async def custom_command(interaction: discord.Interaction, action: str, name: str, response: str = None):
    if interaction.user.id != ADMIN_DISCORD_ID:
        await interaction.response.send_message("❌ Admin only.", ephemeral=True)
        return
    if action.lower() == "add":
        if not response:
            await interaction.response.send_message("❌ Response required for add.", ephemeral=True)
            return
        custom_commands.add(name, response, interaction.user.name)
        await interaction.response.send_message(f"✅ Added custom command `/{name}`")
    elif action.lower() == "remove":
        custom_commands.remove(name)
        await interaction.response.send_message(f"✅ Removed custom command `/{name}`")
    else:
        await interaction.response.send_message("❌ Invalid action. Use 'add' or 'remove'.", ephemeral=True)

# ------------------------------------------------------------------------------
#  Run the bot
# ------------------------------------------------------------------------------
async def main():
    async with bot:
        await bot.start(DISCORD_TOKEN)

if __name__ == "__main__":
    asyncio.run(main())
