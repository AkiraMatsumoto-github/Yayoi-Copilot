const API_BASE = "http://localhost:8000";

const statusBadge  = document.getElementById("status-badge")!;
const promptInput  = document.getElementById("prompt-input") as HTMLTextAreaElement;
const btnExecute   = document.getElementById("btn-execute")!;
const btnPause     = document.getElementById("btn-pause")!;
const btnResume    = document.getElementById("btn-resume")!;

type AgentStatus = "IDLE" | "RUNNING" | "PAUSED";

function updateStatusUI(status: AgentStatus): void {
  statusBadge.className = "";
  if (status === "RUNNING") {
    statusBadge.textContent = "AI操作中 (RUNNING)";
    statusBadge.classList.add("running");
    btnResume.style.display = "none";
  } else if (status === "PAUSED") {
    statusBadge.textContent = "手動介入受付中 (PAUSED)";
    statusBadge.classList.add("paused");
    btnResume.style.display = "block";
  } else {
    statusBadge.textContent = "待機中 (IDLE)";
    btnResume.style.display = "none";
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

btnExecute.addEventListener("click", async () => {
  const prompt = promptInput.value.trim();
  if (!prompt) return;
  await fetch(`${API_BASE}/api/execute`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });
  promptInput.value = "";
  updateStatusUI("RUNNING");
});

btnPause.addEventListener("click", async () => {
  await fetch(`${API_BASE}/api/pause`, { method: "POST" });
  updateStatusUI("PAUSED");
});

btnResume.addEventListener("click", async () => {
  await fetch(`${API_BASE}/api/resume`, { method: "POST" });
  updateStatusUI("RUNNING");
});

setInterval(pollStatus, 2000);
pollStatus();
