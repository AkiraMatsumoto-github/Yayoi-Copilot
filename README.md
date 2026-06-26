# Yayoi Copilot — 弥生会計コパイロットブラウザ

音声/テキスト指示で弥生会計オンラインを自律操作する、Human-in-the-Loop型のデスクトップコパイロット。

## 技術スタック

| レイヤー | 技術 |
|---|---|
| フロントエンド | Electron + TypeScript |
| バックエンド | Python + FastAPI |
| ブラウザ制御 | Playwright (`launch_persistent_context`) |
| AIエージェント | Browser Use + LangChain |
| LLM | GPT-4o / Gemini 1.5 Pro（マルチモーダル） |

## ディレクトリ構成

```
yayoi-copilot/
├── .env.example          # 環境変数テンプレート
├── .gitignore
├── package.json          # Electron依存関係
├── tsconfig.json
├── main.ts               # Electronメインプロセス
├── index.html            # 左: WebView / 右: Side Panel
├── renderer.ts           # UIイベント・FastAPI通信
├── docs/
│   └── design.md         # 全体設計書（詳細）
├── CLAUDE.md             # Claude Code用コンテキスト
└── backend/
    ├── requirements.txt
    ├── app.py            # FastAPIエントリポイント
    └── agent/
        ├── __init__.py
        └── core.py       # Browser Use / Playwright制御ロジック
```

## セットアップ

### 前提条件

- Node.js 20+
- Python 3.11+
- Playwright Chromium

### インストール

```bash
# Electronフロントエンド
npm install

# Pythonバックエンド
cd backend
pip install -r requirements.txt
playwright install chromium
```

### 環境変数

```bash
cp .env.example .env
# .envにYayoiのID/PW、LLMのAPIキーを記入
```

### 起動

```bash
# バックエンド（別ターミナル）
cd backend && uvicorn app:app --port 8000

# Electronフロントエンド
npm start
```

## 開発フェーズ

| Phase | 内容 | 状態 |
|---|---|---|
| Phase 1 | Python単体でBrowser Use + Playwright動作検証 | 未着手 |
| Phase 2 | Electron + FastAPI連携（IPC/HTTP通信） | 未着手 |
| Phase 3 | 手動介入・MFA待機・例外処理の実装 | 未着手 |

## ドキュメント

詳細な設計・アーキテクチャは [docs/design.md](docs/design.md) を参照。
