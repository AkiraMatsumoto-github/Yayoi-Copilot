const taskEl = document.getElementById("task");
const runBtn = document.getElementById("run");
const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");

function log(msg) {
  const line = document.createElement("div");
  line.className = "line";
  const time = new Date().toLocaleTimeString("ja-JP");
  line.innerHTML = `<span class="t">${time}</span>${msg}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = cls || "";
}

runBtn.addEventListener("click", () => {
  const task = taskEl.value.trim();
  if (!task) return;
  runBtn.disabled = true;
  setStatus("実行中…", "running");
  log(`▶ 実行: ${task}`);
  chrome.runtime.sendMessage({ type: "run", task });
});

// background からの進捗・結果を受け取って表示する
chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "log") {
    log(msg.text);
  } else if (msg.type === "done") {
    setStatus("完了", "");
    runBtn.disabled = false;
    if (msg.result) log(`✅ ${msg.result}`);
  } else if (msg.type === "error") {
    setStatus("エラー", "error");
    runBtn.disabled = false;
    log(`❌ ${msg.text}`);
  }
});
