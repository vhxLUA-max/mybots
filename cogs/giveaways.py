"""
Giveaways Cog - ported from Logiq into mybots
Giveaway system with button entry, auto-end, reroll
"""

import discord
from discord import app_commands
from discord.ext import commands
from datetime import datetime
from typing import Optional
import logging
import random
import asyncio

import config as cfg

logger = logging.getLogger(__name__)

SUCCESS_COLOR = 0x57F287
ERROR_COLOR   = 0xED4245
WARNING_COLOR = 0xFEE75C
EMBED_COLOR   = 0x5865F2


class GiveawayView(discord.ui.View):
    """Persistent button view for giveaway entry"""

    def __init__(self, giveaway_id: str):
        super().__init__(timeout=None)
        self.giveaway_id = giveaway_id

    @discord.ui.button(label="🎉 Enter Giveaway", style=discord.ButtonStyle.success,
                       custom_id="giveaway_enter")
    async def enter_giveaway(self, interaction: discord.Interaction, button: discord.ui.Button):
        cog: Giveaways = interaction.client.cogs.get("Giveaways")
        if not cog:
            await interaction.response.send_message("Giveaway system unavailable.", ephemeral=True)
            return

        giveaway = cog.active_giveaways.get(self.giveaway_id)
        if not giveaway:
            await interaction.response.send_message(
                embed=discord.Embed(title="Error", description="Giveaway not found.", color=ERROR_COLOR),
                ephemeral=True)
            return

        if giveaway.get("ended"):
            await interaction.response.send_message(
                embed=discord.Embed(title="Ended", description="This giveaway has already ended.", color=ERROR_COLOR),
                ephemeral=True)
            return

        participants = giveaway.setdefault("participants", [])
        if interaction.user.id in participants:
            await interaction.response.send_message(
                embed=discord.Embed(title="Already Entered",
                                    description="You have already entered this giveaway!",
                                    color=WARNING_COLOR),
                ephemeral=True)
            return

        participants.append(interaction.user.id)
        await interaction.response.send_message(
            embed=discord.Embed(title="Entered! 🎉",
                                description=f"You have been entered into the giveaway for **{giveaway['prize']}**!",
                                color=SUCCESS_COLOR),
            ephemeral=True)
        logger.info(f"{interaction.user} entered giveaway {self.giveaway_id}")


