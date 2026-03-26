"""
Database operations using Supabase
Handles all database interactions for the bot
"""
import logging
from typing import Optional, Dict, List, Any
from datetime import datetime, timedelta
from supabase import create_client, Client
import config

logger = logging.getLogger(__name__)

class Database:
    def __init__(self):
        self.client: Optional[Client] = None

    async def init(self):
        """Initialize Supabase client"""
        if config.SUPABASE_URL and config.SUPABASE_ANON_KEY:
            self.client = create_client(config.SUPABASE_URL, config.SUPABASE_ANON_KEY)
            logger.info("✅ Supabase client initialized")

    # ============================================================================
    # Game & Stats Operations
    # ============================================================================
    async def get_total_executions(self) -> int:
        if not self.client:
            return 0
        try:
            result = self.client.table("game_executions").select("count").execute()
            return sum(item.get("count", 0) for item in result.data) if result.data else 0
        except Exception:
            return 0

    async def get_game_stats(self, game_name: str = None):
        if not self.client:
            return None
        try:
            if game_name:
                result = self.client.table("game_executions").select("*").like("game_name", f"%{game_name}%").execute()
                return result.data
            result = self.client.table("game_executions").select("*").execute()
            return result.data
        except Exception:
            return None

    async def get_top_games(self, limit: int = 10):
        if not self.client:
            return []
        try:
            result = self.client.table("game_executions").select("game_name,count").order("count", desc=True).limit(limit).execute()
            return result.data or []
        except Exception:
            return []

    # ============================================================================
    # User Profile Operations
    # ============================================================================
    async def get_user_profile(self, token: str = None, username: str = None, roblox_id: str = None):
        if not self.client:
            return None
        try:
            if token:
                token_result = self.client.table("user_tokens").select("roblox_user_id").eq("token", token).execute()
                if token_result.data:
                    result = self.client.table("unique_users").select("*").eq("roblox_user_id", token_result.data[0]["roblox_user_id"]).execute()
                    return result.data[0] if result.data else None
            elif username:
                result = self.client.table("unique_users").select("*").like("username", f"%{username}%").limit(1).execute()
                return result.data[0] if result.data else None
            elif roblox_id:
                result = self.client.table("unique_users").select("*").eq("roblox_user_id", roblox_id).limit(1).execute()
                return result.data[0] if result.data else None
        except Exception as e:
            logger.error(f"User lookup failed: {e}")
        return None

    # ============================================================================
    # Moderation Operations
    # ============================================================================
    async def ban_user(self, roblox_id: str, reason: str, by_user: int):
        if not self.client:
            return False
        try:
            user = await self.get_user_profile(roblox_id=roblox_id)
            username = user.get("username", "Unknown") if user else "Unknown"
            self.client.table("banned_users").upsert({
                "roblox_user_id": roblox_id,
                "username": username,
                "reason": reason
            }).execute()
            self.client.table("audit_log").insert({
                "action": "ban_user",
                "details": {"roblox_user_id": roblox_id, "username": username, "reason": reason, "by": by_user}
            }).execute()
            return True
        except Exception as e:
            logger.error(f"Ban failed: {e}")
            return False

    async def unban_user(self, roblox_id: str, by_user: int):
        if not self.client:
            return False
        try:
            self.client.table("banned_users").delete().eq("roblox_user_id", roblox_id).execute()
            self.client.table("audit_log").insert({
                "action": "unban_user",
                "details": {"roblox_user_id": roblox_id, "by": by_user}
            }).execute()
            return True
        except Exception:
            return False

    async def add_warning(self, user_id: int, guild_id: int, reason: str, moderator_id: int):
        """Add a warning to a user"""
        if not self.client:
            return None
        try:
            result = self.client.table("warnings").insert({
                "user_id": str(user_id),
                "guild_id": str(guild_id),
                "reason": reason,
                "moderator_id": str(moderator_id),
                "timestamp": datetime.utcnow().isoformat()
            }).execute()
            return result.data[0] if result.data else None
        except Exception as e:
            logger.error(f"Failed to add warning: {e}")
            return None

    async def get_warnings(self, user_id: int, guild_id: int):
        """Get all warnings for a user"""
        if not self.client:
            return []
        try:
            result = self.client.table("warnings").select("*").eq("user_id", str(user_id)).eq("guild_id", str(guild_id)).execute()
            return result.data or []
        except Exception:
            return []

    async def clear_warnings(self, user_id: int, guild_id: int):
        """Clear all warnings for a user"""
        if not self.client:
            return False
        try:
            self.client.table("warnings").delete().eq("user_id", str(user_id)).eq("guild_id", str(guild_id)).execute()
            return True
        except Exception:
            return False

    async def add_mute(self, user_id: int, guild_id: int, duration: int, reason: str, moderator_id: int):
        """Add a temporary mute"""
        if not self.client:
            return None
        try:
            expires_at = datetime.utcnow() + timedelta(seconds=duration)
            result = self.client.table("mutes").insert({
                "user_id": str(user_id),
                "guild_id": str(guild_id),
                "reason": reason,
                "moderator_id": str(moderator_id),
                "expires_at": expires_at.isoformat()
            }).execute()
            return result.data[0] if result.data else None
        except Exception as e:
            logger.error(f"Failed to add mute: {e}")
            return None

    async def remove_mute(self, user_id: int, guild_id: int):
        """Remove a mute"""
        if not self.client:
            return False
        try:
            self.client.table("mutes").delete().eq("user_id", str(user_id)).eq("guild_id", str(guild_id)).execute()
            return True
        except Exception:
            return False

    async def get_active_mutes(self, guild_id: int):
        """Get all active mutes for a guild"""
        if not self.client:
            return []
        try:
            result = self.client.table("mutes").select("*").eq("guild_id", str(guild_id)).gte("expires_at", datetime.utcnow().isoformat()).execute()
            return result.data or []
        except Exception:
            return []

    # ============================================================================
    # Economy Operations
    # ============================================================================
    async def get_balance(self, user_id: int, guild_id: int):
        """Get user's balance"""
        if not self.client:
            return 0
        try:
            result = self.client.table("economy").select("balance").eq("user_id", str(user_id)).eq("guild_id", str(guild_id)).execute()
            if result.data:
                return result.data[0].get("balance", 0)
            # Create new account
            self.client.table("economy").insert({
                "user_id": str(user_id),
                "guild_id": str(guild_id),
                "balance": 0
            }).execute()
            return 0
        except Exception:
            return 0

    async def update_balance(self, user_id: int, guild_id: int, amount: int):
        """Update user's balance"""
        if not self.client:
            return False
        try:
            current_balance = await self.get_balance(user_id, guild_id)
            new_balance = max(0, current_balance + amount)
            self.client.table("economy").update({"balance": new_balance}).eq("user_id", str(user_id)).eq("guild_id", str(guild_id)).execute()
            return True
        except Exception:
            return False

    async def claim_daily(self, user_id: int, guild_id: int):
        """Claim daily reward"""
        if not self.client:
            return None
        try:
            result = self.client.table("economy").select("last_daily").eq("user_id", str(user_id)).eq("guild_id", str(guild_id)).execute()
            if result.data:
                last_daily = result.data[0].get("last_daily")
                if last_daily:
                    last_daily_date = datetime.fromisoformat(last_daily)
                    if datetime.utcnow() - last_daily_date < timedelta(hours=24):
                        return None  # Already claimed today
            
            await self.update_balance(user_id, guild_id, config.DAILY_REWARD_AMOUNT)
            self.client.table("economy").update({"last_daily": datetime.utcnow().isoformat()}).eq("user_id", str(user_id)).eq("guild_id", str(guild_id)).execute()
            return config.DAILY_REWARD_AMOUNT
        except Exception as e:
            logger.error(f"Failed to claim daily: {e}")
            return None

    async def get_leaderboard(self, guild_id: int, limit: int = 10):
        """Get economy leaderboard"""
        if not self.client:
            return []
        try:
            result = self.client.table("economy").select("user_id,balance").eq("guild_id", str(guild_id)).order("balance", desc=True).limit(limit).execute()
            return result.data or []
        except Exception:
            return []

    # ============================================================================
    # Leveling Operations
    # ============================================================================
    async def get_level_data(self, user_id: int, guild_id: int):
        """Get user's level and XP"""
        if not self.client:
            return {"level": 1, "xp": 0, "total_xp": 0}
        try:
            result = self.client.table("levels").select("*").eq("user_id", str(user_id)).eq("guild_id", str(guild_id)).execute()
            if result.data:
                return result.data[0]
            # Create new level entry
            self.client.table("levels").insert({
                "user_id": str(user_id),
                "guild_id": str(guild_id),
                "level": 1,
                "xp": 0,
                "total_xp": 0
            }).execute()
            return {"level": 1, "xp": 0, "total_xp": 0}
        except Exception:
            return {"level": 1, "xp": 0, "total_xp": 0}

    async def add_xp(self, user_id: int, guild_id: int, xp: int):
        """Add XP to a user and handle level ups"""
        if not self.client:
            return None
        try:
            data = await self.get_level_data(user_id, guild_id)
            new_xp = data["xp"] + xp
            new_total_xp = data["total_xp"] + xp
            current_level = data["level"]
            
            # Calculate level up (100 XP per level, increases by 10% each level)
            xp_needed = int(100 * (1.1 ** (current_level - 1)))
            leveled_up = False
            
            while new_xp >= xp_needed:
                new_xp -= xp_needed
                current_level += 1
                xp_needed = int(100 * (1.1 ** (current_level - 1)))
                leveled_up = True
            
            self.client.table("levels").update({
                "level": current_level,
                "xp": new_xp,
                "total_xp": new_total_xp
            }).eq("user_id", str(user_id)).eq("guild_id", str(guild_id)).execute()
            
            return {"leveled_up": leveled_up, "new_level": current_level} if leveled_up else None
        except Exception as e:
            logger.error(f"Failed to add XP: {e}")
            return None

    async def get_level_leaderboard(self, guild_id: int, limit: int = 10):
        """Get leveling leaderboard"""
        if not self.client:
            return []
        try:
            result = self.client.table("levels").select("user_id,level,total_xp").eq("guild_id", str(guild_id)).order("total_xp", desc=True).limit(limit).execute()
            return result.data or []
        except Exception:
            return []

    # ============================================================================
    # Maintenance & Announcements
    # ============================================================================
    async def toggle_maintenance(self, game_name: str, enabled: bool, by_user: int):
        if not self.client:
            return False
        try:
            self.client.table("game_status").update({"maintenance": enabled}).like("game_name", f"%{game_name}%").execute()
            self.client.table("audit_log").insert({
                "action": "maintenance_toggle",
                "details": {"game": game_name, "enabled": enabled, "by": by_user}
            }).execute()
            return True
        except Exception:
            return False

    async def add_announcement(self, type: str, message: str):
        if not self.client:
            return False
        try:
            self.client.table("announcements").insert({"type": type, "message": message}).execute()
            return True
        except Exception:
            return False

    async def get_announcements(self, limit: int = 5):
        if not self.client:
            return []
        try:
            result = self.client.table("announcements").select("*").order("created_at", desc=True).limit(limit).execute()
            return result.data or []
        except Exception:
            return []
