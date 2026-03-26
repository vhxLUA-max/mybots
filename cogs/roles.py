"""
Roles Cog - ported from Logiq into mybots
Self-assignable role menus (exclusive or multi-select dropdowns)
"""

import discord
from discord import app_commands
from discord.ext import commands
from typing import Optional, List
import logging
import re

logger = logging.getLogger(__name__)

SUCCESS_COLOR = 0x57F287
ERROR_COLOR   = 0xED4245
PRIMARY_COLOR = 0x5865F2


# ─────────────────────── Role Select Components ──────────────────────────────

class ExclusiveRoleSelect(discord.ui.Select):
    """Pick exactly one role — locked after first selection."""

    def __init__(self, role_data: List[dict], category_name: str):
        options = [
            discord.SelectOption(
                label=r['label'][:100],
                description=f"Get the {r['label'][:50]} role",
                value=str(r['role'].id),
                emoji=r['emoji']
            )
            for r in role_data[:25]
        ]
        super().__init__(
            placeholder="Choose your option...",
            min_values=1, max_values=1,
            options=options,
            custom_id=f"exclusive_role_{re.sub(r'[^a-z0-9]', '', category_name.lower())[:40]}"
        )
        self.role_ids = [r['role'].id for r in role_data]

    async def callback(self, interaction: discord.Interaction):
        try:
            for rid in self.role_ids:
                role = interaction.guild.get_role(rid)
                if role and role in interaction.user.roles:
                    await interaction.response.send_message(
                        embed=discord.Embed(
                            title="🔒 Role Already Selected",
                            description=f"You already have **{role.name}**. You cannot pick another role from this menu.",
                            color=ERROR_COLOR),
                        ephemeral=True)
                    return

            selected = interaction.guild.get_role(int(self.values[0]))
            if not selected:
                await interaction.response.send_message("Role not found.", ephemeral=True)
                return

            await interaction.user.add_roles(selected, reason="Exclusive role menu")
            await interaction.response.send_message(
                embed=discord.Embed(
                    title="✅ Role Selected!",
                    description=f"You now have the **{selected.name}** role!\n\n*You cannot select another role from this menu.*",
                    color=SUCCESS_COLOR),
                ephemeral=True)
        except discord.Forbidden:
            await interaction.response.send_message(
                "I don't have permission to manage roles.", ephemeral=True)


class MultiRoleSelect(discord.ui.Select):
    """Toggle multiple roles on/off."""

    def __init__(self, role_data: List[dict]):
        options = [
            discord.SelectOption(
                label=r['label'][:100],
                description=f"Toggle {r['label'][:50]} role",
                value=str(r['role'].id),
                emoji=r['emoji']
            )
            for r in role_data[:25]
        ]
        super().__init__(
            placeholder="Select roles to add/remove...",
            min_values=0, max_values=len(options),
            options=options,
            custom_id="multi_role_select"
        )

    async def callback(self, interaction: discord.Interaction):
        try:
            selected_ids = {int(v) for v in self.values}
            current_ids  = {r.id for r in interaction.user.roles}
            available_ids = {int(o.value) for o in self.options}

            to_add    = []
            to_remove = []
            for rid in available_ids:
                role = interaction.guild.get_role(rid)
                if not role:
                    continue
                if rid in selected_ids and rid not in current_ids:
                    to_add.append(role)
                elif rid not in selected_ids and rid in current_ids:
                    to_remove.append(role)

            if to_add:
                await interaction.user.add_roles(*to_add, reason="Role menu")
            if to_remove:
                await interaction.user.remove_roles(*to_remove, reason="Role menu")

            changes = []
            if to_add:
                changes.append(f"**Added:** {', '.join(r.name for r in to_add)}")
            if to_remove:
                changes.append(f"**Removed:** {', '.join(r.name for r in to_remove)}")
            if not changes:
                changes.append("No changes made.")

            await interaction.response.send_message(
                embed=discord.Embed(title="✅ Roles Updated!",
                                    description="\n".join(changes), color=SUCCESS_COLOR),
                ephemeral=True)
        except discord.Forbidden:
            await interaction.response.send_message(
                "I don't have permission to manage roles.", ephemeral=True)


class ExclusiveRoleView(discord.ui.View):
    def __init__(self, role_data: List[dict], category_name: str):
        super().__init__(timeout=None)
        self.add_item(ExclusiveRoleSelect(role_data, category_name))


