const taskEl = document.getElementById("task");
const runBtn = document.getElementById("run");
const statusEl = document.getElementById("status");
const messagesEl = document.getElementById("messages");
const screenEl = document.getElementById("screen");
const refreshBtn = document.getElementById("refresh");
const openBtn = document.getElementById("open");

let running = false;
let stepsBlock = null; // 現在の実行の <details>
let stepsBody = null; // その本体
let stepCount = 0;

function el(tag, cls) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  return e;
}

function scrollBottom() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setStatus(text, cls) {
  statusEl.textContent = text;
  statusEl.className = cls || "";
}

function setRunning(on) {
  running = on;
  runBtn.textContent = on ? "■ 中断" : "実行";
  runBtn.classList.toggle("stop", on);
}

// 会話バブル
function addUser(text) {
  const m = el("div", "msg user");
  m.textContent = text;
  messagesEl.appendChild(m);
  scrollBottom();
}

function addAssistant(text, kind) {
  const m = el("div", "msg assistant " + (kind || ""));
  m.textContent = text;
  messagesEl.appendChild(m);
  scrollBottom();
}

// 実行ログ（折りたたみ）
function newSteps() {
  stepCount = 0;
  stepsBlock = el("details", "steps");
  stepsBlock.open = true;
  const summary = el("summary");
  summary.textContent = "実行ログ";
  stepsBlock.appendChild(summary);
  stepsBody = el("div", "steps-body");
  stepsBlock.appendChild(stepsBody);
  messagesEl.appendChild(stepsBlock);
  scrollBottom();
}

function addStep(text) {
  if (!stepsBody) newSteps();
  stepCount++;
  const line = el("div", "step");
  const t = el("span", "t");
  t.textContent = new Date().toLocaleTimeString("ja-JP");
  line.appendChild(t);
  line.insertAdjacentHTML("beforeend", text);
  stepsBody.appendChild(line);
  stepsBlock.querySelector("summary").textContent = `実行ログ (${stepCount})`;
  scrollBottom();
}

// 実行完了時、ログは畳んで報告を目立たせる
function finishSteps() {
  if (stepsBlock) stepsBlock.open = false;
  stepsBlock = null;
  stepsBody = null;
}

function start() {
  const task = taskEl.value.trim();
  if (!task) return;
  addUser(task);
  taskEl.value = ""; // 入力欄をクリア
  newSteps();
  setRunning(true);
  setStatus("実行中…", "running");
  chrome.runtime.sendMessage({ type: "run", task });
}

function stop() {
  setStatus("中断中…", "running");
  chrome.runtime.sendMessage({ type: "stop" });
}

runBtn.addEventListener("click", () => {
  if (running) stop();
  else start();
});

// Enter で実行 / Shift+Enter で改行。実行中の Enter は中断。
taskEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    if (running) stop();
    else start();
  }
});

taskEl.focus();

// 現在地表示
function setScreen(id, name, url) {
  // 不明なときは実URLも見せる（画面定義を増やす手がかりにする）
  screenEl.textContent = id === "unknown" && url ? `${name}（${url}）` : name;
  screenEl.className = id === "unknown" ? "unknown" : id === "off" ? "off" : "";
}
function requestScreen() {
  screenEl.textContent = "確認中…";
  screenEl.className = "off";
  chrome.runtime.sendMessage({ type: "whereami" });
}
refreshBtn.addEventListener("click", requestScreen);
openBtn.addEventListener("click", () => chrome.runtime.sendMessage({ type: "open" }));
requestScreen(); // パネル表示時に1回判定

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "screen") {
    setScreen(msg.id, msg.name, msg.url);
  } else if (msg.type === "log") {
    addStep(msg.text);
  } else if (msg.type === "done") {
    finishSteps();
    addAssistant(msg.result || "完了しました。", "done");
    setRunning(false);
    setStatus("待機中", "");
  } else if (msg.type === "stopped") {
    finishSteps();
    addAssistant(msg.result || "中断しました。", "stopped");
    setRunning(false);
    setStatus("待機中", "");
  } else if (msg.type === "error") {
    finishSteps();
    addAssistant("エラー: " + msg.text, "error");
    setRunning(false);
    setStatus("エラー", "error");
  }
});
