import asyncio
import os
from pathlib import Path
from dotenv import load_dotenv
from browser_use import Agent, BrowserSession
from browser_use.llm.anthropic.chat import ChatAnthropic

load_dotenv(Path(__file__).parent.parent.parent / ".env")

# browser-use はChromeの user_data_dir を一時ディレクトリにコピーして動かし、
# 終了時に書き戻さないため、そのままだと毎回ログインが必要になる。
# ただしディレクトリ名に "browser-use-user-data-dir-" を含めるとコピーをスキップして
# 直接そのディレクトリを使う実装になっている（profile.py: _copy_profile）。
# これを利用してログインセッションを永続化する。
SESSION_DIR = Path.home() / ".yayoi-copilot" / "browser-use-user-data-dir-session"
SESSION_DIR.mkdir(parents=True, exist_ok=True)

YAYOI_URL = "https://myaccount.yayoi-kk.co.jp/login"


class YayoiAgent:
    def __init__(self) -> None:
        self.status: str = "IDLE"
        # エージェントの各ステップ履歴（GUIで観察するためのログ）
        self.steps: list[dict] = []
        self._pause_event = asyncio.Event()
        self._pause_event.set()

    async def _on_step(self, browser_state, model_output, n_steps) -> None:
        """browser-use が1ステップ進むたびに呼ばれる。
        Claudeが「次に何をするか（next_goal）」と「実際の操作（action）」を記録する。
        """
        actions = [a.model_dump(exclude_none=True) for a in (model_output.action or [])]
        entry = {
            "step": n_steps,
            "goal": model_output.next_goal or "",
            "actions": actions,
        }
        self.steps.append(entry)
        print(f"[step {n_steps}] {entry['goal']} -> {actions}")

    def pause(self) -> None:
        self._pause_event.clear()
        self.status = "PAUSED"

    def resume(self) -> None:
        self._pause_event.set()
        self.status = "RUNNING"

    async def run(self, prompt: str) -> None:
        self.status = "RUNNING"
        self.steps = []
        session = BrowserSession(
            user_data_dir=SESSION_DIR,
            headless=False,
            channel="chrome",
            # Akamai BotManager対策: 自動化フラグを隠す
            args=["--disable-blink-features=AutomationControlled"],
        )
        try:
            await session.start()
            await session._cdp_add_init_script(
                "Object.defineProperty(navigator, 'webdriver', {get: () => undefined})"
            )

            page = await session.must_get_current_page()
            current_url = await page.get_url()
            if YAYOI_URL not in current_url:
                await page.goto(YAYOI_URL)

            await self._wait_for_manual_login(page)

            llm = ChatAnthropic(
                model="claude-sonnet-4-6",
                api_key=os.getenv("ANTHROPIC_API_KEY"),
            )
            browser_agent = Agent(
                task=prompt,
                llm=llm,
                browser=session,
                register_new_step_callback=self._on_step,
            )
            await browser_agent.run()
            self.status = "IDLE"
        except Exception as e:
            print(f"[error] エージェント実行中にエラー: {e}")
            self.status = "ERROR"
        finally:
            await session.stop()

    async def _wait_for_manual_login(self, page) -> None:
        """初回はユーザーが手動ログイン（MFA含む）。完了後 /api/resume で再開する。
        セッションは user_data_dir に永続化されるため2回目以降は自動的にスキップされる。
        """
        await asyncio.sleep(2)
        current_url = await page.get_url()
        if "login" not in current_url:
            return  # セッション有効 → ログイン済み

        # ログイン画面が表示されている → 手動ログインを待つ
        print("[login] ログイン画面を検出。ブラウザで手動ログイン後 /api/resume を呼んでください。")
        self.pause()
        await self._pause_event.wait()
