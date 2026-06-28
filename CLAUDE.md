# Yayoi Copilot — Claude Code コンテキスト

弥生会計オンラインをAI + Playwrightで自律操作するデスクトップアプリ。
詳細設計は [docs/design.md](docs/design.md) を参照。

## 技術スタック

- **フロントエンド:** Electron + TypeScript（コントロールパネルGUI）
- **バックエンド:** Python 3.12 + FastAPI + Uvicorn
- **ブラウザ制御:** browser-use `BrowserSession`（実Chrome / `channel="chrome"`）
- **AIエージェント:** browser-use（`browser_use.llm.anthropic.ChatAnthropic`）
- **LLM:** Claude Sonnet 4.6（Anthropic API）
- **パッケージマネージャ:** uv（pip不使用） / フロントは npm

## 重要な設計原則

- Playwright制御はノンブロッキングで実行し、人間の割り込みを常に許容する。
- AIの状態（IDLE / RUNNING / PAUSED）はバックエンドで一元管理し、フロントエンドはポーリングまたはWebSocket購読で同期する。
- セッションは `~/.yayoi-copilot/session` に永続化。弥生ログインは初回のみ**手動**（Akamai + MFA保護のため認証情報の自動入力はしない）。
- AIが操作するブラウザ（browser-useの実Chrome）と、Electronのコントロールパネルは**別ウィンドウ**。Electronは弥生画面を表示せず、バックエンドを操作するGUIに徹する。

## 主要ファイル

| パス | 役割 |
|---|---|
| `main.ts` | Electronメインプロセス・Pythonバックエンドのサブプロセス管理 |
| `index.html` | コントロールパネルUI（ステータス・入力・ボタン・ログ） |
| `renderer.ts` | UIイベント・API通信・ステータスポーリング |
| `backend/app.py` | FastAPIエントリポイント |
| `backend/agent/core.py` | Browser Use制御ロジック（LLM + Playwright） |

## APIエンドポイント（設計）

- `POST /api/execute` — プロンプト受信・エージェント起動
- `POST /api/pause` — AI操作の一時停止
- `POST /api/resume` — AI操作の再開
- `GET  /api/status` — 現在のAI状態取得（IDLE / RUNNING / PAUSED）

## コマンド

```bash
# Electronアプリ起動（ビルド → 起動。バックエンドは main.ts が自動でspawnする）
npm start

# バックエンドのみ起動（Electronを使わずcurl等で検証する場合）
PYTHONPATH=backend uv run uvicorn backend.app:app --reload

# フロントのビルド / ウォッチ
npm run build
npm run dev

# 依存関係追加
uv add <package>

# 依存関係インストール（クリーン環境）
uv sync
```

## 開発時の注意

- `.env` は絶対にコミットしない（`.gitignore` 済み）。
- Playwrightのセッションディレクトリ (`~/.yayoi-copilot/`) もgit管理外。
- Phase 1はElectronなしでPython単体スクリプトとして動作確認する。
