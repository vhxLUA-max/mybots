"""
Analytics Cog - ported from Logiq into mybots
Server analytics: messages, joins, leaves, active users
Uses in-memory event log (extend to Supabase for persistence)
"""

import discord
from discord import app_commands
from discord.ext import commands
from datetime import datetime, timedelta
from typing import Optional
import logging

logger = logging.getLogger(__name__)

INFO_COLOR  = 0x1ABC9C
ERROR_COLOR = 0xED4245


class Analytics(commands.Cog):
    """Analytics and statistics cog"""

    def __init__(self, bot: commands.Bot):
        self.bot = bot
        # In-memory event log: list of {event_type, guild_id, user_id, timestamp}
        self.events: list[dict] = []
        # Limit memory usage — keep last 50k events
        self._max_events = 50_000

    def _log(self, event_type: str, guild_id: int, user_id: int):
        self.events.append({
            'event_type': event_type,
            'guild_id': guild_id,
            'user_id': user_id,
            'timestamp': datetime.utcnow().timestamp()
        })
        if len(self.events) > self._max_events:
            self.events = self.events[-self._max_events:]

    def _query(self, guild_id: int, event_type: Optional[str],
               start: float, end: float) -> list[dict]:
        return [
            e for e in self.events
            if e['guild_id'] == guild_id
            and (event_type is None or e['event_type'] == event_type)
            and start <= e['timestamp'] <= end
        ]

    @commands.Cog.listener()
    async def on_message(self, message: discord.Message):
        if message.author.bot or not message.guild:
            return
        self._log('message', message.guild.id, message.author.id)

    @commands.Cog.listener()
    async def on_member_join(self, member: discord.Member):
        self._log('member_join', member.guild.id, member.id)

    @commands.Cog.listener()
    async def on_member_remove(self, member: discord.Member):
        self._log('member_leave', member.guild.id, member.id)

    @app_commands.command(name="analytics", description="View server analytics (Admin)")
    @app_commands.describe(days="Number of days to analyse (1-365, default 7)")
    @app_commands.checks.has_permissions(administrator=True)
    async def analytics(self, interaction: discord.Interaction, days: int = 7):
        if not 1 <= days <= 365:
            await interaction.response.send_message("Days must be 1–365.", ephemeral=True)
            return

        await interaction.response.defer()
        now = datetime.utcnow().timestamp()
        start = now - days * 86400

        messages = self._query(interaction.guild.id, 'message', start, now)
        joins    = self._query(interaction.guild.id, 'member_join', start, now)
        leaves   = self._query(interaction.guild.id, 'member_leave', start, now)

        net_growth = len(joins) - len(leaves)

        # Most active users
        counts: dict[int, int] = {}
        for e in messages:
            counts[e['user_id']] = counts.get(e['user_id'], 0) + 1
        top = sorted(counts.items(), key=lambda x: x[1], reverse=True)[:5]
        top_text = "\n".join(
            f"{i+1}. <@{uid}>: {cnt} messages" for i, (uid, cnt) in enumerate(top)
        ) or "No data yet"

        embed = discord.Embed(
            title=f"📊 Server Analytics — Last {days} Day{'s' if days != 1 else ''}",
            color=INFO_COLOR,
            timestamp=datetime.utcnow()
        )
        embed.add_field(name="💬 Total Messages",  value=str(len(messages)), inline=True)
        embed.add_field(name="👋 Members Joined",  value=str(len(joins)),    inline=True)
        embed.add_field(name="🚪 Members Left",    value=str(len(leaves)),   inline=True)
        embed.add_field(name="📈 Net Growth",      value=str(net_growth),    inline=True)
        embed.add_field(name="📅 Period",          value=f"{days} days",     inline=True)
        embed.add_field(name="👥 Current Members",
                        value=str(interaction.guild.member_count), inline=True)
        embed.add_field(name="🏆 Most Active Users", value=top_text, inline=False)

        await interaction.followup.send(embed=embed)
        logger.info(f"Analytics generated for {interaction.guild}")

    @app_commands.command(name="activity", description="View last 24 hours of server activity (Admin)")
    @app_commands.checks.has_permissions(administrator=True)
    async def activity(self, interaction: discord.Interaction):
        now   = datetime.utcnow().timestamp()
        start = now - 86400

        events = self._query(interaction.guild.id, None, start, now)
        if not events:
            await interaction.response.send_message(
                "No activity data for the last 24 hours.", ephemeral=True)
            return

        hourly: dict[str, int] = {}
        for e in events:
            hour = datetime.fromtimestamp(e['timestamp']).strftime("%H:00")
            hourly[hour] = hourly.get(hour, 0) + 1

        chart = ""
        for hour, count in sorted(hourly.items())[-12:]:
            bar = "█" * min(count // 5, 30)
            chart += f"{hour}: {bar} ({count})\n"

        embed = discord.Embed(
            title="📈 Server Activity — Last 24 Hours",
            description=f"```\n{chart}\n```",
            color=INFO_COLOR
        )
        embed.set_footer(text=f"Total events tracked: {len(events)}")
        await interaction.response.send_message(embed=embed)


async def setup(bot: commands.Bot):
    await bot.add_cog(Analytics(bot))
