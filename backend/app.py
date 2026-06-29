"""弥生会計コパイロット — バックエンド（Chrome拡張用の軽量プロキシ）。

役割は2つだけ:
1. ANTHROPIC_API_KEY を保持し、Claude への問い合わせを代行する（鍵を拡張に渡さない）。
2. 拡張が抽出した画面状態を受け取り、次の操作を1つ返す（/api/agent/next）。

ブラウザ操作そのものは Chrome 拡張（chrome.debugger / chrome.scripting）が行う。
"""

import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from agent.ext_brain import next_action

app = FastAPI(title="Yayoi Copilot Backend")

# Chrome拡張（chrome-extension:// オリジン）からの fetch を許可する。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class PageState(BaseModel):
    url: str = ""
    title: str = ""
    text: str = ""
    elements: list[dict] = []


class NextActionRequest(BaseModel):
    task: str
    page: PageState
    history: list[dict] = []


@app.get("/api/health")
async def health():
    return {"ok": True}


@app.post("/api/agent/next")
async def agent_next(req: NextActionRequest):
    """拡張が抽出した画面状態＋タスク＋履歴を受け取り、Claudeに次の1手を決めさせる。"""
    action = await asyncio.to_thread(
        next_action, req.task, req.page.model_dump(), req.history
    )
    return {"action": action}
