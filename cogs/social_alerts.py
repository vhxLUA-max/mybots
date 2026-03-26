"""
Social Alerts Cog - ported from Logiq into mybots
Monitor Twitch, YouTube, Twitter/X for new content
Alerts stored in-memory (extend to Supabase if needed)
"""

import discord
from discord import app_commands
from discord.ext import commands, tasks
from typing import Optional
import logging
import asyncio
import aiohttp

logger = logging.getLogger(__name__)

SUCCESS_COLOR = 0x57F287
ERROR_COLOR   = 0xED4245
WARNING_COLOR = 0xFEE75C
INFO_COLOR    = 0x1ABC9C

PLATFORM_EMOJI = {'twitch': '🟣', 'youtube': '🔴', 'twitter': '🐦'}
PLATFORM_COLOR = {'twitch': 0x9146FF, 'youtube': 0xFF0000, 'twitter': 0x1DA1F2}


class SocialAlerts(commands.Cog):
    """Social media alerts cog"""

    def __init__(self, bot: commands.Bot):
        self.bot = bot
        # guild_id -> list of alert dicts
        self.alerts: dict[int, list] = {}
        self.check_alerts_task.start()

    def cog_unload(self):
        self.check_alerts_task.cancel()

    @tasks.loop(minutes=5)
    async def check_alerts_task(self):
        """Placeholder checker — extend with real API calls per platform."""
        pass

    @check_alerts_task.before_loop
    async def before_check(self):
        await self.bot.wait_until_ready()

    def _get_alerts(self, guild_id: int) -> list:
        return self.alerts.setdefault(guild_id, [])

    def _find_alert(self, guild_id: int, platform: str, username: str) -> Optional[dict]:
        for a in self._get_alerts(guild_id):
            if a['platform'] == platform and a['username'] == username.lower():
                return a
        return None

    @app_commands.command(name="alert-add", description="Add a social media alert (Admin)")
    @app_commands.describe(platform="Platform: twitch / youtube / twitter",
                           username="Username or channel ID",
                           channel="Channel to send alerts to")
    @app_commands.checks.has_permissions(administrator=True)
    async def add_alert(self, interaction: discord.Interaction, platform: str,
                        username: str, channel: discord.TextChannel):
        platform = platform.lower()
        if platform not in ('twitch', 'youtube', 'twitter'):
            await interaction.response.send_message(
                "Platform must be `twitch`, `youtube`, or `twitter`.", ephemeral=True)
            return

        if self._find_alert(interaction.guild.id, platform, username):
            await interaction.response.send_message(
                f"Alert for **{username}** on {platform} already exists.", ephemeral=True)
            return

        self._get_alerts(interaction.guild.id).append({
            'platform': platform,
            'username': username.lower(),
            'channel_id': channel.id,
            'last_content_id': None
        })

        embed = discord.Embed(
            title="Alert Added",
            description=(f"{PLATFORM_EMOJI[platform]} **{platform.title()}** alert added!\n\n"
                         f"**Username:** {username}\n**Channel:** {channel.mention}\n\n"
                         f"You'll be notified when {username} "
                         f"{'goes live' if platform == 'twitch' else 'posts new content'}!"),
            color=SUCCESS_COLOR)
        await interaction.response.send_message(embed=embed)
        logger.info(f"{interaction.user} added {platform} alert for {username}")

    @app_commands.command(name="alert-remove", description="Remove a social media alert (Admin)")
    @app_commands.describe(platform="Platform: twitch / youtube / twitter",
                           username="Username or channel ID")
    @app_commands.checks.has_permissions(administrator=True)
    async def remove_alert(self, interaction: discord.Interaction, platform: str, username: str):
        platform = platform.lower()
        alerts = self._get_alerts(interaction.guild.id)
        before = len(alerts)
        self.alerts[interaction.guild.id] = [
            a for a in alerts
            if not (a['platform'] == platform and a['username'] == username.lower())
        ]
        if len(self.alerts[interaction.guild.id]) == before:
            await interaction.response.send_message(
                f"No alert found for **{username}** on {platform}.", ephemeral=True)
            return
        await interaction.response.send_message(
            embed=discord.Embed(description=f"Removed {platform} alert for **{username}**.",
                                color=SUCCESS_COLOR))
        logger.info(f"{interaction.user} removed {platform} alert for {username}")

    @app_commands.command(name="alert-list", description="List all social media alerts (Admin)")
    @app_commands.checks.has_permissions(administrator=True)
    async def list_alerts(self, interaction: discord.Interaction):
        alerts = self._get_alerts(interaction.guild.id)
        if not alerts:
            await interaction.response.send_message("No social media alerts configured.", ephemeral=True)
            return

        grouped: dict[str, list] = {'twitch': [], 'youtube': [], 'twitter': []}
        for a in alerts:
            ch = interaction.guild.get_channel(a['channel_id'])
            grouped[a['platform']].append(
                f"• **{a['username']}** → {ch.mention if ch else 'Unknown'}"
            )

        desc = ""
        for platform, items in grouped.items():
            if items:
                desc += f"\n{PLATFORM_EMOJI[platform]} **{platform.title()}**\n"
                desc += "\n".join(items) + "\n"

        embed = discord.Embed(title="📢 Social Media Alerts",
                              description=desc or "None configured.", color=INFO_COLOR)
        await interaction.response.send_message(embed=embed)

    @app_commands.command(name="alert-test", description="Send a test alert notification (Admin)")
    @app_commands.describe(platform="Platform: twitch / youtube / twitter",
                           username="Username to test")
    @app_commands.checks.has_permissions(administrator=True)
    async def test_alert(self, interaction: discord.Interaction, platform: str, username: str):
        platform = platform.lower()
        alert = self._find_alert(interaction.guild.id, platform, username)
        if not alert:
            await interaction.response.send_message(
                f"No alert found for **{username}** on {platform}.", ephemeral=True)
            return

        channel = interaction.guild.get_channel(alert['channel_id'])
        if not channel:
            await interaction.response.send_message("Alert channel no longer exists.", ephemeral=True)
            return

        test_desc = {
            'twitch': f"**{username}** is now live on Twitch!\n\n**Title:** Test Stream\n**Game:** Just Chatting\n\n[Watch Now](https://twitch.tv/{username})",
            'youtube': f"**{username}** uploaded a new video!\n\n**Title:** Test Video\n\n[Watch Now](https://youtube.com/@{username})",
            'twitter': f"**{username}** posted a new tweet!\n\n*This is a test tweet*\n\n[View Tweet](https://twitter.com/{username})",
        }

        embed = discord.Embed(
            title=f"{PLATFORM_EMOJI[platform]} Test: {platform.title()} Alert",
            description=test_desc[platform],
            color=PLATFORM_COLOR[platform])
        embed.set_footer(text="This is a test notification")

        await channel.send(embed=embed)
        await interaction.response.send_message(
            f"Test notification sent to {channel.mention}!", ephemeral=True)


async def setup(bot: commands.Bot):
    await bot.add_cog(SocialAlerts(bot))
