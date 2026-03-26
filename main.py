"""
VHX Bot - Enhanced Discord Bot
Main entry point with moderation, economy, leveling, AI, and more
"""
import os
import asyncio
import logging
from datetime import datetime, timedelta
from typing import Optional

import discord
from discord.ext import commands, tasks
from discord import app_commands

import config
from database import Database
from moderation import ModerationSystem
from economy import EconomySystem

# Import AI and tools from original app.py
import sys
sys.path.append('/home/claude/mybots')
from app import AIClient, Tools, CustomCommandsManager, time_ago, fmt_number

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ============================================================================
# Bot Setup
# ============================================================================
class VHXBot(commands.Bot):
    def __init__(self):
        intents = discord.Intents.default()
        intents.message_content = True
        intents.members = True
        intents.presences = True
        
        super().__init__(command_prefix="!", intents=intents)
        
        self.db = Database()
        self.moderation = None
        self.economy = None
        self.ai_client = None
        self.tools = None
        self.custom_commands = None

    async def setup_hook(self):
        """Initialize bot components"""
        await self.db.init()
        self.moderation = ModerationSystem(self, self.db)
        self.economy = EconomySystem(self.db)
        self.ai_client = AIClient()
        self.tools = Tools(self.ai_client)
        self.custom_commands = CustomCommandsManager()

        logger.info("✅ Bot components initialized")

        # Load feature cogs (ported from Logiq)
        cogs = [
            "cogs.giveaways",
            "cogs.music",
            "cogs.social_alerts",
            "cogs.temp_voice",
            "cogs.tickets",
            "cogs.roles",
            "cogs.analytics",
        ]
        for cog in cogs:
            try:
                await self.load_extension(cog)
                logger.info(f"✅ Loaded cog: {cog}")
            except Exception as e:
                logger.error(f"❌ Failed to load cog {cog}: {e}")
        
        try:
            if config.GUILD_ID:
                guild = discord.Object(id=config.GUILD_ID)
                self.tree.copy_global_to(guild=guild)
                synced = await self.tree.sync(guild=guild)
                logger.info(f"✅ Synced {len(synced)} commands to guild {config.GUILD_ID}")
            else:
                synced = await self.tree.sync()
                logger.info(f"✅ Synced {len(synced)} commands globally")
        except Exception as e:
            logger.error(f"❌ Failed to sync commands: {e}")
        
        logger.info("✅ Bot setup complete")

    async def on_ready(self):
        logger.info(f"🤖 {self.user} is online!")
        logger.info(f"📊 Guilds: {len(self.guilds)}")
        logger.info(f"👥 Users: {sum(g.member_count for g in self.guilds)}")
        
        if not self.check_expired_mutes.is_running():
            self.check_expired_mutes.start()
            logger.info("✅ Started check_expired_mutes task")
        
        if not self.update_execution_count.is_running():
            self.update_execution_count.start()
            logger.info("✅ Started update_execution_count task")

    # ========================================================================
    # Event Handlers
    # ========================================================================
    async def on_message(self, message: discord.Message):
        if message.author.bot:
            return
        
        # Auto-moderation check
        if self.moderation:
            result = await self.moderation.check_message(message)
            if result["action"] != "none":
                await self.moderation.handle_violation(message, result["action"], result["reason"])
                return
        
        # Leveling (if enabled)
        if config.LEVELING_ENABLED and message.guild:
            level_result = await self.db.add_xp(message.author.id, message.guild.id, config.XP_PER_MESSAGE)
            if level_result and level_result["leveled_up"]:
                await message.channel.send(
                    f"🎉 {message.author.mention} leveled up to **Level {level_result['new_level']}**!",
                    delete_after=10
                )
        
        # AI chat in designated channel
        if config.CHAT_CHANNEL_ID and message.channel.id == config.CHAT_CHANNEL_ID:
            if not message.content.startswith("/"):
                async with message.channel.typing():
                    response = await self.ai_client.chat(message.content, self.tools)
                    if response:
                        chunks = [response[i:i+2000] for i in range(0, len(response), 2000)]
                        for chunk in chunks:
                            await message.reply(chunk)
        
        await self.process_commands(message)

    async def on_message_delete(self, message: discord.Message):
        if self.moderation and not message.author.bot:
            await self.moderation.log_deleted_message(message)

    async def on_message_edit(self, before: discord.Message, after: discord.Message):
        if self.moderation and not before.author.bot:
            await self.moderation.log_edited_message(before, after)

    async def on_member_join(self, member: discord.Member):
        if self.moderation:
            await self.moderation.log_member_join(member)
            is_raid = await self.moderation.check_anti_raid(member)
            if is_raid:
                # Auto-enable slowmode or lockdown
                logger.warning(f"⚠️ Anti-raid triggered in {member.guild.name}")

    async def on_member_remove(self, member: discord.Member):
        if self.moderation:
            await self.moderation.log_member_leave(member)
    
    async def on_command_error(self, ctx: commands.Context, error: commands.CommandError):
        """Handle command errors"""
        logger.error(f"Command error: {error}", exc_info=error)
        if isinstance(error, commands.CommandNotFound):
            return
        await ctx.send(f"❌ An error occurred: {str(error)}", ephemeral=True)
    
    async def on_app_command_error(self, interaction: discord.Interaction, error: app_commands.AppCommandError):
        """Handle slash command errors"""
        logger.error(f"App command error: {error}", exc_info=error)
        
        if interaction.response.is_done():
            await interaction.followup.send(f"❌ An error occurred: {str(error)}", ephemeral=True)
        else:
            await interaction.response.send_message(f"❌ An error occurred: {str(error)}", ephemeral=True)

    # ========================================================================
    # Background Tasks
    # ========================================================================
    @tasks.loop(minutes=1)
    async def check_expired_mutes(self):
        """Check and remove expired mutes"""
        try:
            for guild in self.guilds:
                mutes = await self.db.get_active_mutes(guild.id)
                for mute in mutes:
                    expires_at = datetime.fromisoformat(mute["expires_at"])
                    if datetime.utcnow() >= expires_at:
                        user = guild.get_member(int(mute["user_id"]))
                        if user:
                            await self.moderation.unmute_user(user, guild)
        except Exception as e:
            logger.error(f"Error in check_expired_mutes: {e}")
    
    @check_expired_mutes.before_loop
    async def before_check_expired_mutes(self):
        await self.wait_until_ready()

    @tasks.loop(minutes=5)
    async def update_execution_count(self):
        """Update execution count in designated channel"""
        if not config.EXECUTION_COUNT_CHANNEL_ID:
            return
        
        try:
            channel = self.get_channel(config.EXECUTION_COUNT_CHANNEL_ID)
            if not channel:
                return
            
            total = await self.db.get_total_executions()
            
            await channel.edit(name=f"📊┃{fmt_number(total)}-execs")
        except Exception as e:
            logger.error(f"Failed to update execution count: {e}")
    
    @update_execution_count.before_loop
    async def before_update_execution_count(self):
        await self.wait_until_ready()

