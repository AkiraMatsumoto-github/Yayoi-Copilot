# Yayoi Copilot — 弥生会計コパイロット

自然言語の指示で「弥生会計オンライン（やよいの青色申告 オンライン）」を操作する **Chrome拡張機能**。
ユーザー自身の本物のChrome上で動くため、Akamai BotManager のbot検知もログイン（MFA含む）も通常どおり通る。

## アーキテクチャ

```
┌──────────────── ユーザーの Chrome ────────────────┐
│  弥生会計のタブ          サイドパネル（拡張UI）   │
│  （操作対象）            ・指示入力 / 実行ボタン  │
│                          ・実行ログ表示          │
│                                                  │
│  background.js（サービスワーカー）= エージェント  │
│   1. chrome.scripting で画面のDOM＋本文を抽出     │
│   2. バックエンドに次の操作を問い合わせ          │
│   3. chrome.debugger で trusted なクリック/入力   │
│   …done まで繰り返す                             │
└────────────────────────┬─────────────────────────┘
                         │ HTTP (localhost:8000)
                         ▼
┌──────────── Python バックエンド ─────────────────┐
│  FastAPI = Claudeプロキシ（鍵を拡張に渡さない）   │
│  POST /api/agent/next → Claude が次の1手を決定    │
└──────────────────────────────────────────────────┘
```

- **操作の実体は拡張機能**（`chrome.debugger` の Input イベント＝OS由来と同等の trusted な操作）。
- **バックエンドは軽量プロキシ**。`ANTHROPIC_API_KEY` を保持し、Claude への問い合わせのみ代行する。拡張は鍵を一切持たない。
- ログインは初回・以降ともユーザーが普段どおり手動で行う（認証情報の自動入力はしない）。

## ディレクトリ構成

```
yayoi-copilot/
├── extension/                # Chrome拡張（MV3）
│   ├── manifest.json
│   ├── sidepanel.html / .js  # サイドパネルUI（指示入力・ログ）
│   └── background.js         # エージェントループ（抽出→問い合わせ→操作）
├── backend/
│   ├── app.py                # FastAPI（/api/agent/next）
│   └── agent/
│       └── ext_brain.py      # Claudeに次の操作を決めさせる頭脳
├── docs/design.md
├── pyproject.toml            # Python依存（uv管理）
└── .env                      # ANTHROPIC_API_KEY（コミット禁止）
```

## セットアップ

### 前提
- Python 3.12+ / [uv](https://docs.astral.sh/uv/)
- Google Chrome

### 1. バックエンドを起動

```bash
cp .env.example .env          # ANTHROPIC_API_KEY を記入
uv sync
PYTHONPATH=backend uv run uvicorn backend.app:app --port 8000
```

### 2. 拡張機能を読み込む

1. `chrome://extensions` を開き「デベロッパーモード」をON
2. 「パッケージ化されていない拡張機能を読み込む」→ `extension/` フォルダを選択
   - ※ WSLで開発している場合、`/home/...` のパスはWindows版Chromeから直接読めない。`extension/` をWindows側（例: `C:\Users\<user>\yayoi-copilot-extension`）にコピーしてそこを指定する

### 3. 使う

1. やよいの青色申告オンラインにログイン
2. ツールバーの拡張アイコンをクリック → サイドパネルが開く
3. 弥生のタブをアクティブにして指示を入力 → 「実行」
   - 例: 「契約管理を開いて内容を報告して」「仕訳帳を開いて最近の仕訳を5件報告して」

> ⚠ 実行中は「拡張機能がこのブラウザをデバッグしています」という黄色いバーが出る（`chrome.debugger` を使うため）。閉じると操作が止まる。

## 設計上の原則

- **書き込み系は明示指示があるときだけ。** 読み取り・確認系はユーザーが指示しない限りデータの入力・変更・保存・削除を行わない（`ext_brain.py` のシステムプロンプトで制約）。
- `.env` は絶対にコミットしない。

詳細は [docs/design.md](docs/design.md) を参照。
