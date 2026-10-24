#!/usr/bin/env python3
"""Discord bot to update market data on demand, from the user's Mac (residential IP).

Commands (type in any channel the bot can see):
  !update   -> run build_data.py, git commit & push; reply with result
  !status   -> show current data last date and Pages URL
  !ping     -> health check

Token is read from env DISCORD_BOT_TOKEN, or file ~/.strategy_sim_bot_token.
Optional: set ALLOWED_USER_ID env to restrict who can trigger updates.
"""
import os, subprocess, json, pathlib, asyncio
import discord
from discord.ext import commands

REPO = pathlib.Path(__file__).resolve().parent
PAGES_URL = "https://daigoaoki.github.io/strategy-sim/"

def read_token():
    t = os.environ.get("DISCORD_BOT_TOKEN")
    if t:
        return t.strip()
    f = pathlib.Path.home() / ".strategy_sim_bot_token"
    if f.exists():
        return f.read_text().strip()
    raise SystemExit("トークンが見つかりません(DISCORD_BOT_TOKEN か ~/.strategy_sim_bot_token)")

ALLOWED = os.environ.get("ALLOWED_USER_ID")  # optional str of user id

def run(cmd):
    p = subprocess.run(cmd, cwd=REPO, capture_output=True, text=True, timeout=300)
    return p.returncode, (p.stdout or "") + (p.stderr or "")

def data_last_date():
    try:
        txt = (REPO / "data.js").read_text()
        txt = txt[txt.index("{"): txt.rindex("}") + 1]
        return json.loads(txt).get("updated", "?")
    except Exception:
        return "?"

intents = discord.Intents.default()
intents.message_content = True
bot = commands.Bot(command_prefix="!", intents=intents, help_command=None)

@bot.event
async def on_ready():
    print(f"logged in as {bot.user} | repo={REPO}")

def allowed(ctx):
    return ALLOWED is None or str(ctx.author.id) == str(ALLOWED)

@bot.command()
async def ping(ctx):
    await ctx.reply(f"🟢 稼働中。データ最終日: **{data_last_date()}**")

@bot.command()
async def status(ctx):
    await ctx.reply(f"データ最終日: **{data_last_date()}**\n{PAGES_URL}")

@bot.command()
async def update(ctx):
    if not allowed(ctx):
        await ctx.reply("⛔ このBotはオーナーのみUpdate可能です。")
        return
    before = data_last_date()
    msg = await ctx.reply("⏳ データ取得中…(build_data.py)")

    def work():
        rc1, out1 = run(["python3", "build_data.py"])
        if rc1 != 0:
            return False, f"build失敗:\n```\n{out1[-1500:]}\n```"
        # commit only if data.js changed
        rc_diff, _ = run(["git", "diff", "--quiet", "data.js"])
        if rc_diff == 0:
            return True, f"データに変更なし(最終日 {data_last_date()})。"
        run(["git", "add", "data.js"])
        rc2, out2 = run(["git", "-c", "commit.gpgsign=false", "commit", "-m",
                         f"chore: update market data ({data_last_date()})"])
        rc3, out3 = run(["git", "push"])
        if rc3 != 0:
            return False, f"push失敗:\n```\n{out3[-1500:]}\n```"
        return True, None

    ok, info = await asyncio.to_thread(work)
    after = data_last_date()
    if not ok:
        await msg.edit(content=f"⚠️ 更新失敗。\n{info}")
    elif info and "変更なし" in info:
        await msg.edit(content=f"✅ 実行完了。{info}\n{PAGES_URL}")
    else:
        await msg.edit(content=(f"✅ 更新&push完了！ {before} → **{after}**\n"
                                f"数十秒でPagesに反映されます。\n{PAGES_URL}"))

@bot.command()
async def help(ctx):
    await ctx.reply("**コマンド**\n"
                    "`!update` データを今日まで取得してGitHub Pagesへ反映\n"
                    "`!status` 現在のデータ最終日とURL\n"
                    "`!ping` 稼働確認")

if __name__ == "__main__":
    bot.run(read_token())