class MultiRoleView(discord.ui.View):
    def __init__(self, role_data: List[dict]):
        super().__init__(timeout=None)
        self.add_item(MultiRoleSelect(role_data))


# ─────────────────────── Cog ─────────────────────────────────────────────────

def _build_role_list(roles: List[discord.Role]) -> List[dict]:
    result = []
    for role in roles:
        if role.is_default() or role.is_integration():
            continue
        emoji = role.unicode_emoji or "🎭"
        result.append({'role': role, 'emoji': emoji, 'label': role.name})
    return result


class Roles(commands.Cog):
    """Role management cog"""

    def __init__(self, bot: commands.Bot):
        self.bot = bot

    @app_commands.command(name="create-role-menu", description="Create a self-assign role menu (Admin)")
    @app_commands.describe(
        title="Menu title", description="Menu description",
        role1="First role", role2="Role 2", role3="Role 3", role4="Role 4", role5="Role 5",
        role6="Role 6", role7="Role 7", role8="Role 8", role9="Role 9", role10="Role 10",
        exclusive="Only allow ONE role choice? (yes/no)",
        channel="Channel to post in (default: current)"
    )
    @app_commands.checks.has_permissions(administrator=True)
    async def create_role_menu(
        self, interaction: discord.Interaction,
        title: str, description: str,
        role1: discord.Role,
        exclusive: str,
        role2: Optional[discord.Role] = None, role3: Optional[discord.Role] = None,
        role4: Optional[discord.Role] = None, role5: Optional[discord.Role] = None,
        role6: Optional[discord.Role] = None, role7: Optional[discord.Role] = None,
        role8: Optional[discord.Role] = None, role9: Optional[discord.Role] = None,
        role9b: Optional[discord.Role] = None, role10: Optional[discord.Role] = None,
        channel: Optional[discord.TextChannel] = None
    ):
        target = channel or interaction.channel
        is_exclusive = exclusive.lower() in ('yes', 'y', 'true')

        raw_roles = [role1, role2, role3, role4, role5,
                     role6, role7, role8, role9, role9b, role10]
        role_list = _build_role_list([r for r in raw_roles if r])

        if not role_list:
            await interaction.response.send_message("No valid roles provided.", ephemeral=True)
            return

        embed = discord.Embed(title=title, description=description, color=PRIMARY_COLOR)
        roles_text = "\n".join(f"{r['emoji']} {r['role'].mention}" for r in role_list)
        embed.add_field(name="Available Roles", value=roles_text, inline=False)

        view = ExclusiveRoleView(role_list, title) if is_exclusive else MultiRoleView(role_list)
        await target.send(embed=embed, view=view)

        await interaction.response.send_message(
            embed=discord.Embed(
                description=f"{'Exclusive' if is_exclusive else 'Multi-select'} role menu created in {target.mention}!",
                color=SUCCESS_COLOR),
            ephemeral=True)
        logger.info(f"Role menu created by {interaction.user} with {len(role_list)} roles")

    @app_commands.command(name="addrole", description="Add a role to a user (Admin)")
    @app_commands.describe(user="User to add role to", role="Role to add")
    @app_commands.checks.has_permissions(administrator=True)
    async def add_role(self, interaction: discord.Interaction, user: discord.Member, role: discord.Role):
        if role in user.roles:
            await interaction.response.send_message(
                f"{user.mention} already has {role.mention}.", ephemeral=True)
            return
        try:
            await user.add_roles(role)
            await interaction.response.send_message(
                embed=discord.Embed(description=f"Added {role.mention} to {user.mention}.", color=SUCCESS_COLOR))
        except discord.Forbidden:
            await interaction.response.send_message("Missing permissions.", ephemeral=True)

    @app_commands.command(name="removerole", description="Remove a role from a user (Admin)")
    @app_commands.describe(user="User to remove role from", role="Role to remove")
    @app_commands.checks.has_permissions(administrator=True)
    async def remove_role(self, interaction: discord.Interaction, user: discord.Member, role: discord.Role):
        if role not in user.roles:
            await interaction.response.send_message(
                f"{user.mention} doesn't have {role.mention}.", ephemeral=True)
            return
        try:
            await user.remove_roles(role)
            await interaction.response.send_message(
                embed=discord.Embed(description=f"Removed {role.mention} from {user.mention}.", color=SUCCESS_COLOR))
        except discord.Forbidden:
            await interaction.response.send_message("Missing permissions.", ephemeral=True)


async def setup(bot: commands.Bot):
    await bot.add_cog(Roles(bot))
