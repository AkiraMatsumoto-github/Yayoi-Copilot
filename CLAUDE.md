# Yayoi Copilot — Claude Code コンテキスト

自然言語の指示で「弥生会計オンライン（やよいの青色申告 オンライン）」を操作する **Chrome拡張機能**。
詳細設計は [docs/design.md](docs/design.md) を参照。

## アーキテクチャ（要点）

操作の実体は **Chrome拡張**。バックエンドは **Claudeプロキシ** に徹する。

```
ユーザーのChrome
├── 弥生のタブ（操作対象）
├── サイドパネル（拡張UI: 指示入力・ログ）
└── background.js = エージェントループ
      1. chrome.scripting で画面のDOM＋本文を抽出
      2. POST localhost:8000/api/agent/next で次の操作を取得
      3. chrome.debugger で trusted なクリック/入力を実行
      → done まで繰り返す
            │ HTTP
            ▼
Python/FastAPI バックエンド（Claudeプロキシ）
```

## 技術スタック

- **拡張機能:** Chrome MV3（`chrome.sidePanel` / `chrome.scripting` / `chrome.debugger`）, 素のJavaScript（ビルド不要）
- **バックエンド:** Python 3.12 + FastAPI + Uvicorn（uv管理）
- **LLM:** Claude Sonnet 4.6（`claude-sonnet-4-6`） / Anthropic SDK
- **操作実行:** `chrome.debugger` の `Input.dispatchMouseEvent` / `Input.insertText`（trusted イベント）

## 重要な設計原則

- **本物のChromeで動かす。** これにより Akamai BotManager のbot検知も、ログイン（MFA含む）も通常どおり通る。認証情報の自動入力はしない。
- **鍵は拡張に渡さない。** `ANTHROPIC_API_KEY` はバックエンドのみが保持し、Claude問い合わせを代行する。
- **書き込み系は明示指示があるときだけ。** 読み取り・確認系では、ユーザーが指示しない限りデータの入力・変更・保存・削除を行わない（`ext_brain.py` のシステムプロンプトで制約）。
- Claudeには「操作可能な要素一覧」だけでなく **ページのタイトル・URL・本文テキスト** も渡す。これで「今どの画面か」「内容」を判断でき、ループを避けて done で報告できる。

## 主要ファイル

| パス | 役割 |
|---|---|
| `extension/manifest.json` | MV3マニフェスト（権限: sidePanel/scripting/debugger/tabs/storage） |
| `extension/sidepanel.html` `sidepanel.js` | サイドパネルUI（指示入力・実行・ログ表示） |
| `extension/background.js` | エージェントループ。DOM抽出・操作実行（chrome.debugger） |
| `backend/app.py` | FastAPI。`/api/agent/next` と `/api/health` |
| `backend/agent/ext_brain.py` | Claudeに次の1手を決めさせる頭脳（forced tool_use） |

## APIエンドポイント

- `POST /api/agent/next` — `{task, page:{url,title,text,elements}, history}` を受け取り、`{action:{thought, action, index?, text?, result?}}` を返す（action: click / input / scroll / done）
- `GET /api/health` — 死活確認

## コマンド

```bash
# バックエンド起動（拡張はこれに接続する）
PYTHONPATH=backend uv run uvicorn backend.app:app --port 8000

# 依存追加 / インストール
uv add <package>
uv sync
```

拡張機能は素のJSなのでビルド不要。`chrome://extensions` で `extension/` を読み込む（コード変更後は拡張の更新↻ボタン）。

## 開発時の注意

- `.env` は絶対にコミットしない（`.gitignore` 済み）。
- WSL開発時、Windows版Chromeは `/home/...` を直接読めない。`extension/` をCドライブ側にコピーして読み込む。
- `chrome.debugger` のアタッチ中は黄色い警告バーが出る（仕様）。閉じると操作が止まる。
