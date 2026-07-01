// 弥生会計コパイロット — レシピ（指示 → 決まった操作）
// 設計: docs/recipe-design.md §4-6
//
// Phase 1: まずはナビ系レシピ（goto のみ）。弥生はMPAで各画面に安定URLがあるため、
// goToScreen が目的画面へ直接遷移する。判断が要る操作は then:{ai} でAIに委ねる。
//
// triggers は配列。上から評価し、最初に一致したレシピを採用。
// ※ 具体的なトリガーを先に置く（汎用が具体を食わないように）。

export const RECIPES = [
  // ── レポート類（具体的なものを先に） ──
  { id: "r-kanjo", name: "科目別損益レポートを開く", triggers: [/科目別/], goto: "report-kanjo" },
  { id: "r-customer", name: "取引先別損益レポートを開く", triggers: [/取引先別/], goto: "report-customer" },
  { id: "r-daily", name: "日別取引レポートを開く", triggers: [/日別/], goto: "report-daily" },
  { id: "r-monthly", name: "損益レポートを開く", triggers: [/損益(レポート)?/], goto: "report-monthly" },
  { id: "r-balance", name: "貸借レポートを開く", triggers: [/貸借/], goto: "report-balance" },
  { id: "r-transition", name: "残高推移表を開く", triggers: [/残高推移|推移表/], goto: "report-transition" },
  { id: "r-trial", name: "残高試算表を開く", triggers: [/試算表|残高試算/], goto: "report-trial" },

  // ── 入力・メニュー ──
  { id: "r-input-journal", name: "仕訳の入力を開く", triggers: [/仕訳(の)?入力/, /仕訳帳/, /仕訳を(入力|つけ|記帳)/], goto: "input-journal" },
  { id: "r-input-dealings", name: "かんたん取引入力を開く", triggers: [/かんたん取引|かんたん入力|簡単取引/], goto: "input-dealings" },
  { id: "r-report-menu", name: "レポート・帳簿を開く", triggers: [/レポート・帳簿|帳簿/], goto: "report-menu" },
  { id: "r-tax", name: "確定申告の手順を開く", triggers: [/確定申告/], goto: "tax-return" },
  { id: "r-home", name: "ホームを開く", triggers: [/ホーム(に|へ)?(戻|表示|開)?/], goto: "aoiro-home" },

  // ── スマート取引取込 ──
  { id: "r-smart-past", name: "確定済みの取引を開く", triggers: [/確定済み(の)?取引/], goto: "smart-past" },
  { id: "r-smart-dealings", name: "未確定の取引を開く", triggers: [/未確定(の)?取引/], goto: "smart-dealings" },
  { id: "r-smart-csv", name: "CSVファイル取込を開く", triggers: [/CSV(ファイル)?取込|CSV取り込み/i], goto: "smart-csv" },
  { id: "r-smart-scan", name: "スキャンデータ取込を開く", triggers: [/スキャン(データ)?取込/], goto: "smart-scan" },
  { id: "r-smart-rule", name: "仕訳ルール設定を開く", triggers: [/仕訳ルール/], goto: "smart-rule" },
  { id: "r-smart", name: "スマート取引取込を開く", triggers: [/スマート取引|取引取込/], goto: "smart-home" },
];

// 指示にマッチするレシピを返す（無ければ null → AIループへ）
export function matchRecipe(task) {
  const t = task || "";
  for (const r of RECIPES) {
    if (r.triggers.some((re) => re.test(t))) return r;
  }
  return null;
}
