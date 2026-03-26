"""
Configuration file for VHX Bot
Environment variables and constants
"""
import os
from dotenv import load_dotenv

load_dotenv()

# Discord Configuration
DISCORD_TOKEN = os.getenv("DISCORD_TOKEN")
GUILD_ID = int(os.getenv("GUILD_ID")) if os.getenv("GUILD_ID") else None
EXECUTION_COUNT_CHANNEL_ID = int(os.getenv("EXECUTION_COUNT_CHANNEL_ID")) if os.getenv("EXECUTION_COUNT_CHANNEL_ID") else None
BOT_COMMANDS_CHANNEL_ID = int(os.getenv("BOT_COMMANDS_CHANNEL_ID")) if os.getenv("BOT_COMMANDS_CHANNEL_ID") else None
CHAT_CHANNEL_ID = int(os.getenv("CHAT_CHANNEL_ID")) if os.getenv("CHAT_CHANNEL_ID") else None
ADMIN_DISCORD_ID = int(os.getenv("ADMIN_DISCORD_ID")) if os.getenv("ADMIN_DISCORD_ID") else None

# Logging Channels
LOG_DELETED_MESSAGES_CHANNEL_ID = int(os.getenv("LOG_DELETED_MESSAGES_CHANNEL_ID")) if os.getenv("LOG_DELETED_MESSAGES_CHANNEL_ID") else None
LOG_EDITED_MESSAGES_CHANNEL_ID = int(os.getenv("LOG_EDITED_MESSAGES_CHANNEL_ID")) if os.getenv("LOG_EDITED_MESSAGES_CHANNEL_ID") else None
LOG_MEMBER_CHANNEL_ID = int(os.getenv("LOG_MEMBER_CHANNEL_ID")) if os.getenv("LOG_MEMBER_CHANNEL_ID") else None
LOG_MODERATION_CHANNEL_ID = int(os.getenv("LOG_MODERATION_CHANNEL_ID")) if os.getenv("LOG_MODERATION_CHANNEL_ID") else None

# AI Providers
NVIDIA_API_KEY = os.getenv("NVIDIA_API_KEY")
GROQ_API_KEY = os.getenv("GROQ_API_KEY")

# External APIs
SERP_API_KEY = os.getenv("SERP_API_KEY", "")
WEATHER_API_KEY = os.getenv("WEATHER_API_KEY", "")

# Supabase
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")

# Moderation Settings
AUTO_MOD_ENABLED = os.getenv("AUTO_MOD_ENABLED", "true").lower() == "true"
PROFANITY_FILTER_ENABLED = os.getenv("PROFANITY_FILTER_ENABLED", "true").lower() == "true"
ANTI_SPAM_ENABLED = os.getenv("ANTI_SPAM_ENABLED", "true").lower() == "true"
ANTI_RAID_ENABLED = os.getenv("ANTI_RAID_ENABLED", "true").lower() == "true"

# Warn System Thresholds
WARN_MUTE_THRESHOLD = int(os.getenv("WARN_MUTE_THRESHOLD", "3"))
WARN_KICK_THRESHOLD = int(os.getenv("WARN_KICK_THRESHOLD", "5"))
WARN_BAN_THRESHOLD = int(os.getenv("WARN_BAN_THRESHOLD", "10"))

# Economy Settings
ECONOMY_ENABLED = os.getenv("ECONOMY_ENABLED", "true").lower() == "true"
DAILY_REWARD_AMOUNT = int(os.getenv("DAILY_REWARD_AMOUNT", "100"))
CURRENCY_NAME = os.getenv("CURRENCY_NAME", "coins")
CURRENCY_SYMBOL = os.getenv("CURRENCY_SYMBOL", "🪙")

# Leveling Settings
LEVELING_ENABLED = os.getenv("LEVELING_ENABLED", "true").lower() == "true"
XP_PER_MESSAGE = int(os.getenv("XP_PER_MESSAGE", "15"))
XP_PER_VOICE_MINUTE = int(os.getenv("XP_PER_VOICE_MINUTE", "10"))

# Anti-Spam Settings
SPAM_MESSAGE_THRESHOLD = int(os.getenv("SPAM_MESSAGE_THRESHOLD", "5"))
SPAM_TIME_WINDOW = int(os.getenv("SPAM_TIME_WINDOW", "5"))  # seconds

# Constants
EMBED_COLOR = 0x5865F2
SUCCESS_COLOR = 0x57F287
ERROR_COLOR = 0xED4245
WARNING_COLOR = 0xFEE75C
INFO_COLOR = 0x1ABC9C
