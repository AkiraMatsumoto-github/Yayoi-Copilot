// 弥生会計コパイロット — 画面モデル（現在地特定の土台）
// 設計: docs/recipe-design.md §3
//
// 判定材料は background が抽出している page = { url, title, text, elements }。
// 弥生はMPA（画面遷移ごとにURLが変わる）なので、URLが最も信頼できる第一キー。
// 足りない分だけ本文テキスト・要素で補う。

// 各画面の signature（detect）の意味:
//   urlIncludes : URL部分一致（強い手がかり）
//   allText     : 全て本文に含まれること（必須条件）
//   anyText     : いずれかが本文に含まれること
//   notText     : 含まれてはいけない（似た画面の区別）
//   hasElement  : { text?, role? } に合う操作要素が存在すること
//   interstitial: 割り込み画面（login/dialog等）。通常画面より先に判定する
//   onEnter     : 検知時の指示（"stop:メッセージ" 等）

// 弥生の入口URL。service_id を付けないとポータルに飛んでしまうため必ず付ける。
export const ENTRY_URL = "https://myaccount.yayoi-kk.co.jp/login?service_id=shinkoku";

export const SCREENS = [
  // ── 割り込み画面（最優先で判定）──
  {
    id: "login",
    name: "ログイン（要再ログイン）",
    // 入口（既定URL）: https://myaccount.yayoi-kk.co.jp/login?service_id=shinkoku
    detect: { urlIncludes: "myaccount.yayoi-kk.co.jp/login" },
    interstitial: true,
    onEnter: "stop:ログインが必要です。手動でログインしてから再実行してください。",
  },

  // ── 通常画面 ──
  {
    id: "myportal",
    name: "マイポータル",
    detect: { urlIncludes: "myportal", anyText: ["マイポータル", "弥生からのお知らせ"] },
  },
  {
    id: "aoiro-home",
    name: "やよいの青色申告 オンライン（ホーム）",
    // 実ドメインは shinkoku.yayoi-kk.co.jp、ホームは /Home
    detect: { urlIncludes: "/Home", anyText: ["スマート取引取込", "かんたん取引入力"] },
  },
  {
    id: "journal",
    name: "仕訳帳",
    detect: {
      allText: ["仕訳帳"],
      anyText: ["取引", "借方", "貸方"],
      notText: ["かんたん取引入力"],
    },
  },
];

// detect の各条件を page に照合（真偽）
function matches(detect, page) {
  const url = page.url || "";
  const text = page.text || "";
  const elements = page.elements || [];

  if (detect.urlIncludes && !url.includes(detect.urlIncludes)) return false;
  if (detect.allText && !detect.allText.every((w) => text.includes(w))) return false;
  if (detect.notText && detect.notText.some((w) => text.includes(w))) return false;
  if (detect.anyText && !detect.anyText.some((w) => text.includes(w))) return false;
  if (detect.hasElement && !elements.some((el) => elementMatches(el, detect.hasElement)))
    return false;
  return true;
}

function elementMatches(el, want) {
  if (want.text && !(el.text || "").includes(want.text)) return false;
  if (want.role && (el.type || "") !== want.role) return false;
  return true;
}

// 具体度＝detect に並ぶ条件の数（多いほど具体的）。同点解消に使う。
function specificity(detect) {
  let n = 0;
  if (detect.urlIncludes) n += 1;
  if (detect.allText) n += detect.allText.length;
  if (detect.notText) n += detect.notText.length;
  if (detect.anyText) n += 1;
  if (detect.hasElement) n += 1;
  return n;
}

// 現在地を返す。設計 §3.3（真偽＋具体度、同点や該当なしは "unknown"）
// 戻り値: { id, name, interstitial?, onEnter? } | { id: "unknown", name: "不明" }
export function detectScreen(page) {
  // 割り込み画面を先にチェック
  for (const s of SCREENS) {
    if (s.interstitial && matches(s.detect, page)) return s;
  }
  // 通常画面のうち条件を満たすもの
  const cands = SCREENS.filter((s) => !s.interstitial && matches(s.detect, page));
  if (cands.length === 0) return UNKNOWN;
  if (cands.length === 1) return cands[0];

  // 複数一致 → 最も具体的なものを採用。同点なら unknown（誤判定より安全）
  cands.sort((a, b) => specificity(b.detect) - specificity(a.detect));
  if (specificity(cands[0].detect) === specificity(cands[1].detect)) return UNKNOWN;
  return cands[0];
}

const UNKNOWN = { id: "unknown", name: "不明" };
