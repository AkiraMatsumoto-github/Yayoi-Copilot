// 弥生会計コパイロット (PoC) — バックグラウンド（サービスワーカー）
// エージェントループ本体。chrome.scripting で画面のDOMを抽出し、
// バックエンド(Claude)に次の操作を問い合わせ、chrome.debugger で
// 「本物の（trusted）」クリック・入力を実行する。

const BACKEND = "http://localhost:8000/api/agent/next";
const MAX_STEPS = 15;
const SETTLE_MS = 1500; // 画面遷移の待ち時間

// ツールバーアイコンのクリックでサイドパネルを開く
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "run") {
    runAgent(msg.task).catch((e) => send({ type: "error", text: String(e) }));
  }
});

function send(payload) {
  // サイドパネルが閉じていると receiving end が無くエラーになるため握りつぶす
  chrome.runtime.sendMessage(payload).catch(() => {});
}
const sendLog = (text) => send({ type: "log", text });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runAgent(task) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.includes("yayoi-kk.co.jp")) {
    send({ type: "error", text: "弥生会計のタブをアクティブにしてから実行してください。" });
    return;
  }
  const tabId = tab.id;

  await chrome.debugger.attach({ tabId }, "1.3");
  const history = [];
  try {
    for (let step = 1; step <= MAX_STEPS; step++) {
      const page = await extract(tabId);
      sendLog(`[${step}] ${page.title || "(無題)"} / 要素 ${page.elements.length} 個`);

      const res = await fetch(BACKEND, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task, page, history }),
      });
      if (!res.ok) throw new Error(`バックエンド応答エラー: ${res.status}`);
      const { action } = await res.json();

      const detail =
        (action.index != null ? ` #${action.index}` : "") +
        (action.text ? ` "${action.text}"` : "");
      sendLog(`🤖 [${step}] ${action.thought || ""}<br>　→ ${action.action}${detail}`);

      if (action.action === "done") {
        send({ type: "done", result: action.result || "完了しました。" });
        return;
      }

      await execute(tabId, action);
      history.push({ action: action.action, index: action.index, text: action.text });
      await sleep(SETTLE_MS);
    }
    send({ type: "done", result: "最大ステップ数に達しました。" });
  } finally {
    try {
      await chrome.debugger.detach({ tabId });
    } catch (e) {
      /* noop */
    }
  }
}

async function extract(tabId) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: extractPage,
  });
  return result || { url: "", title: "", text: "", elements: [] };
}

async function execute(tabId, action) {
  if (action.action === "scroll") {
    await chrome.scripting.executeScript({
      target: { tabId },
      func: () => window.scrollBy(0, Math.floor(window.innerHeight * 0.8)),
    });
    return;
  }

  // click / input は対象要素の画面座標が必要
  const [{ result: pos }] = await chrome.scripting.executeScript({
    target: { tabId },
    func: focusAndRect,
    args: [action.index],
  });
  if (!pos) {
    sendLog(`⚠ 要素 #${action.index} が見つかりませんでした`);
    return;
  }

  await mouseClick(tabId, pos.x, pos.y);

  if (action.action === "input") {
    await sleep(200);
    // 既存値をクリア（Ctrl+A → Delete）してから trusted な文字入力
    await keyCombo(tabId, "a", true);
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
      type: "rawKeyDown",
      key: "Delete",
      windowsVirtualKeyCode: 46,
    });
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key: "Delete",
      windowsVirtualKeyCode: 46,
    });
    await chrome.debugger.sendCommand({ tabId }, "Input.insertText", {
      text: action.text || "",
    });
  }
}

async function mouseClick(tabId, x, y) {
  const base = { x, y, button: "left", clickCount: 1 };
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y,
  });
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    ...base,
  });
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    ...base,
  });
}

async function keyCombo(tabId, key, ctrl) {
  const mods = ctrl ? 2 : 0; // 2 = Ctrl
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
    type: "rawKeyDown",
    key,
    modifiers: mods,
  });
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
    type: "keyUp",
    key,
    modifiers: mods,
  });
}

// ───────── ページ内で実行される注入関数（self-contained） ─────────

function extractPage() {
  const SEL =
    'a, button, input, select, textarea, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [onclick]';
  const els = Array.from(document.querySelectorAll(SEL));
  const out = [];
  let idx = 0;
  for (const el of els) {
    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (style.visibility === "hidden" || style.display === "none" || style.opacity === "0")
      continue;
    el.setAttribute("data-yayoi-idx", String(idx));
    const text = (
      el.innerText ||
      el.getAttribute("aria-label") ||
      el.value ||
      el.placeholder ||
      ""
    ).trim();
    out.push({
      index: idx,
      tag: el.tagName.toLowerCase(),
      type: el.getAttribute("type") || el.getAttribute("role") || "",
      text: text.slice(0, 120),
      value: (el.value || "").slice(0, 60),
      placeholder: el.placeholder || "",
    });
    idx++;
    if (idx >= 250) break;
  }

  // 画面の本文テキスト（Claudeが「今どの画面か」「内容」を読むため）
  const main =
    document.querySelector('main, [role="main"], #main, .main, .content') || document.body;
  const text = (main.innerText || "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 5000);

  return {
    url: location.href,
    title: document.title,
    text: text,
    elements: out,
  };
}

function focusAndRect(index) {
  const el = document.querySelector('[data-yayoi-idx="' + index + '"]');
  if (!el) return null;
  el.scrollIntoView({ block: "center", inline: "center" });
  if (typeof el.focus === "function") {
    try {
      el.focus();
    } catch (e) {
      /* noop */
    }
  }
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}