bot = VHXBot()

# ============================================================================
# Commands - AI & Utility
# ============================================================================
@bot.tree.command(name="ask", description="Ask AI a question (with web search, calculator, weather)")
@app_commands.describe(question="Your question")
async def ask(interaction: discord.Interaction, question: str):
    await interaction.response.defer()
    response = await bot.ai_client.chat(question, bot.tools)
    if response:
        chunks = [response[i:i+2000] for i in range(0, len(response), 2000)]
        await interaction.followup.send(chunks[0])
        for chunk in chunks[1:]:
            await interaction.followup.send(chunk)
    else:
        await interaction.followup.send("❌ Failed to get response.")

@bot.tree.command(name="review", description="AI code review")
@app_commands.describe(code="Code to review")
async def review(interaction: discord.Interaction, code: str):
    await interaction.response.defer()
    response = await bot.ai_client.review_code(code)
    chunks = [response[i:i+2000] for i in range(0, len(response), 2000)]
    await interaction.followup.send(chunks[0])
    for chunk in chunks[1:]:
        await interaction.followup.send(chunk)

@bot.tree.command(name="quiz", description="Generate a quiz on any topic")
@app_commands.describe(topic="Quiz topic", questions="Number of questions (1-10)")
async def quiz(interaction: discord.Interaction, topic: str, questions: int = 5):
    await interaction.response.defer()
    if questions < 1 or questions > 10:
        await interaction.followup.send("❌ Questions must be between 1 and 10.")
        return
    response = await bot.ai_client.generate_quiz(topic, questions)
    chunks = [response[i:i+2000] for i in range(0, len(response), 2000)]
    await interaction.followup.send(chunks[0])
    for chunk in chunks[1:]:
        await interaction.followup.send(chunk)

