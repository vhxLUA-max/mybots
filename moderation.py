"""
Moderation system for VHX Bot
Includes auto-moderation, anti-spam, warn system, and logging
"""
import discord
import logging
import re
from datetime import datetime, timedelta
from collections import defaultdict
from typing import Optional, Dict, List
import config

logger = logging.getLogger(__name__)

class ModerationSystem:
    def __init__(self, bot, db):
        self.bot = bot
        self.db = db
        self.message_history = defaultdict(list)  # user_id -> [(timestamp, content)]
        self.join_history = []  # [(timestamp, user_id)]
        
        # Profanity filter (basic list - can be expanded)
        self.profanity_patterns = [
            r'\b(fuck|shit|bitch|ass|damn|crap|bastard|whore|slut)\b',
            r'\b(nigga|nigger|faggot|retard)\b',
        ]
        
        # Link regex
        self.link_pattern = re.compile(r'http[s]?://(?:[a-zA-Z]|[0-9]|[$-_@.&+]|[!*\\(\\),]|(?:%[0-9a-fA-F][0-9a-fA-F]))+')

    async def check_message(self, message: discord.Message) -> Dict[str, any]:
        """
        Check a message for violations
        Returns: {"action": "none/warn/delete/mute/kick", "reason": str}
        """
        if not config.AUTO_MOD_ENABLED:
            return {"action": "none", "reason": None}
        
        if message.author.bot:
            return {"action": "none", "reason": None}
        
        content = message.content.lower()
        violations = []
        
        # Check profanity
        if config.PROFANITY_FILTER_ENABLED:
            for pattern in self.profanity_patterns:
                if re.search(pattern, content, re.IGNORECASE):
                    violations.append("profanity")
                    break
        
        # Check for spam (same message repeated)
        if config.ANTI_SPAM_ENABLED:
            user_id = message.author.id
            current_time = datetime.utcnow()
            
            # Clean old messages
            self.message_history[user_id] = [
                (t, c) for t, c in self.message_history[user_id]
                if current_time - t < timedelta(seconds=config.SPAM_TIME_WINDOW)
            ]
            
            # Add current message
            self.message_history[user_id].append((current_time, content))
            
            # Check if spam
            recent_messages = self.message_history[user_id]
            if len(recent_messages) >= config.SPAM_MESSAGE_THRESHOLD:
                violations.append("spam")
        
        # Check for excessive links
        links = self.link_pattern.findall(message.content)
        if len(links) > 3:
            violations.append("link_spam")
        
        # Check for mass mentions
        if len(message.mentions) > 5:
            violations.append("mass_ping")
        
        # Determine action based on violations
        if not violations:
            return {"action": "none", "reason": None}
        
        # Severity escalation
        if "spam" in violations or "link_spam" in violations or "mass_ping" in violations:
            return {"action": "delete_and_warn", "reason": f"Automated moderation: {', '.join(violations)}"}
        elif "profanity" in violations:
            return {"action": "delete", "reason": "Profanity detected"}
        
        return {"action": "warn", "reason": f"Automated moderation: {', '.join(violations)}"}

    async def handle_violation(self, message: discord.Message, action: str, reason: str):
        """Handle a moderation violation"""
        try:
            if action == "delete" or action == "delete_and_warn":
                await message.delete()
                await self.log_deleted_message(message, reason)
            
            if action == "delete_and_warn" or action == "warn":
                await self.warn_user(message.author, message.guild, reason, self.bot.user)
                
                # Send warning to user
                try:
                    await message.author.send(f"⚠️ **Warning in {message.guild.name}**\nReason: {reason}")
                except discord.Forbidden:
                    pass
            
            if action == "mute":
                await self.mute_user(message.author, message.guild, 3600, reason, self.bot.user)
            
            if action == "kick":
                await message.guild.kick(message.author, reason=reason)
                await self.log_moderation_action("kick", message.author, self.bot.user, reason)
        
        except Exception as e:
            logger.error(f"Failed to handle violation: {e}")

    async def warn_user(self, user: discord.Member, guild: discord.Guild, reason: str, moderator: discord.User):
        """Add a warning to a user and check for escalation"""
        await self.db.add_warning(user.id, guild.id, reason, moderator.id)
        warnings = await self.db.get_warnings(user.id, guild.id)
        warn_count = len(warnings)
        
        await self.log_moderation_action("warn", user, moderator, f"{reason} (Total: {warn_count})")
        
        # Auto-escalation
        if warn_count >= config.WARN_BAN_THRESHOLD:
            await guild.ban(user, reason=f"Auto-ban: {warn_count} warnings")
            await self.log_moderation_action("auto_ban", user, self.bot.user, f"{warn_count} warnings reached")
        elif warn_count >= config.WARN_KICK_THRESHOLD:
            await guild.kick(user, reason=f"Auto-kick: {warn_count} warnings")
            await self.log_moderation_action("auto_kick", user, self.bot.user, f"{warn_count} warnings reached")
        elif warn_count >= config.WARN_MUTE_THRESHOLD:
            await self.mute_user(user, guild, 3600, f"Auto-mute: {warn_count} warnings", self.bot.user)

    async def mute_user(self, user: discord.Member, guild: discord.Guild, duration: int, reason: str, moderator: discord.User):
        """Mute a user for a duration (in seconds)"""
        try:
            # Get or create muted role
            muted_role = discord.utils.get(guild.roles, name="Muted")
            if not muted_role:
                muted_role = await guild.create_role(name="Muted", reason="Auto-created mute role")
                # Set permissions for muted role in all channels
                for channel in guild.channels:
                    await channel.set_permissions(muted_role, send_messages=False, speak=False)
            
            await user.add_roles(muted_role, reason=reason)
            await self.db.add_mute(user.id, guild.id, duration, reason, moderator.id)
            await self.log_moderation_action("mute", user, moderator, f"{reason} (Duration: {duration}s)")
            
            # Try to DM user
            try:
                await user.send(f"🔇 **Muted in {guild.name}**\nReason: {reason}\nDuration: {duration // 60} minutes")
            except discord.Forbidden:
                pass
        
        except Exception as e:
            logger.error(f"Failed to mute user: {e}")

    async def unmute_user(self, user: discord.Member, guild: discord.Guild, moderator: discord.User = None):
        """Unmute a user"""
        try:
            muted_role = discord.utils.get(guild.roles, name="Muted")
            if muted_role and muted_role in user.roles:
                await user.remove_roles(muted_role, reason="Unmuted")
                await self.db.remove_mute(user.id, guild.id)
                if moderator:
                    await self.log_moderation_action("unmute", user, moderator, "Manual unmute")
        except Exception as e:
            logger.error(f"Failed to unmute user: {e}")

    async def check_anti_raid(self, member: discord.Member):
        """Check for raid patterns (mass joins)"""
        if not config.ANTI_RAID_ENABLED:
            return False
        
        current_time = datetime.utcnow()
        
        # Clean old joins
        self.join_history = [
            (t, u) for t, u in self.join_history
            if current_time - t < timedelta(seconds=10)
        ]
        
        # Add current join
        self.join_history.append((current_time, member.id))
        
        # Check for raid (more than 5 joins in 10 seconds)
        if len(self.join_history) > 5:
            logger.warning(f"⚠️ Potential raid detected: {len(self.join_history)} joins in 10 seconds")
            return True
        
        return False

    # ============================================================================
    # Logging Functions
    # ============================================================================
    async def log_deleted_message(self, message: discord.Message, reason: str = None):
        """Log deleted messages"""
        if not config.LOG_DELETED_MESSAGES_CHANNEL_ID:
            return
        
        try:
            channel = self.bot.get_channel(config.LOG_DELETED_MESSAGES_CHANNEL_ID)
            if not channel:
                return
            
            embed = discord.Embed(
                title="🗑️ Message Deleted",
                color=config.ERROR_COLOR,
                timestamp=datetime.utcnow()
            )
            embed.add_field(name="Author", value=f"{message.author.mention} ({message.author})", inline=False)
            embed.add_field(name="Channel", value=message.channel.mention, inline=True)
            embed.add_field(name="Content", value=message.content[:1024] if message.content else "*No content*", inline=False)
            if reason:
                embed.add_field(name="Reason", value=reason, inline=False)
            
            await channel.send(embed=embed)
        except Exception as e:
            logger.error(f"Failed to log deleted message: {e}")

    async def log_edited_message(self, before: discord.Message, after: discord.Message):
        """Log edited messages"""
        if not config.LOG_EDITED_MESSAGES_CHANNEL_ID:
            return
        
        if before.content == after.content:
            return
        
        try:
            channel = self.bot.get_channel(config.LOG_EDITED_MESSAGES_CHANNEL_ID)
            if not channel:
                return
            
            embed = discord.Embed(
                title="✏️ Message Edited",
                color=config.WARNING_COLOR,
                timestamp=datetime.utcnow()
            )
            embed.add_field(name="Author", value=f"{after.author.mention} ({after.author})", inline=False)
            embed.add_field(name="Channel", value=after.channel.mention, inline=True)
            embed.add_field(name="Before", value=before.content[:1024] if before.content else "*No content*", inline=False)
            embed.add_field(name="After", value=after.content[:1024] if after.content else "*No content*", inline=False)
            
            await channel.send(embed=embed)
        except Exception as e:
            logger.error(f"Failed to log edited message: {e}")

    async def log_member_join(self, member: discord.Member):
        """Log member joins"""
        if not config.LOG_MEMBER_CHANNEL_ID:
            return
        
        try:
            channel = self.bot.get_channel(config.LOG_MEMBER_CHANNEL_ID)
            if not channel:
                return
            
            embed = discord.Embed(
                title="📥 Member Joined",
                color=config.SUCCESS_COLOR,
                timestamp=datetime.utcnow()
            )
            embed.add_field(name="User", value=f"{member.mention} ({member})", inline=False)
            embed.add_field(name="Account Created", value=f"<t:{int(member.created_at.timestamp())}:R>", inline=True)
            embed.add_field(name="Member Count", value=str(member.guild.member_count), inline=True)
            embed.set_thumbnail(url=member.display_avatar.url)
            
            await channel.send(embed=embed)
        except Exception as e:
            logger.error(f"Failed to log member join: {e}")

    async def log_member_leave(self, member: discord.Member):
        """Log member leaves"""
        if not config.LOG_MEMBER_CHANNEL_ID:
            return
        
        try:
            channel = self.bot.get_channel(config.LOG_MEMBER_CHANNEL_ID)
            if not channel:
                return
            
            embed = discord.Embed(
                title="📤 Member Left",
                color=config.ERROR_COLOR,
                timestamp=datetime.utcnow()
            )
            embed.add_field(name="User", value=f"{member.mention} ({member})", inline=False)
            embed.add_field(name="Joined", value=f"<t:{int(member.joined_at.timestamp())}:R>" if member.joined_at else "Unknown", inline=True)
            embed.add_field(name="Member Count", value=str(member.guild.member_count), inline=True)
            embed.set_thumbnail(url=member.display_avatar.url)
            
            await channel.send(embed=embed)
        except Exception as e:
            logger.error(f"Failed to log member leave: {e}")

    async def log_moderation_action(self, action: str, target: discord.User, moderator: discord.User, reason: str):
        """Log moderation actions"""
        if not config.LOG_MODERATION_CHANNEL_ID:
            return
        
        try:
            channel = self.bot.get_channel(config.LOG_MODERATION_CHANNEL_ID)
            if not channel:
                return
            
            action_colors = {
                "warn": config.WARNING_COLOR,
                "mute": config.ERROR_COLOR,
                "unmute": config.SUCCESS_COLOR,
                "kick": config.ERROR_COLOR,
                "ban": config.ERROR_COLOR,
                "auto_mute": config.ERROR_COLOR,
                "auto_kick": config.ERROR_COLOR,
                "auto_ban": config.ERROR_COLOR
            }
            
            embed = discord.Embed(
                title=f"⚖️ {action.upper().replace('_', ' ')}",
                color=action_colors.get(action, config.EMBED_COLOR),
                timestamp=datetime.utcnow()
            )
            embed.add_field(name="Target", value=f"{target.mention} ({target})", inline=False)
            embed.add_field(name="Moderator", value=f"{moderator.mention} ({moderator})", inline=False)
            embed.add_field(name="Reason", value=reason, inline=False)
            
            await channel.send(embed=embed)
        except Exception as e:
            logger.error(f"Failed to log moderation action: {e}")
