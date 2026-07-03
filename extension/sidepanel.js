const taskEl = document.getElementById("task");
const runBtn = document.getElementById("run");
const statusEl = document.getElementById("status");
const messagesEl = document.getElementById("messages");
const screenEl = document.getElementById("screen");
const refreshBtn = document.getElementById("refresh");
const openBtn = document.getElementById("open");
const micBtn = document.getElementById("mic");

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

// ── 音声入力（Chrome内蔵 Web Speech API, 日本語） ──
// マイクボタンで録音→テキスト化して入力欄に差し込む。確定分は保持し、
// 認識中の暫定テキストは末尾にプレビュー表示する。
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recog = null;
let listening = false;
let micBase = ""; // 録音開始時点の入力欄内容（ここに認識結果を足す）

if (!SpeechRecognition) {
  // 非対応環境ではボタンを無効化（Chrome以外など）
  micBtn.disabled = true;
  micBtn.title = "この環境では音声入力に対応していません";
} else {
  micBtn.addEventListener("click", async () => {
    if (listening) {
      recog && recog.stop();
      return;
    }
    // webkitSpeechRecognition は「許可済み」でないと即 not-allowed を返すため、
    // 先に getUserMedia で許可プロンプトを出してから認識を開始する。
    const ok = await ensureMicPermission();
    if (ok) startRecog();
  });
}

// マイク許可を確保する。
// サイドパネル（chrome-extension:// ）では getUserMedia の許可プロンプトが出せないため、
// 許可済みかどうかを permissions API で確認し、未許可なら専用タブで許可を取ってもらう。
async function ensureMicPermission() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) return true;

  // まず許可状態を確認（granted なら getUserMedia は無音で成功する）。
  let state = "prompt";
  try {
    const p = await navigator.permissions.query({ name: "microphone" });
    state = p.state;
  } catch (_) {
    // permissions 未対応時は getUserMedia を直接試す。
  }

  if (state !== "denied") {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((t) => t.stop());
      return true;
    } catch (_) {
      // 未許可でプロンプトも出せない → 下の専用タブ導線へ。
    }
  }

  // 未許可：専用の許可ページをタブで開く（ここならプロンプトが出せる）。
  micBtn.classList.remove("listening");
  chrome.tabs.create({ url: chrome.runtime.getURL("permission.html") });
  addAssistant(
    "音声入力にはマイクの許可が必要です。\n" +
      "開いたタブで「マイクを許可する」を押して許可したあと、こちらに戻ってもう一度マイクボタンを押してください。",
    "stopped"
  );
  return false;
}

function startRecog() {
  recog = new SpeechRecognition();
  recog.lang = "ja-JP";
  recog.interimResults = true;
  recog.continuous = true;

  recog.onstart = () => {
    listening = true;
    micBase = taskEl.value ? taskEl.value.replace(/\s*$/, "") + " " : "";
    micBtn.classList.add("listening");
    micBtn.title = "停止";
  };
  recog.onresult = (e) => {
    let finalText = "";
    let interim = "";
    for (let i = 0; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) finalText += t;
      else interim += t;
    }
    taskEl.value = micBase + finalText + interim;
  };
  recog.onerror = (e) => {
    listening = false;
    micBtn.classList.remove("listening");
    micBtn.title = "音声入力（マイク）";
    if (e.error === "not-allowed" || e.error === "service-not-allowed") {
      addAssistant("マイクの使用が許可されていません。ブラウザのマイク許可を有効にしてください。", "error");
    } else if (e.error === "no-speech") {
      // 無音で終了しただけ。通知不要。
    } else if (e.error !== "aborted") {
      addAssistant("音声入力でエラーが発生しました（" + e.error + "）。", "error");
    }
  };
  recog.onend = () => {
    listening = false;
    micBtn.classList.remove("listening");
    micBtn.title = "音声入力（マイク）";
    taskEl.focus();
  };

  try {
    recog.start();
  } catch (_) {
    // start 連打などのInvalidStateErrorは無視
  }
}

// 現画面表示
function setScreen(id, name, url, title) {
  // 未定義の画面はタイトル（無ければURL）を出す。MPAなのでこれで十分識別できる。
  if (id === "unknown") {
    screenEl.textContent = title || url || "不明";
    screenEl.title = url || "";
  } else {
    screenEl.textContent = name;
    screenEl.title = "";
  }
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

// 確認ゲート（更新/削除/新規登録の実行前）。承認/キャンセルをbackgroundへ返す。
function showConfirm(id, title, lines) {
  const card = el("div", "confirm");
  const h = el("div", "confirm-title");
  h.textContent = "⚠ " + (title || "この操作を実行しますか？");
  card.appendChild(h);
  if (lines && lines.length) {
    const ul = el("ul", "confirm-lines");
    for (const line of lines) {
      const li = document.createElement("li");
      li.textContent = line;
      ul.appendChild(li);
    }
    card.appendChild(ul);
  }
  const row = el("div", "confirm-row");
  const okBtn = el("button", "confirm-ok");
  okBtn.textContent = "実行する";
  const noBtn = el("button", "confirm-no");
  noBtn.textContent = "キャンセル";
  const answer = (ok) => {
    okBtn.disabled = noBtn.disabled = true;
    card.classList.add(ok ? "confirmed" : "cancelled");
    h.textContent = (ok ? "✓ 承認: " : "✕ キャンセル: ") + (title || "");
    chrome.runtime.sendMessage({ type: "confirmResult", id, ok });
  };
  okBtn.addEventListener("click", () => answer(true));
  noBtn.addEventListener("click", () => answer(false));
  row.appendChild(okBtn);
  row.appendChild(noBtn);
  card.appendChild(row);
  messagesEl.appendChild(card);
  scrollBottom();
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "screen") {
    setScreen(msg.id, msg.name, msg.url, msg.title);
  } else if (msg.type === "confirm") {
    showConfirm(msg.id, msg.title, msg.lines);
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
