"""
Economy system for VHX Bot
Includes currency, daily rewards, gambling, shop, and leaderboards
"""
import discord
import random
import logging
from typing import Optional, Dict, List
import config

logger = logging.getLogger(__name__)

class EconomySystem:
    def __init__(self, db):
        self.db = db
        
        # Shop items
        self.shop_items = {
            "role_color": {
                "name": "Custom Role Color",
                "price": 1000,
                "description": "Get a custom colored role",
                "emoji": "🎨"
            },
            "profile_badge": {
                "name": "Profile Badge",
                "price": 500,
                "description": "Unlock a special badge on your profile",
                "emoji": "🏅"
            },
            "xp_boost": {
                "name": "XP Boost (24h)",
                "price": 750,
                "description": "2x XP for 24 hours",
                "emoji": "⚡"
            },
            "name_change": {
                "name": "Nickname Change",
                "price": 200,
                "description": "Change your server nickname",
                "emoji": "✏️"
            }
        }

    async def get_balance(self, user_id: int, guild_id: int) -> int:
        """Get user's balance"""
        return await self.db.get_balance(user_id, guild_id)

    async def add_balance(self, user_id: int, guild_id: int, amount: int) -> bool:
        """Add to user's balance"""
        return await self.db.update_balance(user_id, guild_id, amount)

    async def remove_balance(self, user_id: int, guild_id: int, amount: int) -> bool:
        """Remove from user's balance"""
        current = await self.get_balance(user_id, guild_id)
        if current < amount:
            return False
        return await self.db.update_balance(user_id, guild_id, -amount)

    async def claim_daily(self, user_id: int, guild_id: int) -> Optional[int]:
        """Claim daily reward"""
        return await self.db.claim_daily(user_id, guild_id)

    async def play_slots(self, user_id: int, guild_id: int, bet: int) -> Dict:
        """Play slot machine"""
        balance = await self.get_balance(user_id, guild_id)
        if balance < bet:
            return {"success": False, "message": "Insufficient balance"}
        
        # Deduct bet
        await self.remove_balance(user_id, guild_id, bet)
        
        # Slot symbols
        symbols = ["🍒", "🍋", "🍊", "🍇", "💎", "7️⃣"]
        weights = [30, 25, 20, 15, 8, 2]  # Weighted probabilities
        
        # Roll slots
        result = random.choices(symbols, weights=weights, k=3)
        
        # Calculate winnings
        winnings = 0
        if result[0] == result[1] == result[2]:
            # Three of a kind
            if result[0] == "7️⃣":
                winnings = bet * 10  # Jackpot!
            elif result[0] == "💎":
                winnings = bet * 5
            else:
                winnings = bet * 3
        elif result[0] == result[1] or result[1] == result[2] or result[0] == result[2]:
            # Two of a kind
            winnings = bet * 2
        
        # Add winnings
        if winnings > 0:
            await self.add_balance(user_id, guild_id, winnings)
        
        return {
            "success": True,
            "result": result,
            "bet": bet,
            "winnings": winnings,
            "profit": winnings - bet
        }

    async def play_coinflip(self, user_id: int, guild_id: int, bet: int, choice: str) -> Dict:
        """Play coinflip (heads or tails)"""
        balance = await self.get_balance(user_id, guild_id)
        if balance < bet:
            return {"success": False, "message": "Insufficient balance"}
        
        if choice.lower() not in ["heads", "tails"]:
            return {"success": False, "message": "Invalid choice. Use 'heads' or 'tails'"}
        
        # Deduct bet
        await self.remove_balance(user_id, guild_id, bet)
        
        # Flip coin
        result = random.choice(["heads", "tails"])
        
        # Calculate winnings
        if result == choice.lower():
            winnings = bet * 2
            await self.add_balance(user_id, guild_id, winnings)
            return {
                "success": True,
                "won": True,
                "result": result,
                "bet": bet,
                "winnings": winnings,
                "profit": bet
            }
        else:
            return {
                "success": True,
                "won": False,
                "result": result,
                "bet": bet,
                "winnings": 0,
                "profit": -bet
            }

    async def play_dice(self, user_id: int, guild_id: int, bet: int, guess: int) -> Dict:
        """Play dice game (guess the number 1-6)"""
        balance = await self.get_balance(user_id, guild_id)
        if balance < bet:
            return {"success": False, "message": "Insufficient balance"}
        
        if guess not in range(1, 7):
            return {"success": False, "message": "Invalid guess. Use 1-6"}
        
        # Deduct bet
        await self.remove_balance(user_id, guild_id, bet)
        
        # Roll dice
        result = random.randint(1, 6)
        
        # Calculate winnings
        if result == guess:
            winnings = bet * 6
            await self.add_balance(user_id, guild_id, winnings)
            return {
                "success": True,
                "won": True,
                "result": result,
                "guess": guess,
                "bet": bet,
                "winnings": winnings,
                "profit": winnings - bet
            }
        else:
            return {
                "success": True,
                "won": False,
                "result": result,
                "guess": guess,
                "bet": bet,
                "winnings": 0,
                "profit": -bet
            }

    async def get_leaderboard(self, guild_id: int, limit: int = 10) -> List[Dict]:
        """Get economy leaderboard"""
        return await self.db.get_leaderboard(guild_id, limit)

    async def buy_item(self, user_id: int, guild_id: int, item_id: str) -> Dict:
        """Buy an item from the shop"""
        if item_id not in self.shop_items:
            return {"success": False, "message": "Item not found"}
        
        item = self.shop_items[item_id]
        balance = await self.get_balance(user_id, guild_id)
        
        if balance < item["price"]:
            return {"success": False, "message": "Insufficient balance"}
        
        # Deduct price
        success = await self.remove_balance(user_id, guild_id, item["price"])
        if success:
            return {
                "success": True,
                "item": item,
                "item_id": item_id
            }
        else:
            return {"success": False, "message": "Transaction failed"}

    def get_shop_embed(self) -> discord.Embed:
        """Get shop embed"""
        embed = discord.Embed(
            title=f"🛒 Shop",
            description=f"Use `/buy <item_id>` to purchase",
            color=config.EMBED_COLOR
        )
        
        for item_id, item in self.shop_items.items():
            embed.add_field(
                name=f"{item['emoji']} {item['name']}",
                value=f"{item['description']}\n**Price:** {config.CURRENCY_SYMBOL}{item['price']}\n**ID:** `{item_id}`",
                inline=False
            )
        
        return embed
