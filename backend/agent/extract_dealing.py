"""かんたん取引入力（取引の登録）向けの構造化抽出。

自然文の指示（例: 「5月30日に消耗品費を三井住友のクレジットカードで6800円払った」）を
弥生の入力欄に対応する項目へ構造化する。入力そのものは拡張側がラベル基点で決定的に行う
ため、ここでは「どの欄に何を入れるか」だけを Claude に決めさせる。

出力は拡張の setFieldValue が扱える形にする:
  ・取引日 は YYYY/MM/DD（相対表現は当日基準で解決）
  ・取引手段 は候補に部分一致する最小の識別語（例: 現金 / 三井住友 / 楽天）
  ・金額 は数値（カンマ無し）
"""

import datetime
import os
from pathlib import Path

from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent / ".env")

MODEL = "claude-sonnet-4-6"

client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

DEALING_TOOL = {
    "name": "dealing_fields",
    "description": "かんたん取引入力の登録に使う項目を、指示文から構造化して返す。",
    "input_schema": {
        "type": "object",
        "properties": {
            # プロパティ名は ASCII 必須（Anthropic の制約）。値の中身は日本語でよい。
            "kubun": {
                "type": "string",
                "enum": ["収入", "支出", "振替"],
                "description": "区分。収入=売上・入金、支出=経費・支払い、振替=口座間移動。明示が無ければ支出。",
            },
            "date": {
                "type": "string",
                "description": "取引日。YYYY/MM/DD 形式。『昨日』『5月30日』等の相対・省略表現は当日基準で解決する。",
            },
            "account": {
                "type": "string",
                "description": "勘定科目名（例: 消耗品費 / 通信費 / 売上高）。指示の語をそのまま。",
            },
            "method": {
                "type": "string",
                "description": "取引手段。候補に部分一致する最小の識別語。例: 現金 / 三井住友 / 楽天 / 普通預金。カード名や銀行名はブランド語だけにする。",
            },
            "amount": {
                "type": "integer",
                "description": "金額（円、カンマ無しの整数）。",
            },
            "summary": {
                "type": "string",
                "description": "任意。摘要（取引の内容メモ）。指示に無ければ省略。",
            },
            "partner": {
                "type": "string",
                "description": "任意。取引先名。指示に無ければ省略。",
            },
        },
        "required": ["kubun", "date", "account", "method", "amount"],
    },
}


def extract_dealing(task: str) -> dict:
    """指示文から取引項目を構造化して返す。必須が欠ける場合もそのまま返す（拡張側で判定）。"""
    today = datetime.date.today()
    system = (
        "あなたは弥生会計の入力アシスタントです。ユーザーの取引指示を、"
        "かんたん取引入力の各欄に対応する項目へ構造化してください。\n"
        f"本日の日付は {today:%Y/%m/%d}（{'月火水木金土日'[today.weekday()]}曜日）です。"
        "相対表現（今日・昨日・先週など）はこれを基準に解決してください。\n"
        "取引手段は入力欄の候補に部分一致させるため、ブランド語など最小の識別語にしてください"
        "（例: 『三井住友VISAカードで』→『三井住友』、『楽天カード』→『楽天』）。"
    )
    message = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=system,
        tools=[DEALING_TOOL],
        tool_choice={"type": "tool", "name": "dealing_fields"},
        messages=[{"role": "user", "content": f"取引の指示: {task}"}],
    )
    for block in message.content:
        if block.type == "tool_use" and block.name == "dealing_fields":
            return block.input
    return {}
