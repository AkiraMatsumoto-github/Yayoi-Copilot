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
let pendingConfirm = null; // 確認ゲートの応答待ち { id, resolve }

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "run") {
    if (isRunning) return; // 二重実行を防ぐ
    runAgent(msg.task).catch((e) => send({ type: "error", text: String(e) }));
  } else if (msg.type === "stop") {
    if (isRunning) {
      abortRequested = true;
      sendLog("⏹ 中断を要求しました…（現在のステップ完了後に停止します）");
      // 確認待ちなら「キャンセル」として解放
      if (pendingConfirm) {
        const p = pendingConfirm;
        pendingConfirm = null;
        p.resolve(false);
      }
    }
  } else if (msg.type === "confirmResult") {
    if (pendingConfirm && pendingConfirm.id === msg.id) {
      const p = pendingConfirm;
      pendingConfirm = null;
      p.resolve(!!msg.ok);
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
    const matched = matchRecipe(task);
    if (matched) {
      const { recipe, params } = matched;
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

      // ── steps: 到達後の決定的な操作（mutates のみ確認ゲート） ──
      if (recipe.steps) {
        const out = await runSteps(tabId, recipe, params, task);
        if (out.stopped) {
          send({ type: "stopped", result: out.message || "操作を中断しました。" });
          return;
        }
        if (out.ok) {
          send({
            type: "done",
            result: `${screenById(recipe.goto)?.name || recipe.name}で操作しました。`,
          });
          return;
        }
        sendLog(`⚠ 決定的ステップ失敗（${out.reason || "?"}）。AIに切替`);
        await runAiLoop(tabId, task);
        return;
      }

      // ── then: 到達後にやること（単一アクション/AI委譲） ──
      const then = recipe.then;
      if (!then) {
        send({ type: "done", result: `${screenById(recipe.goto)?.name || "目的の画面"}を開きました。` });
        return;
      }
      if (then.ai) {
        await runAiLoop(tabId, then.ai === "original" ? task : then.ai);
        return;
      }
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

// ───────── 決定的ステップの実行（レシピ §4） ─────────

// 確認ゲート: サイドパネルに内容を提示し、ユーザーの承認(true)/キャンセル(false)を待つ。
// mutates（更新/削除/新規登録）のステップだけがこれを通る。読み取り系は通らない。
function askConfirm(title, lines) {
  return new Promise((resolve) => {
    const id = String(Date.now());
    pendingConfirm = { id, resolve };
    send({ type: "confirm", id, title, lines });
  });
}

// "{{name}}" を params の値で展開。取れないキーはそのまま残す（呼び出し側で判定）。
function expand(str, params) {
  return String(str).replace(/\{\{(\w+)\}\}/g, (_, k) =>
    params[k] != null ? String(params[k]) : `{{${k}}}`
  );
}

// 確認ゲートやログ用の、ステップの人間向け説明
function describeStep(step, value) {
  if (step.set) return `${step.set.label || step.set.css || "フィールド"} に「${value}」を入力`;
  if (step.click) return `「${step.click.text || step.click.css}」をクリック`;
  if (step.select) return `${step.select.target?.label || "選択"} を「${value}」に`;
  return "操作";
}

// レシピの steps を決定的に実行する。debugger のアタッチはここで管理。
// 戻り値: { ok } | { ok:false, reason } | { stopped:true, message }
async function runSteps(tabId, recipe, rawParams, task) {
  const params = { ...rawParams, ...(recipe.derive ? recipe.derive(rawParams, task) : {}) };

  // テンプレート展開 & optional スキップ判定（実行前にまとめて解決）
  const resolved = [];
  for (const step of recipe.steps) {
    let value;
    if (step.value != null) {
      value = expand(step.value, params);
      if (/\{\{\w+\}\}/.test(value)) {
        // 必要な値が取れなかった
        if (step.optional) {
          sendLog(`↷ スキップ: ${describeStep(step, value)}（値が指定されていません）`);
          continue;
        }
        return { ok: false, reason: "param" };
      }
    }
    resolved.push({ step, value });
  }

  // 確認ゲート: mutates を含むならまとめて1回提示
  const mutates = resolved.filter((r) => r.step.mutates);
  if (mutates.length) {
    const lines = mutates.map((r) => describeStep(r.step, r.value));
    sendLog("⏸ 確認待ち（更新系の操作）");
    const ok = await askConfirm(`${recipe.name}を実行します。よろしいですか？`, lines);
    if (!ok) return { stopped: true, message: "確認がキャンセルされました。" };
  }

  await chrome.debugger.attach({ tabId }, "1.3");
  try {
    for (const { step, value } of resolved) {
      if (abortRequested) return { stopped: true, message: "中断しました。" };
      sendLog(`▶ ${describeStep(step, value)}`);
      const res = await execStep(tabId, step, value);
      if (!res.ok) {
        sendLog(`⚠ ステップ失敗: ${res.reason}`);
        return { ok: false, reason: res.reason };
      }
      await sleep(700); // 画面反映を待つ
    }
    return { ok: true };
  } finally {
    try {
      await chrome.debugger.detach({ tabId });
    } catch (e) {
      /* noop */
    }
  }
}

// 1ステップを実行（click / set）。要素は安定セレクタ or 表示テキストで特定。
async function execStep(tabId, step, value) {
  if (step.set) {
    // css 指定を優先、無ければ label 基点で欄を特定（他ページにも流用しやすい）
    const sel = await resolveFieldSelector(tabId, step.set);
    if (!sel) {
      // optional なら欄が無い画面ではスキップ（例: 期間欄を持たないレポート）
      if (step.optional) {
        sendLog(`↷ 入力欄が見つからないためスキップ（${step.set.css || step.set.label || "?"}）`);
        return { ok: true };
      }
      return { ok: false, reason: "field-not-found" };
    }
    const r = await setFieldValue(tabId, sel, value);
    if (!r || !r.ok) return { ok: false, reason: "set-failed" };
    sendLog(`　✍ ${r.method}: "${r.before}" → "${r.after}"`);
    // 値セットで一致しなければ、trusted クリック→キー入力でフォールバック
    if (normDate(r.after) !== normDate(value)) {
      const loc = await locate(tabId, { css: sel });
      if (loc.found) {
        await mouseClick(tabId, loc.x, loc.y);
        await keyCombo(tabId, "a", true);
        await typeText(tabId, value);
      }
    }
    return { ok: true };
  }

  if (step.click) {
    const loc = await locate(tabId, step.click);
    if (!loc.found) {
      // optional なクリックは、対象が無ければスキップ（例: 期間変更で自動反映され
      // 「表示」ボタンが無いレポート）。必須クリックは失敗させてAIへ。
      if (step.optional) {
        sendLog("↷ クリック対象が見つからないためスキップ（自動反映とみなす）");
        return { ok: true };
      }
      return { ok: false, reason: loc.ambiguous ? `ambiguous(${loc.count})` : "not-found" };
    }
    await mouseClick(tabId, loc.x, loc.y);
    return { ok: true };
  }

  return { ok: false, reason: "unknown-step" };
}

// ターゲット指定（css / text / role / nth）から要素を特定し、画面座標を返す。
// あいまい（複数一致で nth 未指定）は found:false, ambiguous:true（§4.1 の安全規則）。
async function locate(tabId, target) {
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (target) => {
      let els;
      if (target.css) {
        els = Array.from(document.querySelectorAll(target.css));
      } else {
        const SEL =
          'a, button, input[type="button"], input[type="submit"], [role="button"], [role="link"], [role="menuitem"], [role="tab"], [onclick]';
        els = Array.from(document.querySelectorAll(SEL));
      }
      const visible = (el) => {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) return false;
        const s = getComputedStyle(el);
        return !(s.visibility === "hidden" || s.display === "none" || s.opacity === "0");
      };
      els = els.filter(visible);
      if (target.role) els = els.filter((el) => el.getAttribute("role") === target.role);
      if (target.text) {
        const wants = Array.isArray(target.text) ? target.text : [target.text];
        const txt = (el) =>
          (el.innerText || el.value || el.getAttribute("aria-label") || "").trim();
        const hit = els.filter((el) => wants.some((w) => txt(el).includes(w)));
        const exact = hit.filter((el) => wants.some((w) => txt(el) === w));
        els = exact.length ? exact : hit;
      }
      if (!els.length) return { found: false, count: 0 };
      if (target.nth == null && els.length > 1) {
        return { found: false, ambiguous: true, count: els.length };
      }
      const el = els[target.nth != null ? target.nth : 0];
      if (!el) return { found: false, count: els.length };
      el.scrollIntoView({ block: "center", inline: "center" });
      const r = el.getBoundingClientRect();
      return { found: true, count: els.length, x: r.left + r.width / 2, y: r.top + r.height / 2 };
    },
    args: [target],
  });
  return result || { found: false };
}

