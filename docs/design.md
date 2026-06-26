# 弥生会計コパイロットブラウザ — 全体設計書

## 1. 背景と目的

「弥生会計オンライン」における日々の仕訳データ入力・既存レコードの修正作業は、依然として手動によるUI操作の負担が大きい。本プロジェクトは、音声またはテキストによる自然言語指示を理解し、ブラウザ上の弥生会計の画面を自律的に操作・編集できる、手動介入（Human-in-the-Loop）型の専用コパイロットブラウザを構築することを目的とする。

## 2. コアバリュー

- **シームレスな手動介入:** AIの自動操作中であっても、人間がいつでもマウス・キーボードで割り込んで操作可能。
- **自律的な画面認識:** 画面のDOM構造（HTML）やスクリーンショットをLLM（マルチモーダル）が直接解析し、既存レコードの特定や編集を柔軟に行う。
- **セッションの永続化:** 認証情報を安全にローカルに保持し、2回目以降の高速な起動を実現。

## 3. ターゲット・ユースケース

1. 「一覧の3番目の金額を2,000円に直して」などの音声指示による既存仕訳の修正。
2. 「昨日入れたアスクルの摘要を〇〇に変更して」などの曖昧な検索を伴うデータ編集。
3. AIがフォーム入力まで行い、最後の目視確認と「保存」ボタンのクリックは人間が行う協調ワークフロー。

---

## 4. システムアーキテクチャ

### 4.1 全体構成

```
┌─────────────────────────────────────────────────┐
│              Electron アプリ                     │
│  ┌──────────────────┐  ┌───────────────────────┐│
│  │  WebView (左)    │  │  Side Panel (右)      ││
│  │  弥生会計画面    │  │  ・プロンプト入力     ││
│  │  リアルタイム    │  │  ・音声マイク入力     ││
│  │  AI操作の視認    │  │  ・AIステータス表示   ││
│  │  手動割り込み可  │  │  ・一時停止/再開ボタン││
│  └──────────────────┘  └───────────────────────┘│
└──────────────────────┬──────────────────────────┘
                       │ HTTP / WebSocket
                       ▼
┌─────────────────────────────────────────────────┐
│             Python バックエンド                  │
│  FastAPI  →  AIエージェント  →  Playwright       │
│  (app.py)    (Browser Use)      (Chromium)      │
└─────────────────────────────────────────────────┘
```

### 4.2 フロントエンド (Electron / TypeScript)

| ファイル | 役割 |
|---|---|
| `main.ts` | ウィンドウ管理・Pythonプロセスの起動/終了 |
| `index.html` | 左右分割レイアウト定義 |
| `renderer.ts` | UIイベント処理・FastAPI通信・ステータス描画 |

### 4.3 バックエンド (Python / FastAPI)

| ファイル | 役割 |
|---|---|
| `backend/app.py` | HTTPエンドポイント (`/api/execute`, `/api/pause`, `/api/resume`) |
| `backend/agent/core.py` | Browser UseによるLLMエージェント制御・Playwright操作 |

---

## 5. データフロー（レコード編集時のシーケンス）

```
User (音声/テキスト入力)
  │
  ▼
renderer.ts
  │  POST /api/execute { "prompt": "3行目の摘要を修正して" }
  ▼
app.py (FastAPI)
  │
  ▼
agent/core.py (Browser Use起動)
  │  DOM/スクリーンショット取得
  │  LLMが対象要素を特定
  │
  ▼
Playwright
  │  編集ボタンクリック → 入力欄書き換え
  │
  ▼
WebView画面に変更反映 → User確認 → 保存
```

---

## 6. Human-in-the-Loop 制御設計

### 6.1 ステートマシン

```
IDLE ──[指示受信]──► RUNNING
                        │
              [一時停止 / 判断不能]
                        │
                        ▼
                     PAUSED ──[再開]──► RUNNING
                        │
                     [キャンセル]
                        ▼
                      IDLE
```

### 6.2 状態ごとの動作

| 状態 | UI | バックエンド |
|---|---|---|
| IDLE | 入力欄アクティブ | 待機中 |
| RUNNING | 「操作中」バッジ表示・入力ロック | Playwright実行中（ノンブロッキング） |
| PAUSED | 「手動介入受付中」バッジ・再開ボタン表示 | `asyncio.Event().wait()` で凍結 |

### 6.3 MFA（二段階認証）対応

- 初回ログイン時にMFAが発生すると自動的に **PAUSED** へ遷移。
- `page.wait_for_selector("[data-mfa-complete]")` で人間の認証完了を待機。
- 認証後、セッションはローカルユーザーデータディレクトリに永続化。

---

## 7. セッション永続化

Playwrightの `launch_persistent_context` を使用し、ユーザーデータディレクトリ（`~/.yayoi-copilot/session`）にCookieとセッションを保存する。2回目以降の起動では自動ログイン状態から開始される。

```python
context = await playwright.chromium.launch_persistent_context(
    user_data_dir="~/.yayoi-copilot/session",
    headless=False,
)
```

---

## 8. 環境変数 (`.env`)

| 変数名 | 用途 |
|---|---|
| `YAYOI_EMAIL` | 弥生会計ログインメールアドレス |
| `YAYOI_PASSWORD` | 弥生会計ログインパスワード |
| `OPENAI_API_KEY` | GPT-4o用APIキー |
| `GEMINI_API_KEY` | Gemini用APIキー（オプション） |

---

## 9. 開発ロードマップ

### Phase 1 — MVP検証（Python単体）

- `backend/agent/core.py` でBrowser Use + Playwright単体動作確認。
- 弥生会計のログイン・特定の仕訳編集・セッション永続化の精度を検証。

### Phase 2 — アプリ化（Electron連携）

- Electronウィンドウ（左: WebView / 右: Side Panel）の構築。
- FastAPI `/api/execute` エンドポイントとの HTTP 通信確立。
- AIステータス（IDLE / RUNNING / PAUSED）のUI反映。

### Phase 3 — 協調ワークフロー洗練

- 手動一時停止・MFA手動解除待ちロジックの実装。
- DOMエラー時のリトライ・例外処理。
- 音声入力（Web Speech API）の統合。
