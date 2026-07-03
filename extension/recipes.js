// 弥生会計コパイロット — レシピ（指示 → 決まった操作）
// 設計: docs/recipe-design.md §4-6
//
// Phase 1: まずはナビ系レシピ（goto のみ）。弥生はMPAで各画面に安定URLがあるため、
// goToScreen が目的画面へ直接遷移する。判断が要る操作は then:{ai} でAIに委ねる。
//
// triggers は配列。上から評価し、最初に一致したレシピを採用。
// ※ 具体的なトリガーを先に置く（汎用が具体を食わないように）。

import { parseRange } from "./dates.js";

// レポート共通の「期間指定」決定的ステップ（読み取り系＝確認ゲート無し）。
//   期間UIは各レポート共通で「[日指定▼] [開始日] 〜 [終了日]」。ラベルは無く安定IDで特定。
//   期間欄を変えると自動反映される（表示ボタンは無い）。既定は日指定モード。
//   欄が無いレポートでは optional によりスキップ（＝画面を開くだけ）。
function periodReport(id, name, goto, triggers) {
  return {
    id,
    name,
    triggers,
    goto,
    // 指示から期間を導出（「6月」「先月」「6/1〜6/30」「第1四半期」等 → { from, to }）
    derive: (_p, task) => parseRange(task) || {},
    steps: [
      { set: { css: "#SearchStartDate" }, value: "{{from}}", optional: true },
      { set: { css: "#SearchEndDate" }, value: "{{to}}", optional: true },
    ],
  };
}

export const RECIPES = [
  // ── レポート類（具体的なものを先に。全て期間指定を決定的にセット） ──
  periodReport("r-kanjo", "科目別損益レポートを表示", "report-kanjo", [/科目別/]),
  periodReport("r-customer", "取引先別損益レポートを表示", "report-customer", [/取引先別/]),
  periodReport("r-daily", "日別取引レポートを表示", "report-daily", [/日別/]),
  periodReport("r-monthly", "損益レポートを表示", "report-monthly", [/損益(レポート)?/]),
  periodReport("r-balance", "貸借レポートを表示", "report-balance", [/貸借/]),
  periodReport("r-transition", "残高推移表を表示", "report-transition", [/残高推移|推移表/]),
  periodReport("r-trial", "残高試算表を表示", "report-trial", [/試算表|残高試算/]),

  // ── 入力・メニュー ──
  { id: "r-input-journal", name: "仕訳の入力を開く", triggers: [/仕訳(の)?入力/, /仕訳帳/, /仕訳を(入力|つけ|記帳)/], goto: "input-journal" },
  // 取引の登録（書き込み系）: かんたん取引入力で決定的に登録する。
  //   値は Claude が指示文から構造化抽出（extract:"dealing"）、入力はラベル基点で決定的に行う。
  //   区分タブを最初に選び（破棄ダイアログ回避）、mutates ステップは実行前に確認ゲートで一括提示。
  {
    id: "r-register-dealing",
    name: "かんたん取引入力で登録",
    triggers: [/(登録|記帳)して/, /(取引|経費|支出|収入|仕入|売上|入金|出金)を?(登録|記帳|つけ)/],
    goto: "input-dealings",
    extract: "dealing",
    steps: [
      { click: { text: "{{kubun}}", role: "tab" }, optional: true, mutates: true },
      { set: { label: "取引日" }, value: "{{date}}", mutates: true },
      { set: { label: "科目" }, value: "{{account}}", mutates: true },
      { set: { label: "取引手段" }, value: "{{method}}", mutates: true },
      { set: { label: "摘要" }, value: "{{summary}}", optional: true, mutates: true },
      { set: { label: "取引先" }, value: "{{partner}}", optional: true, mutates: true },
      { set: { label: "金額" }, value: "{{amount}}", mutates: true },
      { click: { text: "登録" }, mutates: true },
    ],
  },
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

// 指示にマッチするレシピと捕捉パラメータを返す（無ければ null → AIループへ）
// 戻り値: { recipe, params } | null
//   params は最初に一致したトリガーの名前付きキャプチャ（例: (?<month>…) → { month }）
export function matchRecipe(task) {
  const t = task || "";
  for (const r of RECIPES) {
    for (const re of r.triggers) {
      const m = re.exec(t);
      if (m) return { recipe: r, params: m.groups ? { ...m.groups } : {} };
    }
  }
  return null;
}
