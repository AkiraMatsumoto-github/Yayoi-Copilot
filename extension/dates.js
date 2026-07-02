// 弥生会計コパイロット — 日付パーサ（指示の日付表現 → 正規化）
// 日付UIは2種類あるので両対応:
//   ・単一日付（取引日など。仕訳の登録＝書き込み系）  → parseDate() が "YYYY/MM/DD"
//   ・開始日/終了日（レポートの期間＝読み取り系）       → parseRange() が { from, to }
// 出力は弥生の日付欄が受ける "YYYY/MM/DD" 形式。個人事業（青色申告）は暦年基準。

const pad = (n) => String(n).padStart(2, "0");
const fmt = (d) => `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())}`;
const lastDay = (y, m) => new Date(y, m, 0).getDate(); // m は1始まり
const monthRange = (y, m) => ({ from: `${y}/${pad(m)}/01`, to: `${y}/${pad(m)}/${pad(lastDay(y, m))}` });

function quarterNum(s) {
  const map = { "1": 1, "2": 2, "3": 3, "4": 4, 一: 1, 二: 2, 三: 3, 四: 4, "１": 1, "２": 2, "３": 3, "４": 4 };
  return map[s] || 1;
}

// 単一日付を "YYYY/MM/DD" で返す（取れなければ null）
export function parseDate(text, base = new Date()) {
  const t = (text || "").trim();
  if (!t) return null;

  // 相対
  if (/今日|本日/.test(t)) return fmt(base);
  if (/昨日/.test(t)) return fmt(new Date(base.getFullYear(), base.getMonth(), base.getDate() - 1));
  if (/明日/.test(t)) return fmt(new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1));

  // YYYY/M/D・YYYY-M-D・YYYY年M月D日
  let m = /(\d{4})[\/\-年](\d{1,2})[\/\-月](\d{1,2})/.exec(t);
  if (m) return `${m[1]}/${pad(+m[2])}/${pad(+m[3])}`;

  // M月D日（年は当年）
  m = /(\d{1,2})月(\d{1,2})日?/.exec(t);
  if (m) return `${base.getFullYear()}/${pad(+m[1])}/${pad(+m[2])}`;

  // M/D（年は当年）
  m = /(?:^|\D)(\d{1,2})\/(\d{1,2})(?:\D|$)/.exec(t);
  if (m) return `${base.getFullYear()}/${pad(+m[1])}/${pad(+m[2])}`;

  return null;
}

// 期間を { from, to }（各 "YYYY/MM/DD"）で返す（取れなければ null）
export function parseRange(text, base = new Date()) {
  const t = (text || "").trim();
  if (!t) return null;
  const y = base.getFullYear();

  // 明示範囲: "A から B" / "A〜B"（区切りは から / 〜 / ～ / ~ / ー。/ や - は日付内なので除外）
  const parts = t.split(/\s*(?:から|〜|～|~|ー)\s*/);
  if (parts.length === 2) {
    const from = parseDate(parts[0], base);
    const to = parseDate(parts[1], base);
    if (from && to) return { from, to };
  }

  // N月 → その月の初日〜末日
  let m = /(\d{1,2})月/.exec(t);
  if (m) return monthRange(y, +m[1]);

  // 今月 / 先月 / 来月
  if (/今月/.test(t)) return monthRange(base.getFullYear(), base.getMonth() + 1);
  if (/先月/.test(t)) {
    const d = new Date(base.getFullYear(), base.getMonth() - 1, 1);
    return monthRange(d.getFullYear(), d.getMonth() + 1);
  }
  if (/来月/.test(t)) {
    const d = new Date(base.getFullYear(), base.getMonth() + 1, 1);
    return monthRange(d.getFullYear(), d.getMonth() + 1);
  }

  // 第N四半期（暦年基準: 1Q=1〜3月 …）
  m = /第?\s*([1-4１-４一二三四])\s*四半期/.exec(t);
  if (m) {
    const q = quarterNum(m[1]);
    const sm = (q - 1) * 3 + 1;
    return { from: `${y}/${pad(sm)}/01`, to: `${y}/${pad(sm + 2)}/${pad(lastDay(y, sm + 2))}` };
  }

  // 今年 / 本年
  if (/今年|本年/.test(t)) return { from: `${y}/01/01`, to: `${y}/12/31` };

  return null;
}