# ============================================================================
# Commands - Economy
# ============================================================================
@bot.tree.command(name="balance", description="Check your balance")
async def balance(interaction: discord.Interaction, user: Optional[discord.Member] = None):
    target = user or interaction.user
    bal = await bot.economy.get_balance(target.id, interaction.guild.id)
    
    embed = discord.Embed(
        title=f"{config.CURRENCY_SYMBOL} Balance",
        description=f"{target.mention} has **{bal:,}** {config.CURRENCY_NAME}",
        color=config.SUCCESS_COLOR
    )
    await interaction.response.send_message(embed=embed)

@bot.tree.command(name="daily", description="Claim your daily reward")
async def daily(interaction: discord.Interaction):
    amount = await bot.economy.claim_daily(interaction.user.id, interaction.guild.id)
    
    if amount:
        embed = discord.Embed(
            title="✅ Daily Reward Claimed!",
            description=f"You received **{amount:,}** {config.CURRENCY_NAME}",
            color=config.SUCCESS_COLOR
        )
        await interaction.response.send_message(embed=embed)
    else:
        embed = discord.Embed(
            title="❌ Already Claimed",
            description="You've already claimed your daily reward. Come back tomorrow!",
            color=config.ERROR_COLOR
        )
        await interaction.response.send_message(embed=embed, ephemeral=True)

@bot.tree.command(name="slots", description="Play slot machine")
@app_commands.describe(bet="Amount to bet")
async def slots(interaction: discord.Interaction, bet: int):
    if bet < 10:
        await interaction.response.send_message("❌ Minimum bet is 10", ephemeral=True)
        return
    
    result = await bot.economy.play_slots(interaction.user.id, interaction.guild.id, bet)
    
    if not result["success"]:
        await interaction.response.send_message(f"❌ {result['message']}", ephemeral=True)
        return
    
    embed = discord.Embed(title="🎰 Slot Machine", color=config.EMBED_COLOR)
    embed.add_field(name="Result", value=" ".join(result["result"]), inline=False)
    embed.add_field(name="Bet", value=f"{config.CURRENCY_SYMBOL}{bet:,}", inline=True)
    embed.add_field(name="Winnings", value=f"{config.CURRENCY_SYMBOL}{result['winnings']:,}", inline=True)
    
    if result["profit"] > 0:
        embed.add_field(name="Profit", value=f"+{config.CURRENCY_SYMBOL}{result['profit']:,} 🎉", inline=True)
        embed.color = config.SUCCESS_COLOR
    else:
        embed.add_field(name="Loss", value=f"{config.CURRENCY_SYMBOL}{result['profit']:,}", inline=True)
        embed.color = config.ERROR_COLOR
    
    await interaction.response.send_message(embed=embed)

@bot.tree.command(name="coinflip", description="Flip a coin")
@app_commands.describe(bet="Amount to bet", choice="heads or tails")
async def coinflip(interaction: discord.Interaction, bet: int, choice: str):
    if bet < 10:
        await interaction.response.send_message("❌ Minimum bet is 10", ephemeral=True)
        return
    
    result = await bot.economy.play_coinflip(interaction.user.id, interaction.guild.id, bet, choice)
    
    if not result["success"]:
        await interaction.response.send_message(f"❌ {result['message']}", ephemeral=True)
        return
    
    embed = discord.Embed(title="🪙 Coinflip", color=config.EMBED_COLOR)
    embed.add_field(name="Result", value=result["result"].upper(), inline=False)
    embed.add_field(name="Your Choice", value=choice.upper(), inline=True)
    embed.add_field(name="Bet", value=f"{config.CURRENCY_SYMBOL}{bet:,}", inline=True)
    
    if result["won"]:
        embed.add_field(name="You Won!", value=f"+{config.CURRENCY_SYMBOL}{result['profit']:,} 🎉", inline=False)
        embed.color = config.SUCCESS_COLOR
    else:
        embed.add_field(name="You Lost", value=f"{config.CURRENCY_SYMBOL}{result['profit']:,}", inline=False)
        embed.color = config.ERROR_COLOR
    
    await interaction.response.send_message(embed=embed)

