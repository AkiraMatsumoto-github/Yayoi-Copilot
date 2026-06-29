"""Chrome拡張版のエージェント頭脳。

拡張機能（コンテンツスクリプト）が抽出した「番号付きの操作可能要素」と
タスク・操作履歴を受け取り、Claude に「次の1手」を決めさせて返す。
ブラウザ操作そのものは拡張機能側（chrome.debugger）が実行する。
"""

import os
from pathlib import Path

from anthropic import Anthropic
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent.parent / ".env")

MODEL = "claude-sonnet-4-6"

client = Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

# Claude に「次の操作」を構造化して返させるためのツール定義。
ACTION_TOOL = {
    "name": "browser_action",
    "description": "弥生会計の画面に対して次に実行する操作を1つだけ返す。",
    "input_schema": {
        "type": "object",
        "properties": {
            "thought": {
                "type": "string",
                "description": "現在の画面状態の判断と、次に何をすべきかの簡潔な理由。",
            },
            "action": {
                "type": "string",
                "enum": ["click", "input", "scroll", "done"],
                "description": "click=要素をクリック, input=要素に文字入力, scroll=スクロール, done=タスク完了。",
            },
            "index": {
                "type": "integer",
                "description": "操作対象の要素番号（click / input のとき必須）。",
            },
            "text": {
                "type": "string",
                "description": "入力する文字列（input のとき必須）。",
            },
            "result": {
                "type": "string",
                "description": "done のとき、ユーザーへの報告内容。",
            },
        },
        "required": ["thought", "action"],
    },
}

SYSTEM_PROMPT = """あなたは弥生会計オンライン（やよいの青色申告 オンライン）を操作するエージェントです。
ユーザーの指示を達成するため、与えられた「現在の画面」（ページ名・本文・操作可能な要素一覧）を見て、
次に実行すべき操作を1つだけ browser_action ツールで返してください。

判断のしかた:
- まず「現在の画面の本文」を読み、今どの画面にいるか・タスクに必要な情報が既に表示されているかを判断する。
- 要素は [番号] tag "テキスト" の形式。操作対象は必ずこの番号で指定する。
- 一覧に目的の要素が無ければ scroll で探す。
- 弥生のメニュー名は指示と完全一致しないことがある（例: 「契約管理」→ 実際は「契約詳細」）。
  意味的に最も近い要素を選ぶこと。

完了の判断（重要）:
- 読み取り・確認系のタスクは、必要な情報が「現在の画面の本文」に出ていれば、それ以上クリックせず
  すぐ done を返し、result にその内容を日本語で具体的に報告する。
- 「これまでの操作」を見て、同じ要素を何度も押して画面を行き来している（ループしている）と気づいたら、
  それ以上同じ操作を繰り返さず、今見えている情報で done を返して状況を報告する。

【最重要】ユーザーが明示的に指示しない限り、データの入力・変更・保存・削除は行わないこと。
読み取り・画面遷移のみで完了できるタスクは、操作後すぐ done で報告すること。
"""


def _format_elements(elements: list[dict]) -> str:
    lines = []
    for el in elements:
        idx = el.get("index")
        tag = el.get("tag", "")
        label = (el.get("text") or el.get("value") or el.get("placeholder") or "").strip()
        label = label.replace("\n", " ")[:80]
        extra = f' type={el["type"]}' if el.get("type") else ""
        lines.append(f'[{idx}] {tag}{extra} "{label}"')
    return "\n".join(lines) if lines else "(操作可能な要素が見つかりません)"


def next_action(task: str, page: dict, history: list[dict]) -> dict:
    """次の操作を決定して dict で返す。

    page: {"url", "title", "text", "elements"} 拡張が抽出した現在の画面状態。
    """
    page = page or {}
    elements = page.get("elements", [])
    body_text = (page.get("text") or "").strip()
    if len(body_text) > 4000:
        body_text = body_text[:4000] + "…(以下省略)"

    history_text = ""
    if history:
        parts = []
        for h in history[-10:]:
            parts.append(f'- {h.get("action")} {h.get("index", "")} {h.get("text", "")}'.rstrip())
        history_text = "これまでの操作:\n" + "\n".join(parts) + "\n\n"

    user_content = (
        f"タスク: {task}\n\n"
        f"{history_text}"
        f"現在の画面: {page.get('title', '')}\n"
        f"URL: {page.get('url', '')}\n\n"
        f"現在の画面の本文:\n{body_text or '(本文を取得できませんでした)'}\n\n"
        f"操作可能な要素:\n{_format_elements(elements)}\n\n"
        "次に実行する操作を1つ、browser_action ツールで返してください。"
    )

    message = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        system=SYSTEM_PROMPT,
        tools=[ACTION_TOOL],
        tool_choice={"type": "tool", "name": "browser_action"},
        messages=[{"role": "user", "content": user_content}],
    )

    for block in message.content:
        if block.type == "tool_use" and block.name == "browser_action":
            return block.input

    # ツール呼び出しが返らなかった場合のフォールバック
    return {"thought": "操作を決定できませんでした", "action": "done", "result": "操作を決定できませんでした。"}
