"""
Music Cog - ported from Logiq into mybots
Music player with queue, controls, and voice management
"""

import discord
from discord import app_commands
from discord.ext import commands
from typing import Optional
import logging
import asyncio

logger = logging.getLogger(__name__)

INFO_COLOR    = 0x1ABC9C
SUCCESS_COLOR = 0x57F287
ERROR_COLOR   = 0xED4245


class MusicQueue:
    def __init__(self):
        self.queue = []
        self.current = None
        self.loop = False

    def add(self, track):
        self.queue.append(track)

    def next(self):
        if self.loop and self.current:
            return self.current
        if self.queue:
            self.current = self.queue.pop(0)
            return self.current
        return None

    def clear(self):
        self.queue = []
        self.current = None


class MusicControlView(discord.ui.View):
    def __init__(self, cog: "Music"):
        super().__init__(timeout=None)
        self.cog = cog

    @discord.ui.button(label="⏸️ Pause", style=discord.ButtonStyle.primary, custom_id="music_pause")
    async def pause_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        vc = interaction.guild.voice_client
        if not vc:
            await interaction.response.send_message("No music is playing.", ephemeral=True)
            return
        if vc.is_playing():
            vc.pause()
            button.label = "▶️ Resume"
            await interaction.response.edit_message(view=self)
        elif vc.is_paused():
            vc.resume()
            button.label = "⏸️ Pause"
            await interaction.response.edit_message(view=self)

    @discord.ui.button(label="⏭️ Skip", style=discord.ButtonStyle.secondary, custom_id="music_skip")
    async def skip_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        vc = interaction.guild.voice_client
        if vc and (vc.is_playing() or vc.is_paused()):
            vc.stop()
            await interaction.response.send_message("Skipped!", ephemeral=True)
        else:
            await interaction.response.send_message("Nothing playing.", ephemeral=True)

    @discord.ui.button(label="⏹️ Stop", style=discord.ButtonStyle.danger, custom_id="music_stop")
    async def stop_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        vc = interaction.guild.voice_client
        if not vc:
            await interaction.response.send_message("Not connected.", ephemeral=True)
            return
        gid = interaction.guild.id
        if gid in self.cog.queues:
            self.cog.queues[gid].clear()
        await vc.disconnect()
        await interaction.response.send_message("Stopped and disconnected.", ephemeral=True)


