import asyncio
from fastapi import FastAPI, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from agent.core import YayoiAgent

app = FastAPI()

# Electron レンダラ（file:// オリジン）からの fetch を許可する。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

agent = YayoiAgent()


class ExecuteRequest(BaseModel):
    prompt: str


@app.post("/api/execute")
async def execute(req: ExecuteRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(agent.run, req.prompt)
    return {"ok": True}


@app.post("/api/pause")
async def pause():
    agent.pause()
    return {"ok": True}


@app.post("/api/resume")
async def resume():
    agent.resume()
    return {"ok": True}


@app.get("/api/status")
async def status():
    return {"status": agent.status}


@app.get("/api/log")
async def log():
    """エージェントの各ステップ（次の目標＋実行した操作）を返す。GUIで観察用。"""
    return {"steps": agent.steps}
