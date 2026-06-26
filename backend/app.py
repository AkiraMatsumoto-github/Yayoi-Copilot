import asyncio
from fastapi import FastAPI, BackgroundTasks
from pydantic import BaseModel
from agent.core import YayoiAgent

app = FastAPI()
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
