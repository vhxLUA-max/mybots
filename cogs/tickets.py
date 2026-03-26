"""
Tickets Cog - ported from Logiq into mybots
Support ticket system with button creation, logging, close
"""

import discord
from discord import app_commands
from discord.ext import commands
from typing import Optional
import logging
import asyncio

logger = logging.getLogger(__name__)

SUCCESS_COLOR = 0x57F287
ERROR_COLOR   = 0xED4245
WARNING_COLOR = 0xFEE75C
PRIMARY_COLOR = 0x5865F2


class TicketCreateView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Create Ticket", style=discord.ButtonStyle.green,
                       custom_id="create_ticket", emoji="🎫")
    async def create_ticket(self, interaction: discord.Interaction, button: discord.ui.Button):
        cog: Tickets = interaction.client.cogs.get("Tickets")
        if cog:
            await cog.create_ticket_for_user(interaction)


class TicketControlView(discord.ui.View):
    def __init__(self):
        super().__init__(timeout=None)

    @discord.ui.button(label="Close Ticket", style=discord.ButtonStyle.danger,
                       custom_id="close_ticket_btn", emoji="🔒")
    async def close_ticket_button(self, interaction: discord.Interaction, button: discord.ui.Button):
        cog: Tickets = interaction.client.cogs.get("Tickets")
        if cog:
            await cog.close_ticket_for_user(interaction, "Closed by user")


