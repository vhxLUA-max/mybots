# VHX Bot - Advanced Discord Bot

A feature-rich Discord bot with AI integration, moderation, economy system, leveling, and more!

## 🌟 Features

### 🔧 Moderation & Security
- **Auto-moderation** - AI-powered detection of spam, profanity, harassment, and links
- **Comprehensive Logging** - Separate channels for deleted messages, edited messages, member joins/leaves, and moderation actions
- **Warn System** - Track warnings with auto-escalation (3 warns = mute, 5 = kick, 10 = ban)
- **Mute System** - Temporary role-based muting with automatic expiry
- **Anti-Spam** - Detect and prevent message spam and link spam
- **Anti-Raid** - Detect mass joins and suspicious activity
- **Moderation Commands** - Warn, mute, kick, ban with full logging

### 💰 Economy System
- **Currency System** - Server-specific economy with customizable currency
- **Daily Rewards** - Claim daily rewards every 24 hours
- **Gambling Games** - Slots, coinflip, and dice games
- **Shop System** - Buy items, roles, and perks with earned currency
- **Leaderboards** - Track top earners in each server

### 📊 Leveling System
- **XP & Levels** - Earn XP from messages and level up
- **Rank Cards** - View your current level, XP progress, and total XP
- **Leaderboards** - Compete with others for the highest level
- **Configurable** - Adjust XP rates and requirements

### 🤖 AI Features
- **AI Chat** - Powered by NVIDIA NIM and Groq
- **Code Review** - Get AI-powered code reviews
- **Quiz Generation** - Generate quizzes on any topic
- **Web Search** - Search the web directly from Discord
- **Weather** - Get current weather information
- **Calculator** - Perform calculations

### 📈 Analytics & Stats
- **Server Statistics** - Track game executions and bot usage
- **User Info** - Extended user profiles with warnings, level, and balance
- **Game Stats** - Per-game statistics and leaderboards

## 📁 Project Structure

```
vhx_bot/
├── main.py                 # Main bot entry point with all commands
├── config.py               # Configuration and environment variables
├── database.py             # Supabase database operations
├── moderation.py           # Moderation system (auto-mod, warns, logging)
├── economy.py              # Economy system (currency, gambling, shop)
├── app.py                  # Original bot (AI client, tools)
├── requirements.txt        # Python dependencies
└── .env                    # Environment variables (not in repo)
```

## ⚙️ Setup

### 1. Clone the Repository
```bash
git clone https://github.com/vhxLUA-max/mybots.git
cd mybots
```

### 2. Install Dependencies
```bash
pip install -r requirements.txt
```

### 3. Configure Environment Variables

Create a `.env` file with the following variables:

```env
# Discord
DISCORD_TOKEN=your_discord_bot_token
GUILD_ID=your_guild_id
ADMIN_DISCORD_ID=your_admin_user_id

# Channels (optional)
EXECUTION_COUNT_CHANNEL_ID=channel_id
BOT_COMMANDS_CHANNEL_ID=channel_id
CHAT_CHANNEL_ID=channel_id
LOG_DELETED_MESSAGES_CHANNEL_ID=channel_id
LOG_EDITED_MESSAGES_CHANNEL_ID=channel_id
LOG_MEMBER_CHANNEL_ID=channel_id
LOG_MODERATION_CHANNEL_ID=channel_id

# AI Providers
NVIDIA_API_KEY=your_nvidia_api_key
GROQ_API_KEY=your_groq_api_key

# External APIs
SERP_API_KEY=your_serp_api_key
WEATHER_API_KEY=your_weather_api_key

# Supabase
SUPABASE_URL=your_supabase_url
SUPABASE_ANON_KEY=your_supabase_anon_key

# Moderation Settings (optional)
AUTO_MOD_ENABLED=true
PROFANITY_FILTER_ENABLED=true
ANTI_SPAM_ENABLED=true
ANTI_RAID_ENABLED=true

# Warn Thresholds (optional)
WARN_MUTE_THRESHOLD=3
WARN_KICK_THRESHOLD=5
WARN_BAN_THRESHOLD=10

# Economy Settings (optional)
ECONOMY_ENABLED=true
DAILY_REWARD_AMOUNT=100
CURRENCY_NAME=coins
CURRENCY_SYMBOL=🪙

# Leveling Settings (optional)
LEVELING_ENABLED=true
XP_PER_MESSAGE=15
XP_PER_VOICE_MINUTE=10
```

### 4. Database Setup (Supabase)

Create the following tables in your Supabase database:

#### `warnings` table
```sql
CREATE TABLE warnings (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    moderator_id TEXT NOT NULL,
    timestamp TIMESTAMP DEFAULT NOW()
);
```

#### `mutes` table
```sql
CREATE TABLE mutes (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    moderator_id TEXT NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP DEFAULT NOW()
);
```

#### `economy` table
```sql
CREATE TABLE economy (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    balance INTEGER DEFAULT 0,
    last_daily TIMESTAMP,
    UNIQUE(user_id, guild_id)
);
```

#### `levels` table
```sql
CREATE TABLE levels (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    level INTEGER DEFAULT 1,
    xp INTEGER DEFAULT 0,
    total_xp INTEGER DEFAULT 0,
    UNIQUE(user_id, guild_id)
);
```

### 5. Run the Bot

```bash
python main.py
```

## 📝 Commands

### AI & Utility
- `/ask <question>` - Ask AI with web search, calculator, and weather tools
- `/review <code>` - Get AI code review
- `/quiz <topic> [questions]` - Generate a quiz
- `/search <query>` - Web search
- `/weather <location>` - Get weather
- `/calc <expression>` - Calculator

### Economy
- `/balance [user]` - Check balance
- `/daily` - Claim daily reward
- `/slots <bet>` - Play slot machine
- `/coinflip <bet> <heads|tails>` - Flip a coin
- `/shop` - View shop
- `/buy <item_id>` - Buy item from shop
- `/leaderboard` - Economy leaderboard

### Leveling
- `/rank [user]` - View rank card
- `/levels` - Level leaderboard

### Moderation
- `/warn <user> <reason>` - Warn a user
- `/warnings <user>` - View user warnings
- `/clearwarns <user>` - Clear all warnings
- `/mute <user> <duration> [reason]` - Mute a user
- `/unmute <user>` - Unmute a user
- `/kick <user> [reason]` - Kick a user
- `/ban <user> [reason]` - Ban a user
- `/unban <user_id>` - Unban a user

### Stats & Info
- `/stats` - Bot statistics
- `/userinfo [user]` - Detailed user info
- `/help` - Command list

## 🔒 Permissions

The bot requires the following permissions:
- **Administrator** (recommended) or:
  - Manage Roles
  - Manage Channels
  - Kick Members
  - Ban Members
  - Manage Messages
  - Read Messages
  - Send Messages
  - Embed Links
  - Attach Files
  - Read Message History
  - Add Reactions
  - Manage Webhooks

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License.

## 🔗 Links

- [GitHub Repository](https://github.com/vhxLUA-max/mybots)
- [Discord.py Documentation](https://discordpy.readthedocs.io/)
- [Supabase Documentation](https://supabase.com/docs)

## 📞 Support

For support, please open an issue on GitHub or contact the maintainer.

---

Made with ❤️ by VHX
