# Yayoi Copilot — Claude Code コンテキスト

弥生会計オンラインをAI + Playwrightで自律操作するデスクトップアプリ。
詳細設計は [docs/design.md](docs/design.md) を参照。

## 技術スタック

- **フロントエンド:** Electron + TypeScript
- **バックエンド:** Python 3.11 + FastAPI + Uvicorn
- **ブラウザ制御:** Playwright (`launch_persistent_context`)
- **AIエージェント:** browser-use + LangChain
- **LLM:** GPT-4o（メイン）/ Gemini 1.5 Pro（サブ）

## 重要な設計原則

- Playwright制御はノンブロッキングで実行し、人間の割り込みを常に許容する。
- AIの状態（IDLE / RUNNING / PAUSED）はバックエンドで一元管理し、フロントエンドはポーリングまたはWebSocket購読で同期する。
- セッションは `~/.yayoi-copilot/session` に永続化。`.env` のパスワードは初回ログインにのみ使用する。

## 主要ファイル

| パス | 役割 |
|---|---|
| `main.ts` | Electronメインプロセス・Pythonプロセス管理 |
| `index.html` | 左右分割レイアウト |
| `renderer.ts` | UIイベント・API通信 |
| `backend/app.py` | FastAPIエントリポイント |
| `backend/agent/core.py` | Browser Use制御ロジック（LLM + Playwright） |

## APIエンドポイント（設計）

- `POST /api/execute` — プロンプト受信・エージェント起動
- `POST /api/pause` — AI操作の一時停止
- `POST /api/resume` — AI操作の再開
- `GET  /api/status` — 現在のAI状態取得（IDLE / RUNNING / PAUSED）

## 開発時の注意

- `.env` は絶対にコミットしない（`.gitignore` 済み）。
- Playwrightのセッションディレクトリ (`~/.yayoi-copilot/`) もgit管理外。
- Phase 1はElectronなしでPython単体スクリプトとして動作確認する。