@bot.tree.command(name="shop", description="View the shop")
async def shop(interaction: discord.Interaction):
    embed = bot.economy.get_shop_embed()
    await interaction.response.send_message(embed=embed)

@bot.tree.command(name="buy", description="Buy an item from the shop")
@app_commands.describe(item_id="Item ID from /shop")
async def buy(interaction: discord.Interaction, item_id: str):
    result = await bot.economy.buy_item(interaction.user.id, interaction.guild.id, item_id)
    
    if result["success"]:
        embed = discord.Embed(
            title="✅ Purchase Successful",
            description=f"You bought **{result['item']['name']}** for {config.CURRENCY_SYMBOL}{result['item']['price']:,}",
            color=config.SUCCESS_COLOR
        )
        await interaction.response.send_message(embed=embed)
    else:
        await interaction.response.send_message(f"❌ {result['message']}", ephemeral=True)

@bot.tree.command(name="leaderboard", description="View economy leaderboard")
async def leaderboard(interaction: discord.Interaction):
    await interaction.response.defer()
    leaders = await bot.economy.get_leaderboard(interaction.guild.id, 10)
    
    if not leaders:
        await interaction.followup.send("❌ No data available")
        return
    
    embed = discord.Embed(
        title=f"🏆 {config.CURRENCY_NAME.title()} Leaderboard",
        color=config.WARNING_COLOR
    )
    
    description = []
    for i, entry in enumerate(leaders, 1):
        user = interaction.guild.get_member(int(entry["user_id"]))
        username = user.display_name if user else "Unknown User"
        description.append(f"**{i}.** {username} — {config.CURRENCY_SYMBOL}{entry['balance']:,}")
    
    embed.description = "\n".join(description)
    await interaction.followup.send(embed=embed)

# ============================================================================
# Commands - Leveling
# ============================================================================
@bot.tree.command(name="rank", description="Check your rank")
async def rank(interaction: discord.Interaction, user: Optional[discord.Member] = None):
    await interaction.response.defer()
    target = user or interaction.user
    data = await bot.db.get_level_data(target.id, interaction.guild.id)
    
    # Calculate XP needed for next level
    xp_needed = int(100 * (1.1 ** (data["level"] - 1)))
    
    embed = discord.Embed(
        title=f"📊 Rank - {target.display_name}",
        color=config.INFO_COLOR
    )
    embed.add_field(name="Level", value=str(data["level"]), inline=True)
    embed.add_field(name="XP", value=f"{data['xp']}/{xp_needed}", inline=True)
    embed.add_field(name="Total XP", value=str(data["total_xp"]), inline=True)
    embed.set_thumbnail(url=target.display_avatar.url)
    
    await interaction.followup.send(embed=embed)

@bot.tree.command(name="levels", description="View level leaderboard")
async def levels(interaction: discord.Interaction):
    await interaction.response.defer()
    leaders = await bot.db.get_level_leaderboard(interaction.guild.id, 10)
    
    if not leaders:
        await interaction.followup.send("❌ No data available")
        return
    
    embed = discord.Embed(
        title="🏆 Level Leaderboard",
        color=config.WARNING_COLOR
    )
    
    description = []
    for i, entry in enumerate(leaders, 1):
        user = interaction.guild.get_member(int(entry["user_id"]))
        username = user.display_name if user else "Unknown User"
        description.append(f"**{i}.** {username} — Level {entry['level']} ({entry['total_xp']} XP)")
    
    embed.description = "\n".join(description)
    await interaction.followup.send(embed=embed)

# ============================================================================
# Commands - Moderation
# ============================================================================
@bot.tree.command(name="warn", description="[Mod] Warn a user")
@app_commands.describe(user="User to warn", reason="Reason for warning")
@app_commands.checks.has_permissions(moderate_members=True)
async def warn(interaction: discord.Interaction, user: discord.Member, reason: str):
    await bot.moderation.warn_user(user, interaction.guild, reason, interaction.user)
    warnings = await bot.db.get_warnings(user.id, interaction.guild.id)
    
    embed = discord.Embed(
        title="⚠️ User Warned",
        color=config.WARNING_COLOR
    )
    embed.add_field(name="User", value=user.mention, inline=False)
    embed.add_field(name="Reason", value=reason, inline=False)
    embed.add_field(name="Total Warnings", value=str(len(warnings)), inline=True)
    
    await interaction.response.send_message(embed=embed)

