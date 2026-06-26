import asyncio
import os
from pathlib import Path
from dotenv import load_dotenv
from playwright.async_api import async_playwright, BrowserContext
from langchain_openai import ChatOpenAI
from browser_use import Agent

load_dotenv(Path(__file__).parent.parent.parent / ".env")

SESSION_DIR = Path.home() / ".yayoi-copilot" / "session"
SESSION_DIR.mkdir(parents=True, exist_ok=True)

YAYOI_URL = "https://app.yayoi-kk.co.jp/"


class YayoiAgent:
    def __init__(self) -> None:
        self.status: str = "IDLE"
        self._pause_event = asyncio.Event()
        self._pause_event.set()  # 初期状態は実行可能

    def pause(self) -> None:
        self._pause_event.clear()
        self.status = "PAUSED"

    def resume(self) -> None:
        self._pause_event.set()
        self.status = "RUNNING"

    async def run(self, prompt: str) -> None:
        self.status = "RUNNING"
        try:
            async with async_playwright() as pw:
                context: BrowserContext = await pw.chromium.launch_persistent_context(
                    user_data_dir=str(SESSION_DIR),
                    headless=False,
                )
                page = context.pages[0] if context.pages else await context.new_page()

                if YAYOI_URL not in page.url:
                    await page.goto(YAYOI_URL)

                await self._handle_login_if_needed(page)

                llm = ChatOpenAI(model="gpt-4o", api_key=os.getenv("OPENAI_API_KEY"))
                browser_agent = Agent(task=prompt, llm=llm, browser=context)

                await browser_agent.run()

                await context.close()
        finally:
            self.status = "IDLE"

    async def _handle_login_if_needed(self, page) -> None:
        """ログインフォームが表示されていれば自動ログインを試みる。MFA発生時はPAUSEDへ移行。"""
        try:
            email_input = await page.wait_for_selector("input[type='email']", timeout=3000)
            if email_input:
                await email_input.fill(os.getenv("YAYOI_EMAIL", ""))
                password_input = await page.wait_for_selector("input[type='password']")
                await password_input.fill(os.getenv("YAYOI_PASSWORD", ""))
                await page.keyboard.press("Enter")

                # MFA検知: ログイン後に再度認証画面が現れた場合
                try:
                    await page.wait_for_selector("input[type='email']", timeout=5000)
                    # まだ認証画面 → MFA発生とみなし手動介入モードへ
                    self.pause()
                    await self._pause_event.wait()
                except Exception:
                    pass  # ログイン成功
        except Exception:
            pass  # ログイン不要（セッション有効）
