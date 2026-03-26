"""
Temp Voice Cog - ported from Logiq into mybots
Auto-creates temporary voice channels when users join a creator channel
"""

import discord
from discord import app_commands
from discord.ext import commands
from typing import Optional
import logging

logger = logging.getLogger(__name__)

SUCCESS_COLOR = 0x57F287
ERROR_COLOR   = 0xED4245


class TempVoice(commands.Cog):
    """Temporary voice channels cog"""

    def __init__(self, bot: commands.Bot):
        self.bot = bot
        # guild_id -> creator_channel_id
        self.creator_channels: dict[int, int] = {}
        # Set of temp channel IDs
        self.temp_channels: set[int] = set()

    @commands.Cog.listener()
    async def on_voice_state_update(self, member: discord.Member,
                                    before: discord.VoiceState, after: discord.VoiceState):
        # User joined creator channel → create temp channel
        creator_id = self.creator_channels.get(member.guild.id)
        if creator_id and after.channel and after.channel.id == creator_id:
            await self._create_temp_channel(member, after.channel)

        # Temp channel became empty → delete it
        if before.channel and before.channel.id in self.temp_channels:
            if len(before.channel.members) == 0:
                try:
                    await before.channel.delete(reason="Temporary channel empty")
                    self.temp_channels.discard(before.channel.id)
                    logger.info(f"Deleted empty temp channel: {before.channel.name}")
                except discord.Forbidden:
                    pass
                except Exception as e:
                    logger.error(f"Error deleting temp channel: {e}")

    async def _create_temp_channel(self, member: discord.Member, creator: discord.VoiceChannel):
        try:
            overwrites = {
                member.guild.default_role: discord.PermissionOverwrite(connect=True),
                member: discord.PermissionOverwrite(
                    connect=True, manage_channels=True,
                    move_members=True, mute_members=True, deafen_members=True
                )
            }
            temp = await creator.category.create_voice_channel(
                name=f"{member.display_name}'s Channel",
                overwrites=overwrites,
                reason=f"Temp channel for {member}"
            )
            self.temp_channels.add(temp.id)
            await member.move_to(temp)
            logger.info(f"Created temp channel for {member}: {temp.name}")
        except discord.Forbidden:
            logger.warning(f"Cannot create temp channel for {member}")
        except Exception as e:
            logger.error(f"Error creating temp channel: {e}")

    @app_commands.command(name="setup-tempvoice", description="Setup temporary voice channels (Admin)")
    @app_commands.describe(category="Category for temp channels",
                           creator_name="Name for creator channel")
    @app_commands.checks.has_permissions(administrator=True)
    async def setup_tempvoice(self, interaction: discord.Interaction,
                               category: discord.CategoryChannel,
                               creator_name: str = "➕ Create Channel"):
        try:
            creator = await category.create_voice_channel(
                name=creator_name, reason="Temp voice creator channel")
            self.creator_channels[interaction.guild.id] = creator.id

            embed = discord.Embed(
                title="✅ Temporary Voice Setup",
                description=(f"**Category:** {category.mention}\n"
                             f"**Creator Channel:** {creator.mention}\n\n"
                             "Users can join the creator channel to get their own temp voice channel!"),
                color=SUCCESS_COLOR)
            await interaction.response.send_message(embed=embed)
            logger.info(f"Temp voice setup in {interaction.guild}")
        except discord.Forbidden:
            await interaction.response.send_message(
                "I don't have permission to create channels.", ephemeral=True)

    def _in_temp(self, interaction: discord.Interaction) -> Optional[discord.VoiceChannel]:
        """Returns the user's current temp channel or None."""
        if not interaction.user.voice or not interaction.user.voice.channel:
            return None
        ch = interaction.user.voice.channel
        return ch if ch.id in self.temp_channels else None

    @app_commands.command(name="voice-lock", description="Lock your temporary voice channel")
    async def voice_lock(self, interaction: discord.Interaction):
        ch = self._in_temp(interaction)
        if not ch:
            await interaction.response.send_message(
                "You must be in your temp voice channel.", ephemeral=True)
            return
        try:
            await ch.set_permissions(interaction.guild.default_role, connect=False)
            await interaction.response.send_message(f"🔒 Locked {ch.mention}", ephemeral=True)
        except discord.Forbidden:
            await interaction.response.send_message("Missing permissions.", ephemeral=True)

    @app_commands.command(name="voice-unlock", description="Unlock your temporary voice channel")
    async def voice_unlock(self, interaction: discord.Interaction):
        ch = self._in_temp(interaction)
        if not ch:
            await interaction.response.send_message(
                "You must be in your temp voice channel.", ephemeral=True)
            return
        try:
            await ch.set_permissions(interaction.guild.default_role, connect=True)
            await interaction.response.send_message(f"🔓 Unlocked {ch.mention}", ephemeral=True)
        except discord.Forbidden:
            await interaction.response.send_message("Missing permissions.", ephemeral=True)

    @app_commands.command(name="voice-limit", description="Set user limit for your temp voice channel")
    @app_commands.describe(limit="User limit (0 for no limit)")
    async def voice_limit(self, interaction: discord.Interaction, limit: int):
        ch = self._in_temp(interaction)
        if not ch:
            await interaction.response.send_message(
                "You must be in your temp voice channel.", ephemeral=True)
            return
        if not 0 <= limit <= 99:
            await interaction.response.send_message("Limit must be 0–99.", ephemeral=True)
            return
        try:
            await ch.edit(user_limit=limit)
            text = "No limit" if limit == 0 else f"{limit} users"
            await interaction.response.send_message(f"👥 User limit set to: {text}", ephemeral=True)
        except discord.Forbidden:
            await interaction.response.send_message("Missing permissions.", ephemeral=True)

    @app_commands.command(name="voice-rename", description="Rename your temp voice channel")
    @app_commands.describe(name="New channel name")
    async def voice_rename(self, interaction: discord.Interaction, name: str):
        ch = self._in_temp(interaction)
        if not ch:
            await interaction.response.send_message(
                "You must be in your temp voice channel.", ephemeral=True)
            return
        if len(name) > 100:
            await interaction.response.send_message("Name must be under 100 characters.", ephemeral=True)
            return
        try:
            old = ch.name
            await ch.edit(name=name)
            await interaction.response.send_message(
                f"✏️ Renamed **{old}** → **{name}**", ephemeral=True)
        except discord.Forbidden:
            await interaction.response.send_message("Missing permissions.", ephemeral=True)

    @app_commands.command(name="voice-claim", description="Claim ownership of an abandoned temp channel")
    async def voice_claim(self, interaction: discord.Interaction):
        ch = self._in_temp(interaction)
        if not ch:
            await interaction.response.send_message(
                "You must be in a temp voice channel.", ephemeral=True)
            return
        try:
            await ch.set_permissions(interaction.user,
                                      connect=True, manage_channels=True,
                                      move_members=True, mute_members=True, deafen_members=True)
            await interaction.response.send_message(f"👑 You now own {ch.mention}", ephemeral=True)
        except discord.Forbidden:
            await interaction.response.send_message("Missing permissions.", ephemeral=True)


async def setup(bot: commands.Bot):
    await bot.add_cog(TempVoice(bot))
