// 弥生会計コパイロット (PoC) — バックグラウンド（サービスワーカー）
// エージェントループ本体。chrome.scripting で画面のDOMを抽出し、
// バックエンド(Claude)に次の操作を問い合わせ、chrome.debugger で
// 「本物の（trusted）」クリック・入力を実行する。

import { detectScreen, screenById, ENTRY_URL } from "./screens.js";
import { matchRecipe } from "./recipes.js";

const BACKEND = "http://localhost:8000/api/agent/next";
const MAX_STEPS = 15;
const SETTLE_MS = 1500; // 画面遷移の待ち時間

// ツールバーアイコンのクリックでサイドパネルを開く
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

let isRunning = false;
let abortRequested = false;

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "run") {
    if (isRunning) return; // 二重実行を防ぐ
    runAgent(msg.task).catch((e) => send({ type: "error", text: String(e) }));
  } else if (msg.type === "stop") {
    if (isRunning) {
      abortRequested = true;
      sendLog("⏹ 中断を要求しました…（現在のステップ完了後に停止します）");
    }
  } else if (msg.type === "whereami") {
    reportScreen().catch(() => {});
  } else if (msg.type === "open") {
    openYayoi().catch(() => {});
  } else if (msg.type === "catalog") {
    sendCatalog().catch(() => {});
  } else if (msg.type === "clearCatalog") {
    chrome.storage.local.set({ catalog: {} }).then(() => sendCatalog());
  }
});

// 弥生を入口URL（service_id付き）で開く。現タブが弥生でなければそのタブで遷移。
async function openYayoi() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab && tab.url && tab.url.includes("yayoi-kk.co.jp")) {
    await chrome.tabs.update(tab.id, { url: ENTRY_URL });
  } else {
    await chrome.tabs.create({ url: ENTRY_URL });
  }
}

// アクティブタブが変わった/読み込み完了したら現在地を再判定して通知（live表示）
chrome.tabs.onActivated.addListener(() => reportScreen().catch(() => {}));
chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === "complete") {
    recordCatalog(tab).catch(() => {}); // 訪れた画面を自動でカタログ蓄積
    if (tab.active) reportScreen().catch(() => {});
  }
});

// 現在のタブの画面を判定してサイドパネルへ送る（debugger不要・scriptingのみ）
async function reportScreen() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.includes("yayoi-kk.co.jp")) {
    send({ type: "screen", id: "off", name: "弥生のタブではありません" });
    return;
  }
  const page = await extract(tab.id);
  const screen = detectScreen(page);
  send({
    type: "screen",
    id: screen.id,
    name: screen.name,
    url: tab.url,
    title: page.title || tab.title || "",
  });
}

// ───────── 画面カタログ（自動取得） ─────────
// 弥生を普通に使うだけで、訪れた画面の host+path / title / URL を蓄積する。
// これを書き出せば、人力で1画面ずつ聞かなくても全画面のマップが手に入る。

function pathKey(url) {
  try {
    const u = new URL(url);
    return u.host + u.pathname; // クエリは除いてパスでまとめる
  } catch {
    return url;
  }
}

async function recordCatalog(tab) {
  if (!tab || !tab.url || !tab.url.includes("yayoi-kk.co.jp")) return;
  const key = pathKey(tab.url);
  const { catalog = {} } = await chrome.storage.local.get("catalog");
  const prev = catalog[key] || { count: 0 };
  catalog[key] = {
    title: tab.title || prev.title || "",
    sampleUrl: tab.url, // クエリ付きの実例も1つ保持
    count: prev.count + 1,
    lastSeen: Date.now(),
  };
  await chrome.storage.local.set({ catalog });
}

async function sendCatalog() {
  const { catalog = {} } = await chrome.storage.local.get("catalog");
  const items = Object.entries(catalog)
    .map(([path, v]) => ({ path, ...v }))
    .sort((a, b) => a.path.localeCompare(b.path));
  send({ type: "catalogData", items });
}