class Giveaways(commands.Cog):
    """Giveaway system cog"""

    def __init__(self, bot: commands.Bot):
        self.bot = bot
        # In-memory store: giveaway_id -> giveaway_dict
        self.active_giveaways: dict = {}
        self._giveaway_counter = 0
        self._checker_task = bot.loop.create_task(self._check_giveaways())

    def cog_unload(self):
        self._checker_task.cancel()

    def _next_id(self) -> str:
        self._giveaway_counter += 1
        return str(self._giveaway_counter)

    async def _check_giveaways(self):
        await self.bot.wait_until_ready()
        while not self.bot.is_closed():
            try:
                now = datetime.utcnow().timestamp()
                for gid, giveaway in list(self.active_giveaways.items()):
                    if not giveaway.get("ended") and giveaway["end_time"] <= now:
                        await self._end_giveaway(gid, giveaway)
            except Exception as e:
                logger.error(f"Giveaway checker error: {e}")
            await asyncio.sleep(30)

    async def _end_giveaway(self, gid: str, giveaway: dict):
        try:
            guild = self.bot.get_guild(giveaway["guild_id"])
            if not guild:
                return
            channel = guild.get_channel(giveaway["channel_id"])
            if not channel:
                return

            participants = giveaway.get("participants", [])
            winners_count = giveaway.get("winners", 1)
            giveaway["ended"] = True

            if not participants:
                embed = discord.Embed(title="🎉 Giveaway Ended",
                                      description=f"**Prize:** {giveaway['prize']}\n\nNo one entered! 😢",
                                      color=WARNING_COLOR)
                await channel.send(embed=embed)
            else:
                winners = random.sample(participants, min(winners_count, len(participants)))
                mentions = " ".join(f"<@{uid}>" for uid in winners)
                embed = discord.Embed(
                    title="🎉 Giveaway Ended",
                    description=f"**Prize:** {giveaway['prize']}\n\n**Winner{'s' if len(winners) > 1 else ''}:** {mentions}\n\nCongratulations! 🎊",
                    color=SUCCESS_COLOR)
                await channel.send(mentions, embed=embed)
                giveaway["winners_list"] = winners

            logger.info(f"Ended giveaway {gid}")
        except Exception as e:
            logger.error(f"Error ending giveaway {gid}: {e}")

    @app_commands.command(name="giveaway", description="Start a giveaway (Admin)")
    @app_commands.describe(prize="Prize to give away", duration="Duration e.g. 1h 30m 1d",
                           winners="Number of winners (default 1)")
    @app_commands.checks.has_permissions(administrator=True)
    async def start_giveaway(self, interaction: discord.Interaction, prize: str,
                              duration: str, winners: int = 1):
        if not 1 <= winners <= 20:
            await interaction.response.send_message("Winners must be between 1 and 20.", ephemeral=True)
            return

        seconds = self._parse_duration(duration)
        if not seconds or seconds < 60:
            await interaction.response.send_message("Duration must be at least 1 minute (e.g. 1h, 30m, 1d).", ephemeral=True)
            return
        if seconds > 2592000:
            await interaction.response.send_message("Max giveaway duration is 30 days.", ephemeral=True)
            return

        end_time = datetime.utcnow().timestamp() + seconds
        gid = self._next_id()

        self.active_giveaways[gid] = {
            "guild_id": interaction.guild.id,
            "channel_id": interaction.channel.id,
            "prize": prize,
            "winners": winners,
            "end_time": end_time,
            "ended": False,
            "participants": []
        }

        end_ts = int(end_time)
        embed = discord.Embed(
            title="🎉 GIVEAWAY 🎉",
            description=(f"**Prize:** {prize}\n**Winners:** {winners}\n"
                         f"**Hosted by:** {interaction.user.mention}\n"
                         f"**Ends:** <t:{end_ts}:R> (<t:{end_ts}:F>)\n\n"
                         "Click the button below to enter!"),
            color=SUCCESS_COLOR)
        embed.timestamp = datetime.utcfromtimestamp(end_time)

        view = GiveawayView(gid)
        await interaction.response.send_message("🎉 Giveaway started!", ephemeral=True)
        await interaction.channel.send(embed=embed, view=view)
        logger.info(f"{interaction.user} started giveaway {gid} in {interaction.guild}")

    @app_commands.command(name="gend", description="End the current channel's giveaway early (Admin)")
    @app_commands.checks.has_permissions(administrator=True)
    async def gend(self, interaction: discord.Interaction):
        found = None
        for gid, g in self.active_giveaways.items():
            if g["channel_id"] == interaction.channel.id and not g.get("ended"):
                found = (gid, g)
                break
        if not found:
            await interaction.response.send_message("No active giveaway found in this channel.", ephemeral=True)
            return
        await interaction.response.send_message("Ending the giveaway now...", ephemeral=True)
        await self._end_giveaway(*found)

    @app_commands.command(name="greroll", description="Reroll giveaway winners (Admin)")
    @app_commands.checks.has_permissions(administrator=True)
    async def greroll(self, interaction: discord.Interaction):
        found = None
        for gid, g in self.active_giveaways.items():
            if g["guild_id"] == interaction.guild.id and g.get("ended"):
                found = g
                break
        if not found:
            await interaction.response.send_message("No ended giveaway found.", ephemeral=True)
            return

        participants = found.get("participants", [])
        if not participants:
            await interaction.response.send_message("No participants in that giveaway.", ephemeral=True)
            return

        winners = random.sample(participants, min(found.get("winners", 1), len(participants)))
        mentions = " ".join(f"<@{uid}>" for uid in winners)
        embed = discord.Embed(
            title="🎉 Giveaway Rerolled",
            description=f"**Prize:** {found['prize']}\n\n**New Winner(s):** {mentions}\n\nCongratulations! 🎊",
            color=SUCCESS_COLOR)
        await interaction.response.send_message(mentions, embed=embed)

    @staticmethod
    def _parse_duration(duration: str) -> Optional[int]:
        """Parse duration string like 1h, 30m, 2d into seconds."""
        import re
        total = 0
        matches = re.findall(r'(\d+)\s*([smhd])', duration.lower())
        if not matches:
            return None
        units = {'s': 1, 'm': 60, 'h': 3600, 'd': 86400}
        for value, unit in matches:
            total += int(value) * units[unit]
        return total or None


async def setup(bot: commands.Bot):
    await bot.add_cog(Giveaways(bot))