// 入力欄を css か label（ラベル文字列）で特定し、setFieldValue 用のセレクタを返す。
//   css があれば優先（存在すればそれを使う）。無ければ label からたどって一時マークを付与。
//   label 解決は「<label for>」「aria-label(ledby)」「見出しセル近傍の input」の順に探す。
async function resolveFieldSelector(tabId, target) {
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (css, label) => {
      // 古いマークを掃除
      document.querySelectorAll("[data-yayoi-target]").forEach((e) => e.removeAttribute("data-yayoi-target"));

      if (css) {
        const el = document.querySelector(css);
        if (el) return css;
      }
      if (!label) return null;

      const findByLabel = (labelText) => {
        // 1) <label for=id> / ラップする <label>
        for (const lb of document.querySelectorAll("label")) {
          if (!(lb.textContent || "").includes(labelText)) continue;
          const forId = lb.getAttribute("for");
          const byFor = forId ? document.getElementById(forId) : null;
          if (byFor) return byFor;
          const inner = lb.querySelector("input, select, textarea");
          if (inner) return inner;
        }
        // 2) input 自身の aria-label / aria-labelledby
        const inputs = Array.from(document.querySelectorAll("input, select, textarea"));
        for (const inp of inputs) {
          if ((inp.getAttribute("aria-label") || "").includes(labelText)) return inp;
          const lbId = inp.getAttribute("aria-labelledby");
          if (lbId) {
            const lbEl = document.getElementById(lbId);
            if (lbEl && (lbEl.textContent || "").includes(labelText)) return inp;
          }
        }
        // 3) 見出しセル/ラベル語を含む要素の近傍にある input（同じ行・グループを数レベル上へ）
        const heads = Array.from(document.querySelectorAll("th, td, dt, dd, label, span, div, p"));
        for (const node of heads) {
          const t = (node.textContent || "").trim();
          if (t !== labelText && !t.startsWith(labelText)) continue;
          let scope = node.closest("tr, .wj-input-group, .form-group, .field, li, dl") || node.parentElement;
          for (let s = scope, i = 0; s && i < 4; s = s.parentElement, i++) {
            const inp = s.querySelector('input:not([type="hidden"]), select, textarea');
            if (inp) return inp;
          }
        }
        return null;
      };

      const input = findByLabel(label);
      if (!input) return null;
      input.setAttribute("data-yayoi-target", "1");
      input.scrollIntoView({ block: "center", inline: "center" });
      return '[data-yayoi-target="1"]';
    },
    args: [target.css || null, target.label || null],
  });
  return result || null;
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
    const r = await setFieldValue(tabId, `[data-yayoi-idx="${action.index}"]`, text);
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
async function setFieldValue(tabId, selector, text) {
  const [{ result } = {}] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: (selector, text) => {
      const el = document.querySelector(selector);
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
    args: [selector, text],
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