function send(payload) {
  // サイドパネルが閉じていると receiving end が無くエラーになるため握りつぶす
  chrome.runtime.sendMessage(payload).catch(() => {});
}
const sendLog = (text) => send({ type: "log", text });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ルーター: レシピに一致すれば決定的ナビ→（必要なら）AI、無ければ従来のAIループ。
async function runAgent(task) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url || !tab.url.includes("yayoi-kk.co.jp")) {
    send({ type: "error", text: "弥生会計のタブをアクティブにしてから実行してください。" });
    return;
  }
  const tabId = tab.id;

  isRunning = true;
  abortRequested = false;
  try {
    const recipe = matchRecipe(task);
    if (recipe) {
      sendLog(`📋 レシピ「${recipe.name}」を実行`);

      // ── goto: 目的画面へ直接移動（現在地を見て自己修正） ──
      if (recipe.goto) {
        const target = screenById(recipe.goto);
        sendLog(`→ ${target ? target.name : recipe.goto} へ移動`);
        const r = await goToScreen(tabId, recipe.goto);
        if (!r.ok) {
          if (r.screen && r.screen.interstitial) {
            const msg = (r.screen.onEnter || "stop:操作を中断しました。").replace(/^stop:/, "");
            send({ type: "stopped", result: msg });
            return;
          }
          sendLog(`⚠ 直接移動に失敗（現在地: ${r.screen ? r.screen.name : "不明"}）。AIに切替`);
          await runAiLoop(tabId, task);
          return;
        }
        sendLog(`✓ ${target ? target.name : recipe.goto} に到達`);
      }

      // ── then: 到達後にやること ──
      const then = recipe.then;
      if (!then) {
        send({ type: "done", result: `${screenById(recipe.goto)?.name || "目的の画面"}を開きました。` });
        return;
      }
      if (then.ai) {
        await runAiLoop(tabId, then.ai === "original" ? task : then.ai);
        return;
      }
      // ステップ配列の決定的実行は後続フェーズ。今はAIに委ねる。
      await runAiLoop(tabId, task);
      return;
    }

    // レシピ無し → 従来どおり全部AI
    await runAiLoop(tabId, task);
  } finally {
    isRunning = false;
    abortRequested = false;
  }
}

// 目的画面へ直接遷移（MPA: URL直行が最も確実）→ 読み込み完了を待って検証
async function goToScreen(tabId, targetId) {
  const target = screenById(targetId);
  if (!target || !target.url) return { ok: false, reason: "no-url" };

  // すでに目的画面ならナビ不要
  let here = detectScreen(await extract(tabId));
  if (here.id === targetId) return { ok: true, screen: here };

  await chrome.tabs.update(tabId, { url: target.url });
  await waitForLoad(tabId);

  here = detectScreen(await extract(tabId));
  if (here.interstitial) return { ok: false, reason: "interstitial", screen: here };
  return { ok: here.id === targetId, screen: here };
}

// タブの読み込み完了（status === "complete"）を待つ
function waitForLoad(tabId, timeout = 8000) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve(v);
    };
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") finish(true);
    };
    const timer = setTimeout(() => finish(false), timeout);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// 従来のAIエージェントループ（debugger で trusted 操作）。isRunning は呼び出し側が管理。