class Tickets(commands.Cog):
    """Support ticket system cog"""

    def __init__(self, bot: commands.Bot):
        self.bot = bot
        # guild_id -> config dict
        self.guild_configs: dict[int, dict] = {}
        self._ticket_counter = 0

        # Register persistent views
        bot.add_view(TicketCreateView())
        bot.add_view(TicketControlView())

    def _config(self, guild_id: int) -> dict:
        return self.guild_configs.get(guild_id, {})

    def _next_ticket_id(self) -> int:
        self._ticket_counter += 1
        return self._ticket_counter

    async def create_ticket_for_user(self, interaction: discord.Interaction):
        cfg = self._config(interaction.guild.id)
        category_id = cfg.get("ticket_category")
        if not category_id:
            await interaction.response.send_message(
                "Ticket system not configured. Ask an admin to run `/ticket-setup`.", ephemeral=True)
            return

        category = interaction.guild.get_channel(category_id)
        if not category or not isinstance(category, discord.CategoryChannel):
            await interaction.response.send_message("Ticket category not found.", ephemeral=True)
            return

        # Check for existing ticket
        existing = [ch for ch in category.channels
                    if ch.name.startswith(f"ticket-{interaction.user.name.lower()}")]
        if existing:
            await interaction.response.send_message(
                f"You already have an open ticket: {existing[0].mention}", ephemeral=True)
            return

        try:
            overwrites = {
                interaction.guild.default_role: discord.PermissionOverwrite(read_messages=False),
                interaction.user: discord.PermissionOverwrite(read_messages=True, send_messages=True),
                interaction.guild.me: discord.PermissionOverwrite(read_messages=True, send_messages=True),
            }

            support_role_id = cfg.get("support_role")
            if support_role_id:
                role = interaction.guild.get_role(support_role_id)
                if role:
                    overwrites[role] = discord.PermissionOverwrite(read_messages=True, send_messages=True)

            channel = await category.create_text_channel(
                name=f"ticket-{interaction.user.name.lower()}",
                overwrites=overwrites)

            ticket_id = self._next_ticket_id()
            embed = discord.Embed(
                title="🎫 Support Ticket",
                description=(f"Hello {interaction.user.mention}!\n\n"
                             "Please describe your issue and a staff member will assist you shortly.\n\n"
                             f"**Ticket ID:** #{ticket_id}"),
                color=SUCCESS_COLOR)
            await channel.send(embed=embed, view=TicketControlView())

            # Log to ticket log channel
            log_channel_id = cfg.get("ticket_log_channel")
            if log_channel_id:
                log_ch = interaction.guild.get_channel(log_channel_id)
                if log_ch:
                    log_embed = discord.Embed(
                        title="🎫 New Ticket Created",
                        description=(f"**Ticket:** {channel.mention}\n"
                                     f"**Created by:** {interaction.user.mention}\n"
                                     f"**Ticket ID:** #{ticket_id}\n**Status:** Open"),
                        color=SUCCESS_COLOR)
                    await log_ch.send(embed=log_embed)

            await interaction.response.send_message(
                f"Your ticket has been created: {channel.mention}", ephemeral=True)
            logger.info(f"Ticket #{ticket_id} created for {interaction.user} in {interaction.guild}")

        except discord.Forbidden:
            await interaction.response.send_message(
                "I don't have permission to create channels.", ephemeral=True)

    async def close_ticket_for_user(self, interaction: discord.Interaction, reason: str = "Resolved"):
        if not interaction.channel.name.startswith("ticket-"):
            await interaction.response.send_message(
                "This command can only be used in ticket channels.", ephemeral=True)
            return

        cfg = self._config(interaction.guild.id)
        support_role_id = cfg.get("support_role")
        is_ticket_owner = interaction.channel.name == f"ticket-{interaction.user.name.lower()}"
        is_admin = interaction.user.guild_permissions.administrator
        has_support = support_role_id and interaction.guild.get_role(support_role_id) in interaction.user.roles

        if not (is_ticket_owner or is_admin or has_support):
            await interaction.response.send_message(
                "Only the ticket owner or staff can close this ticket.", ephemeral=True)
            return

        # Log closure
        log_channel_id = cfg.get("ticket_log_channel")
        if log_channel_id:
            log_ch = interaction.guild.get_channel(log_channel_id)
            if log_ch:
                log_embed = discord.Embed(
                    title="🔒 Ticket Closed",
                    description=(f"**Ticket:** {interaction.channel.name}\n"
                                 f"**Closed by:** {interaction.user.mention}\n"
                                 f"**Reason:** {reason}\n**Status:** Closed"),
                    color=WARNING_COLOR)
                await log_ch.send(embed=log_embed)

        embed = discord.Embed(
            title="🔒 Ticket Closing",
            description=(f"This ticket is being closed by {interaction.user.mention}.\n\n"
                         f"**Reason:** {reason}\n\nChannel will be deleted in 5 seconds..."),
            color=WARNING_COLOR)
        await interaction.response.send_message(embed=embed)
        logger.info(f"Ticket {interaction.channel.name} closed by {interaction.user}")

        await asyncio.sleep(5)
        try:
            await interaction.channel.delete(reason=f"Ticket closed by {interaction.user}")
        except discord.Forbidden:
            logger.error(f"Cannot delete ticket channel: {interaction.channel.name}")

    @app_commands.command(name="ticket-setup", description="Setup the ticket system (Admin)")
    @app_commands.describe(category="Category for ticket channels",
                           log_channel="Channel for ticket logs",
                           support_role="Role to give access to tickets (optional)")
    @app_commands.checks.has_permissions(administrator=True)
    async def ticket_setup(self, interaction: discord.Interaction,
                            category: discord.CategoryChannel,
                            log_channel: discord.TextChannel,
                            support_role: Optional[discord.Role] = None):
        self.guild_configs[interaction.guild.id] = {
            "ticket_category": category.id,
            "ticket_log_channel": log_channel.id,
            "support_role": support_role.id if support_role else None
        }
        desc = (f"**Category:** {category.mention}\n"
                f"**Log Channel:** {log_channel.mention}\n")
        if support_role:
            desc += f"**Support Role:** {support_role.mention}"
        embed = discord.Embed(title="✅ Ticket System Setup", description=desc, color=SUCCESS_COLOR)
        await interaction.response.send_message(embed=embed)
        logger.info(f"Ticket system setup in {interaction.guild}")

    @app_commands.command(name="ticket-panel", description="Send the ticket creation panel (Admin)")
    @app_commands.checks.has_permissions(administrator=True)
    async def ticket_panel(self, interaction: discord.Interaction):
        embed = discord.Embed(
            title="🎫 Support Tickets",
            description=("Need help? Click the button below to create a support ticket!\n\n"
                         "A private channel will be created where you can talk with staff."),
            color=PRIMARY_COLOR)
        await interaction.channel.send(embed=embed, view=TicketCreateView())
        await interaction.response.send_message("Ticket panel sent!", ephemeral=True)

    @app_commands.command(name="close-ticket", description="Close a ticket (Staff/Admin)")
    @app_commands.describe(reason="Reason for closing")
    async def close_ticket(self, interaction: discord.Interaction, reason: str = "Resolved"):
        await self.close_ticket_for_user(interaction, reason)

    @app_commands.command(name="tickets", description="View all active tickets (Admin)")
    @app_commands.checks.has_permissions(administrator=True)
    async def view_tickets(self, interaction: discord.Interaction):
        cfg = self._config(interaction.guild.id)
        category_id = cfg.get("ticket_category")
        if not category_id:
            await interaction.response.send_message("Ticket system not configured.", ephemeral=True)
            return
        category = interaction.guild.get_channel(category_id)
        if not category:
            await interaction.response.send_message("Ticket category not found.", ephemeral=True)
            return

        ticket_channels = [ch for ch in category.channels if ch.name.startswith("ticket-")]
        if not ticket_channels:
            await interaction.response.send_message("No active tickets.", ephemeral=True)
            return

        desc = "\n".join(f"🎫 {ch.mention} — **{ch.name.replace('ticket-', '')}**"
                         for ch in ticket_channels[:25])
        embed = discord.Embed(title=f"🎫 Active Tickets ({len(ticket_channels)})",
                              description=desc, color=PRIMARY_COLOR)
        await interaction.response.send_message(embed=embed)


async def setup(bot: commands.Bot):
    await bot.add_cog(Tickets(bot))