@bot.tree.command(name="warnings", description="View warnings for a user")
@app_commands.describe(user="User to check")
async def warnings(interaction: discord.Interaction, user: discord.Member):
    await interaction.response.defer()
    warns = await bot.db.get_warnings(user.id, interaction.guild.id)
    
    if not warns:
        await interaction.followup.send(f"{user.mention} has no warnings.")
        return
    
    embed = discord.Embed(
        title=f"⚠️ Warnings - {user.display_name}",
        color=config.WARNING_COLOR
    )
    
    for i, w in enumerate(warns[-5:], 1):  # Show last 5
        mod = interaction.guild.get_member(int(w["moderator_id"]))
        mod_name = mod.display_name if mod else "Unknown"
        embed.add_field(
            name=f"Warning #{i}",
            value=f"**Reason:** {w['reason']}\n**By:** {mod_name}",
            inline=False
        )
    
    embed.set_footer(text=f"Total: {len(warns)} warnings")
    await interaction.followup.send(embed=embed)

@bot.tree.command(name="clearwarns", description="[Mod] Clear all warnings for a user")
@app_commands.describe(user="User to clear warnings for")
@app_commands.checks.has_permissions(moderate_members=True)
async def clearwarns(interaction: discord.Interaction, user: discord.Member):
    success = await bot.db.clear_warnings(user.id, interaction.guild.id)
    
    if success:
        await interaction.response.send_message(f"✅ Cleared all warnings for {user.mention}")
    else:
        await interaction.response.send_message("❌ Failed to clear warnings", ephemeral=True)

@bot.tree.command(name="mute", description="[Mod] Mute a user")
@app_commands.describe(user="User to mute", duration="Duration in minutes", reason="Reason")
@app_commands.checks.has_permissions(moderate_members=True)
async def mute(interaction: discord.Interaction, user: discord.Member, duration: int, reason: str = "No reason provided"):
    await interaction.response.defer()
    await bot.moderation.mute_user(user, interaction.guild, duration * 60, reason, interaction.user)
    
    embed = discord.Embed(
        title="🔇 User Muted",
        color=config.ERROR_COLOR
    )
    embed.add_field(name="User", value=user.mention, inline=False)
    embed.add_field(name="Duration", value=f"{duration} minutes", inline=True)
    embed.add_field(name="Reason", value=reason, inline=False)
    
    await interaction.followup.send(embed=embed)

@bot.tree.command(name="unmute", description="[Mod] Unmute a user")
@app_commands.describe(user="User to unmute")
@app_commands.checks.has_permissions(moderate_members=True)
async def unmute(interaction: discord.Interaction, user: discord.Member):
    await interaction.response.defer()
    await bot.moderation.unmute_user(user, interaction.guild, interaction.user)
    await interaction.followup.send(f"✅ Unmuted {user.mention}")

@bot.tree.command(name="kick", description="[Mod] Kick a user")
@app_commands.describe(user="User to kick", reason="Reason")
@app_commands.checks.has_permissions(kick_members=True)
async def kick(interaction: discord.Interaction, user: discord.Member, reason: str = "No reason provided"):
    await interaction.guild.kick(user, reason=reason)
    await bot.moderation.log_moderation_action("kick", user, interaction.user, reason)
    
    embed = discord.Embed(
        title="👢 User Kicked",
        color=config.ERROR_COLOR
    )
    embed.add_field(name="User", value=f"{user} ({user.id})", inline=False)
    embed.add_field(name="Reason", value=reason, inline=False)
    
    await interaction.response.send_message(embed=embed)

@bot.tree.command(name="ban", description="[Mod] Ban a user")
@app_commands.describe(user="User to ban", reason="Reason")
@app_commands.checks.has_permissions(ban_members=True)
async def ban_cmd(interaction: discord.Interaction, user: discord.User, reason: str = "No reason provided"):
    await interaction.guild.ban(user, reason=reason)
    await bot.moderation.log_moderation_action("ban", user, interaction.user, reason)
    
    embed = discord.Embed(
        title="🔨 User Banned",
        color=config.ERROR_COLOR
    )
    embed.add_field(name="User", value=f"{user} ({user.id})", inline=False)
    embed.add_field(name="Reason", value=reason, inline=False)
    
    await interaction.response.send_message(embed=embed)

