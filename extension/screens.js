// 弥生会計コパイロット — 画面モデル（現在地特定の土台）
// 設計: docs/recipe-design.md §3
//
// 弥生はMPA（画面遷移ごとにURLが変わる）。host+path が安定した一意キーになるので、
// それで判定する。ページタイトルは「製品 - 画面名」の形に揃っているため、
// 未定義のページでもタイトルから画面名を自動導出できる（→ 常に名前が出る）。

// 弥生の入口URL。service_id を付けないとポータルに飛ぶので必ず付ける。
export const ENTRY_URL = "https://myaccount.yayoi-kk.co.jp/login?service_id=shinkoku";

// 画面定義: { id, name, path, url } を基本に、特殊な判定だけ追加プロパティを使う。
//   path        : host+path の部分一致で判定（最長一致を優先）
//   url         : ナビ用の完全URL（goToScreen が直接遷移。MPAなので最も確実）
//   interstitial: 割り込み画面（login等）。通常画面より先に判定
//   onEnter     : 検知時の指示（"stop:メッセージ" 等）
//   mutates     : この画面が書き込み系か（将来の安全判定用メモ）
const S = "https://shinkoku.yayoi-kk.co.jp/";
const SM = "https://smart.yayoi-kk.co.jp/";

export const SCREENS = [
  // ── 割り込み（最優先） ──
  {
    id: "login",
    name: "ログイン（要再ログイン）",
    // 入口は /login?service_id=shinkoku → /external/authz に遷移。myaccount全体を認証画面とみなす
    path: "myaccount.yayoi-kk.co.jp/",
    url: ENTRY_URL,
    interstitial: true,
    onEnter: "stop:ログインが必要です。手動でログインしてから再実行してください。",
  },

  // ── やよいの青色申告 オンライン（shinkoku） ──
  { id: "aoiro-home", name: "ホーム", path: "shinkoku.yayoi-kk.co.jp/Home", url: S + "Home" },
  { id: "report-menu", name: "レポート・帳簿", path: "shinkoku.yayoi-kk.co.jp/ReportMenu", url: S + "ReportMenu/ReportMenu" },
  { id: "input-journal", name: "仕訳の入力", path: "shinkoku.yayoi-kk.co.jp/InputJournal", url: S + "InputJournal" },
  { id: "input-dealings", name: "かんたん取引入力", path: "shinkoku.yayoi-kk.co.jp/InputDealings", url: S + "InputDealings" },
  { id: "tax-return", name: "確定申告の手順", path: "shinkoku.yayoi-kk.co.jp/TaxReturnProcedure", url: S + "TaxReturnProcedure" },

  // レポート類（読み取り専用）
  { id: "report-balance", name: "貸借レポート", path: "shinkoku.yayoi-kk.co.jp/BalanceReport", url: S + "BalanceReport/BalanceReport" },
  { id: "report-customer", name: "取引先別損益レポート", path: "shinkoku.yayoi-kk.co.jp/CustomerReport", url: S + "CustomerReport/CustomerReport" },
  { id: "report-daily", name: "日別取引レポート", path: "shinkoku.yayoi-kk.co.jp/DailyReport", url: S + "DailyReport/DailyReport" },
  { id: "report-kanjo", name: "科目別損益レポート", path: "shinkoku.yayoi-kk.co.jp/KanjoReport", url: S + "KanjoReport/KanjoReport" },
  { id: "report-monthly", name: "損益レポート", path: "shinkoku.yayoi-kk.co.jp/MonthlyReport", url: S + "MonthlyReport/MonthlyReport" },
  { id: "report-transition", name: "残高推移表", path: "shinkoku.yayoi-kk.co.jp/TransitionBalance", url: S + "TransitionBalance/TransitionBalance" },
  { id: "report-trial", name: "残高試算表", path: "shinkoku.yayoi-kk.co.jp/TrialBalance", url: S + "TrialBalance/TrialBalance" },

  // ── スマート取引取込（smart） ──
  { id: "smart-csv", name: "CSVファイル取込", path: "smart.yayoi-kk.co.jp/Smart/CsvImport", url: SM + "Smart/CsvImport" },
  { id: "smart-dealings", name: "未確定の取引", path: "smart.yayoi-kk.co.jp/Smart/Dealings", url: SM + "Smart/Dealings" },
  { id: "smart-rule", name: "仕訳ルール設定", path: "smart.yayoi-kk.co.jp/Smart/JournalizingRuleSettings", url: SM + "Smart/JournalizingRuleSettings" },
  { id: "smart-past", name: "確定済みの取引", path: "smart.yayoi-kk.co.jp/Smart/PastDealings", url: SM + "Smart/PastDealings" },
  { id: "smart-scan", name: "スキャンデータ取込", path: "smart.yayoi-kk.co.jp/Smart/ScanDataImport", url: SM + "Smart/ScanDataImport" },
  { id: "smart-home", name: "スマート取引取込", path: "smart.yayoi-kk.co.jp/", url: SM },
];

// idから画面定義を引く
export function screenById(id) {
  return SCREENS.find((s) => s.id === id) || null;
}

const UNKNOWN = { id: "unknown", name: "不明" };

function pathHit(url, path) {
  return (url || "").includes(path);
}

// タイトル「製品 - 画面名」から画面名を取り出す（未定義ページ用フォールバック）
function deriveName(title) {
  if (!title) return null;
  const parts = title.split(/\s*[-–—]\s*/);
  return parts.length > 1 ? parts[parts.length - 1].trim() : title.trim();
}

// 現在地を返す。基本はURL(host+path)の最長一致。未定義はタイトルから自動導出。
// 戻り値: { id, name, interstitial?, onEnter?, auto? } | UNKNOWN
export function detectScreen(page) {
  const url = page.url || "";

  // 割り込み画面を先にチェック
  for (const s of SCREENS) {
    if (s.interstitial && pathHit(url, s.path)) return s;
  }

  // 通常画面: path がURLに含まれるものを集め、最長一致を採用
  const cands = SCREENS.filter((s) => !s.interstitial && pathHit(url, s.path));
  if (cands.length) {
    cands.sort((a, b) => b.path.length - a.path.length);
    return cands[0];
  }

  // 未定義ページ → タイトルから画面名を自動導出（名前は出せる）
  const name = deriveName(page.title);
  if (name) return { id: "auto", name, auto: true };

  return UNKNOWN;
}
