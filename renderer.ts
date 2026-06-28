const API_BASE = "http://localhost:8000";

const statusBadge  = document.getElementById("status-badge")!;
const promptInput  = document.getElementById("prompt-input") as HTMLTextAreaElement;
const btnExecute   = document.getElementById("btn-execute") as HTMLButtonElement;
const btnPause     = document.getElementById("btn-pause") as HTMLButtonElement;
const btnResume    = document.getElementById("btn-resume") as HTMLButtonElement;
const logArea      = document.getElementById("log-area")!;

type AgentStatus = "IDLE" | "RUNNING" | "PAUSED" | "ERROR";

let lastStatus: AgentStatus | null = null;

function log(message: string): void {
  const line = document.createElement("div");
  line.className = "log-line";
  const time = new Date().toLocaleTimeString("ja-JP");
  line.innerHTML = `<span class="log-time">${time}</span>${message}`;
  logArea.appendChild(line);
  logArea.scrollTop = logArea.scrollHeight;
}

function updateStatusUI(status: AgentStatus): void {
  statusBadge.className = "";
  if (status === "RUNNING") {
    statusBadge.textContent = "AI操作中 (RUNNING)";
    statusBadge.classList.add("running");
    btnResume.style.display = "none";
    btnPause.disabled = false;
    btnExecute.disabled = true;
  } else if (status === "PAUSED") {
    statusBadge.textContent = "手動介入受付中 (PAUSED)";
    statusBadge.classList.add("paused");
    btnResume.style.display = "block";
    btnPause.disabled = true;
    btnExecute.disabled = true;
  } else if (status === "ERROR") {
    statusBadge.textContent = "エラー (ERROR)";
    statusBadge.classList.add("error");
    btnResume.style.display = "none";
    btnPause.disabled = true;
    btnExecute.disabled = false;
  } else {
    statusBadge.textContent = "待機中 (IDLE)";
    btnResume.style.display = "none";
    btnPause.disabled = true;
    btnExecute.disabled = false;
  }

  if (status !== lastStatus) {
    if (status === "PAUSED") {
      log("⏸ 一時停止中。手動ログイン等の対応後「再開」を押してください。");
    } else if (status === "IDLE" && lastStatus === "RUNNING") {
      log("✅ タスク完了。");
    } else if (status === "ERROR") {
      log("❌ エラーが発生しました。");
    }
    lastStatus = status;
  }
}

async function pollStatus(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/api/status`);
    const data = await res.json();
    updateStatusUI(data.status as AgentStatus);
  } catch {
    // バックエンド未起動時は無視
  }
}

interface AgentStep {
  step: number;
  goal: string;
  actions: Record<string, unknown>[];
}

let renderedSteps = 0;

async function pollLog(): Promise<void> {
  try {
    const res = await fetch(`${API_BASE}/api/log`);
    const data = await res.json();
    const steps: AgentStep[] = data.steps ?? [];
    // すでに表示済みのステップ数を超えた分だけ追記する
    for (let i = renderedSteps; i < steps.length; i++) {
      const s = steps[i];
      const actions = s.actions
        .map((a) => Object.keys(a)[0])
        .join(", ");
      log(`🤖 [${s.step}] ${s.goal}<br><span class="log-time">　操作: ${actions || "—"}</span>`);
    }
    if (steps.length < renderedSteps) {
      // 新しいタスクが始まりログがリセットされた
      renderedSteps = 0;
    } else {
      renderedSteps = steps.length;
    }
  } catch {
    // 無視
  }
}

btnExecute.addEventListener("click", async () => {
  const prompt = promptInput.value.trim();
  if (!prompt) return;
  log(`▶ 実行: ${prompt}`);
  try {
    await fetch(`${API_BASE}/api/execute`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });
    promptInput.value = "";
    updateStatusUI("RUNNING");
  } catch {
    log("⚠ バックエンドに接続できません。");
  }
});

btnPause.addEventListener("click", async () => {
  await fetch(`${API_BASE}/api/pause`, { method: "POST" });
  updateStatusUI("PAUSED");
});

btnResume.addEventListener("click", async () => {
  log("▶ 再開しました。");
  await fetch(`${API_BASE}/api/resume`, { method: "POST" });
  updateStatusUI("RUNNING");
});

setInterval(pollStatus, 2000);
setInterval(pollLog, 2000);
pollStatus();
log("起動しました。バックエンドの準備を待っています…");