@bot.tree.command(name="unban", description="[Mod] Unban a user")
@app_commands.describe(user_id="User ID to unban")
@app_commands.checks.has_permissions(ban_members=True)
async def unban_cmd(interaction: discord.Interaction, user_id: str):
    try:
        user = await bot.fetch_user(int(user_id))
        await interaction.guild.unban(user)
        await interaction.response.send_message(f"✅ Unbanned {user} ({user_id})")
    except Exception as e:
        await interaction.response.send_message(f"❌ Failed to unban: {e}", ephemeral=True)

# ============================================================================
# Commands - Stats & Info
# ============================================================================
@bot.tree.command(name="stats", description="View bot statistics")
async def stats(interaction: discord.Interaction):
    await interaction.response.defer()
    total_exec = await bot.db.get_total_executions()
    top_games = await bot.db.get_top_games(5)
    
    embed = discord.Embed(title="📊 VHX Bot Statistics", color=config.EMBED_COLOR)
    embed.add_field(name="Total Executions", value=fmt_number(total_exec), inline=True)
    embed.add_field(name="Guilds", value=str(len(bot.guilds)), inline=True)
    embed.add_field(name="Users", value=fmt_number(sum(g.member_count for g in bot.guilds)), inline=True)
    
    if top_games:
        top_list = "\n".join(f"**{i+1}.** {g['game_name']} — {fmt_number(g['count'])}" for i, g in enumerate(top_games))
        embed.add_field(name="Top Games", value=top_list[:1024], inline=False)
    
    await interaction.followup.send(embed=embed)

@bot.tree.command(name="userinfo", description="View detailed user information")
@app_commands.describe(user="User to check")
async def userinfo(interaction: discord.Interaction, user: Optional[discord.Member] = None):
    await interaction.response.defer()
    target = user or interaction.user
    
    # Get warnings, level, balance
    warnings = await bot.db.get_warnings(target.id, interaction.guild.id)
    level_data = await bot.db.get_level_data(target.id, interaction.guild.id)
    balance = await bot.economy.get_balance(target.id, interaction.guild.id)
    
    embed = discord.Embed(
        title=f"User Info - {target.display_name}",
        color=config.EMBED_COLOR
    )
    embed.set_thumbnail(url=target.display_avatar.url)
    embed.add_field(name="ID", value=str(target.id), inline=True)
    embed.add_field(name="Joined", value=f"<t:{int(target.joined_at.timestamp())}:R>" if target.joined_at else "Unknown", inline=True)
    embed.add_field(name="Created", value=f"<t:{int(target.created_at.timestamp())}:R>", inline=True)
    embed.add_field(name="Level", value=str(level_data["level"]), inline=True)
    embed.add_field(name="Balance", value=f"{config.CURRENCY_SYMBOL}{balance:,}", inline=True)
    embed.add_field(name="Warnings", value=str(len(warnings)), inline=True)
    
    await interaction.followup.send(embed=embed)

@bot.tree.command(name="help", description="View all available commands")
async def help_cmd(interaction: discord.Interaction):
    embed = discord.Embed(
        title="VHX Bot - Command List",
        description="Complete list of available commands",
        color=config.EMBED_COLOR
    )
    
    embed.add_field(
        name="🤖 AI & Utility",
        value="`/ask` `/review` `/quiz` `/search` `/weather` `/calc`",
        inline=False
    )
    
    embed.add_field(
        name="💰 Economy",
        value="`/balance` `/daily` `/slots` `/coinflip` `/shop` `/buy` `/leaderboard`",
        inline=False
    )
    
    embed.add_field(
        name="📊 Leveling",
        value="`/rank` `/levels`",
        inline=False
    )
    
    embed.add_field(
        name="⚖️ Moderation",
        value="`/warn` `/warnings` `/clearwarns` `/mute` `/unmute` `/kick` `/ban` `/unban`",
        inline=False
    )
    
    embed.add_field(
        name="📈 Stats & Info",
        value="`/stats` `/userinfo` `/help`",
        inline=False
    )
    
    await interaction.response.send_message(embed=embed)

# ============================================================================
# Run Bot
# ============================================================================
async def main():
    async with bot:
        await bot.start(config.DISCORD_TOKEN)

if __name__ == "__main__":
    asyncio.run(main())