class Music(commands.Cog):
    """Music player cog"""

    def __init__(self, bot: commands.Bot):
        self.bot = bot
        self.queues: dict[int, MusicQueue] = {}

    def get_queue(self, guild_id: int) -> MusicQueue:
        if guild_id not in self.queues:
            self.queues[guild_id] = MusicQueue()
        return self.queues[guild_id]

    @app_commands.command(name="play", description="Add a track to the music queue")
    @app_commands.describe(query="Song name or YouTube URL")
    async def play(self, interaction: discord.Interaction, query: str):
        if not interaction.user.voice:
            await interaction.response.send_message(
                embed=discord.Embed(description="You must be in a voice channel!", color=ERROR_COLOR),
                ephemeral=True)
            return

        await interaction.response.defer()

        if not interaction.guild.voice_client:
            try:
                await interaction.user.voice.channel.connect()
            except Exception as e:
                await interaction.followup.send(f"Could not join voice channel: {e}", ephemeral=True)
                return

        queue = self.get_queue(interaction.guild.id)
        queue.add(query)

        embed = discord.Embed(title="Added to Queue", color=SUCCESS_COLOR)
        embed.add_field(name="Track", value=query, inline=False)
        embed.add_field(name="Requested by", value=interaction.user.mention, inline=True)
        embed.add_field(name="Position", value=str(len(queue.queue)), inline=True)
        await interaction.followup.send(embed=embed)

    @app_commands.command(name="join", description="Join your voice channel")
    async def join(self, interaction: discord.Interaction):
        if not interaction.user.voice:
            await interaction.response.send_message("You must be in a voice channel.", ephemeral=True)
            return
        channel = interaction.user.voice.channel
        if interaction.guild.voice_client:
            await interaction.guild.voice_client.move_to(channel)
        else:
            await channel.connect()
        await interaction.response.send_message(
            embed=discord.Embed(description=f"Joined {channel.mention}", color=SUCCESS_COLOR))

    @app_commands.command(name="leave", description="Leave the voice channel")
    async def leave(self, interaction: discord.Interaction):
        if not interaction.guild.voice_client:
            await interaction.response.send_message("Not connected to a voice channel.", ephemeral=True)
            return
        self.get_queue(interaction.guild.id).clear()
        await interaction.guild.voice_client.disconnect()
        await interaction.response.send_message(
            embed=discord.Embed(description="Disconnected from voice.", color=SUCCESS_COLOR))

    @app_commands.command(name="queue", description="View the music queue")
    async def view_queue(self, interaction: discord.Interaction):
        queue = self.get_queue(interaction.guild.id)
        if not queue.current and not queue.queue:
            await interaction.response.send_message(
                embed=discord.Embed(description="The queue is empty.", color=INFO_COLOR), ephemeral=True)
            return
        desc = ""
        if queue.current:
            desc += f"**Now Playing:**\n{queue.current}\n\n"
        if queue.queue:
            desc += "**Up Next:**\n"
            for i, track in enumerate(queue.queue[:10], 1):
                desc += f"{i}. {track}\n"
        embed = discord.Embed(title="🎵 Music Queue", description=desc, color=INFO_COLOR)
        await interaction.response.send_message(embed=embed)

    @app_commands.command(name="skip", description="Skip the current track")
    async def skip(self, interaction: discord.Interaction):
        vc = interaction.guild.voice_client
        if not vc or (not vc.is_playing() and not vc.is_paused()):
            await interaction.response.send_message("Nothing is playing.", ephemeral=True)
            return
        vc.stop()
        await interaction.response.send_message(
            embed=discord.Embed(description="Skipped current track.", color=SUCCESS_COLOR))

    @app_commands.command(name="pause", description="Pause the music")
    async def pause(self, interaction: discord.Interaction):
        vc = interaction.guild.voice_client
        if not vc or not vc.is_playing():
            await interaction.response.send_message("Nothing is playing.", ephemeral=True)
            return
        vc.pause()
        await interaction.response.send_message(
            embed=discord.Embed(description="Music paused.", color=INFO_COLOR))

    @app_commands.command(name="resume", description="Resume the music")
    async def resume(self, interaction: discord.Interaction):
        vc = interaction.guild.voice_client
        if not vc or not vc.is_paused():
            await interaction.response.send_message("Music is not paused.", ephemeral=True)
            return
        vc.resume()
        await interaction.response.send_message(
            embed=discord.Embed(description="Music resumed.", color=SUCCESS_COLOR))

    @app_commands.command(name="nowplaying", description="Show the currently playing track")
    async def nowplaying(self, interaction: discord.Interaction):
        queue = self.get_queue(interaction.guild.id)
        if not queue.current:
            await interaction.response.send_message("Nothing is playing right now.", ephemeral=True)
            return
        embed = discord.Embed(title="🎵 Now Playing", description=queue.current, color=INFO_COLOR)
        await interaction.response.send_message(embed=embed)

    @app_commands.command(name="volume", description="Set music volume 0-100 (Admin)")
    @app_commands.describe(volume="Volume level (0-100)")
    @app_commands.checks.has_permissions(administrator=True)
    async def volume(self, interaction: discord.Interaction, volume: int):
        if not 0 <= volume <= 100:
            await interaction.response.send_message("Volume must be between 0 and 100.", ephemeral=True)
            return
        await interaction.response.send_message(
            embed=discord.Embed(description=f"Volume set to {volume}%", color=SUCCESS_COLOR))


async def setup(bot: commands.Bot):
    await bot.add_cog(Music(bot))