async function runAiLoop(tabId, task) {
  await chrome.debugger.attach({ tabId }, "1.3");
  const history = [];
  try {
    for (let step = 1; step <= MAX_STEPS; step++) {
      if (abortRequested) {
        send({ type: "stopped", result: "中断しました。" });
        return;
      }
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

      if (abortRequested) {
        send({ type: "stopped", result: "中断しました。" });
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
    const text = action.text || "";
    await sleep(150);

    // ① まず「値を直接セット」で試す（Wijmo等のJS制御フィールドはキー入力を横取り
    //    して壊すため、コントロール本体 or native setter に値を入れるのが確実）。
    const r = await setFieldValue(tabId, action.index, text);
    if (r) {
      sendLog(
        `✍ ${r.method}${r.ctrlType ? `(${r.ctrlType})` : ""} で設定: ` +
          `"${r.before}" → "${r.after}"`
      );
    }

    // ② それでも狙い通りにならなければ、従来の trusted キー入力にフォールバック
    if (!r || normDate(r.after) !== normDate(text)) {
      sendLog("↩ 値セットで一致せず。キー入力でフォールバック");
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
      await typeText(tabId, text);
    }
  }
}

// 日付文字列を比較用に正規化（区切り文字の差を無視、数字だけで比べる）
function normDate(s) {
  return String(s || "").replace(/\D/g, "");
}

// ページの MAIN world で値を直接セットする。
//   1) Wijmo Control が見つかれば control.value(Date) / control.text をセット
//   2) 無ければ native value setter + input/change イベント
// world:"MAIN" 必須（isolated world からは window.wijmo が見えない）。
async function setFieldValue(tabId, index, text) {
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (idx, text) => {
      const el = document.querySelector('[data-yayoi-idx="' + idx + '"]');
      if (!el) return { ok: false, method: "none", before: "", after: "" };
      const before = el.value != null ? String(el.value) : "";
      const w = window.wijmo;
      const info = { ok: false, method: "native", hasWijmo: !!w, before, after: before };

      // ── Wijmo コントロールを祖先からたどって取得 ──
      let ctrl = null;
      if (w && w.Control && typeof w.Control.getControl === "function") {
        for (let n = el; n && n !== document.body; n = n.parentElement) {
          const c = w.Control.getControl(n);
          if (c) {
            ctrl = c;
            break;
          }
        }
      }

      if (ctrl) {
        info.method = "wijmo";
        info.ctrlType = ctrl.constructor && ctrl.constructor.name;
        try {
          const m = /(\d{4})\D+(\d{1,2})\D+(\d{1,2})/.exec(text);
          if (m && "value" in ctrl) {
            ctrl.value = new Date(+m[1], +m[2] - 1, +m[3]);
          } else if ("text" in ctrl) {
            ctrl.text = text;
          } else if ("value" in ctrl) {
            ctrl.value = text;
          }
          if (typeof ctrl.refresh === "function") ctrl.refresh();
          // Wijmoは自前でイベントを出すが、業務側ハンドラ用に change も通知
          el.dispatchEvent(new Event("change", { bubbles: true }));
          info.ok = true;
        } catch (e) {
          info.err = String(e);
        }
        info.after = el.value != null ? String(el.value) : "";
        return info;
      }

      // ── フォールバック: native setter + イベント ──
      try {
        const proto = Object.getPrototypeOf(el);
        const desc = Object.getOwnPropertyDescriptor(proto, "value");
        if (desc && desc.set) desc.set.call(el, text);
        else el.value = text;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("blur", { bubbles: true }));
        info.ok = true;
      } catch (e) {
        info.err = String(e);
      }
      info.after = el.value != null ? String(el.value) : "";
      return info;
    },
    args: [index, text],
  });
  return result;
}

// Windows仮想キーコード（マスク欄が e.key / keyCode を見て処理するため付与する）
function vkFor(ch) {
  if (ch >= "0" && ch <= "9") return ch.charCodeAt(0); // 48-57
  if (/[a-z]/i.test(ch)) return ch.toUpperCase().charCodeAt(0);
  if (ch === "/") return 191; // VK_OEM_2
  if (ch === "-") return 189;
  if (ch === ".") return 190;
  return 0;
}

// 文字列を1文字ずつ trusted なキーイベントで入力する
async function typeText(tabId, text) {
  for (const ch of text) {
    const vk = vkFor(ch);
    const codes = vk ? { windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk } : {};
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
      type: "keyDown",
      key: ch,
      text: ch,
      unmodifiedText: ch,
      ...codes,
    });
    await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
      type: "keyUp",
      key: ch,
      ...codes,
    });
    await sleep(25);
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
