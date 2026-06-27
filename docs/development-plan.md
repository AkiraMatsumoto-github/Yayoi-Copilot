# 弥生会計コパイロット — 開発計画

## 現在の状態（2026-06-27時点）

### 完了済み
- [x] プロジェクト構成・ディレクトリ作成
- [x] FastAPI バックエンド骨格（`/api/execute`, `/api/pause`, `/api/resume`, `/api/status`）
- [x] `YayoiAgent` クラス（IDLE / RUNNING / PAUSED ステートマシン）
- [x] セッション永続化（`BrowserSession(user_data_dir=...)`）
- [x] Claude Sonnet 4.6（`browser_use.llm.anthropic.ChatAnthropic`）への LLM 切り替え
- [x] uv による依存関係管理（`pyproject.toml` + `uv.lock`）
- [x] バックエンド起動確認（`/api/status` → `{"status":"IDLE"}` 応答）
- [x] Playwright Chromium インストール
- [x] **Akamai BotManager の回避**（実Chrome + `navigator.webdriver` 隠蔽）
- [x] **手動ログイン方式の確立**（ログイン画面検出 → PAUSED → 手動ログイン → resume）
- [x] **弥生会計への実接続成功**（マイポータルのホーム画面をエージェントが認識・情報抽出）

### 検証で判明した重要事項
- 弥生ログインは **Akamai + MFA** 保護のため、認証情報の自動入力は不採用。
- `channel="chrome"`（実Chrome）が必須。Playwright標準Chromiumはブロックされる。
- browser_use の `page.evaluate` は Akamai のアンチボットJSと干渉して遅延するため多用しない。
- セッション永続化により2回目以降はログイン不要。

### 未着手
- [ ] 実操作タスクの検証（仕訳の検索・修正）
- [ ] エラーハンドリング（リトライ・ERROR状態）
- [ ] Electron フロントエンド実装
- [ ] 音声入力

---

## Phase 1 — Python単体での動作検証

**ゴール:** ElectronなしでAIエージェントが弥生会計を実際に操作できることを確認する。

### Step 1-1: Playwright セットアップ ✅ 完了

```bash
uv run playwright install chromium
```

### Step 1-2: 手動ログイン + セッション保存の確認 ✅ 完了

`backend/agent/core.py` の `_wait_for_manual_login` により、ログイン画面検出時に
PAUSED へ遷移し、ユーザーの手動ログイン完了を `/api/resume` で待つ。
`~/.yayoi-copilot/session` にセッションが永続化され、2回目以降はスキップされる。

確認済みの観点：
- [x] 初回起動でログイン画面を検出し PAUSED へ遷移
- [x] 手動ログイン（MFA含む）後、resume でエージェント起動
- [x] ログイン済みセッションでマイポータルのホーム画面を認識

### Step 1-3: シンプルなタスクで browser-use 動作確認 ✅ 基本動作確認済み

FastAPI を直接 curl で叩き、エージェントが弥生会計を操作できるか確認する。

```bash
# ターミナル1: バックエンド起動
PYTHONPATH=backend uv run uvicorn backend.app:app --reload

# ターミナル2: タスク送信
curl -X POST http://localhost:8000/api/execute \
  -H "Content-Type: application/json" \
  -d '{"prompt": "売上高の一覧画面を開いて"}'

# ステータス確認
curl http://localhost:8000/api/status
```

検証するタスク（難易度順）：
1. 特定の画面への遷移（「売上高の一覧を開いて」）
2. 既存仕訳の検索（「アスクルの仕訳を探して」）
3. 値の書き換え（「3行目の金額を2000円に修正して」）

### Step 1-4: エラーハンドリングの実装

現状の `core.py` はエラー発生時に例外がそのまま上がる。以下を追加する：

- タイムアウト時のリトライ（最大3回）
- DOM要素が見つからない場合の PAUSED 遷移（人間に判断を委ねる）
- `status` への `ERROR` 状態追加

```python
# 追加するステート
"ERROR"  # リトライ上限到達・致命的エラー時
```

---

## Phase 2 — Electron フロントエンド実装

**ゴール:** デスクトップアプリとして、左に弥生会計WebView・右にコントロールパネルが表示される。

### Step 2-1: Electronメインプロセス（`main.ts`）の実装

```
main.ts の責務：
- BrowserWindow の生成（左: WebView / 右: Side Panel）
- アプリ起動時に Python バックエンドをサブプロセスとして起動
- アプリ終了時にバックエンドを終了
```

実装ポイント：
- `child_process.spawn` で `uv run uvicorn ...` を起動
- バックエンドの Ready 確認（`/api/status` へのポーリング）
- WebView の `partition` を設定してセッションをElectronと分離

### Step 2-2: Side Panel UI の仕上げ

現状の `index.html` + `renderer.ts` はスケルトン状態。以下を実装：

| 要素 | 実装内容 |
|---|---|
| プロンプト入力欄 | テキストエリア + 送信ボタン |
| ステータスバッジ | IDLE（灰） / RUNNING（緑・アニメ） / PAUSED（黄） / ERROR（赤） |
| 一時停止・再開ボタン | RUNNING時のみ停止表示、PAUSED時のみ再開表示 |
| 操作ログ | エージェントのアクション履歴をリアルタイム表示 |

### Step 2-3: WebSocket によるリアルタイム状態同期

現状はポーリング（2秒間隔）。WebSocket に切り替えてラグをなくす。

```python
# backend/app.py に追加
from fastapi import WebSocket

@app.websocket("/ws/status")
async def ws_status(websocket: WebSocket):
    await websocket.accept()
    while True:
        await websocket.send_json({"status": agent.status})
        await asyncio.sleep(0.5)
```

---

## Phase 3 — 協調ワークフローの洗練

**ゴール:** 実業務で使えるレベルの信頼性と UX を実現する。

### Step 3-1: 操作ログのリアルタイム表示

browser-use のコールバックを受け取り、エージェントが何をしているか Side Panel に表示する。

```python
from browser_use.agent.views import AgentHistoryList

async def on_step(step):
    # WebSocket でフロントエンドへ送信
    await broadcast({"type": "step", "action": step.action, "result": step.result})
```

### Step 3-2: 音声入力（Web Speech API）

`renderer.ts` に音声入力ボタンを追加。ブラウザの `SpeechRecognition` API を使用する（Chromiumベースなので対応済み）。

```typescript
const recognition = new webkitSpeechRecognition();
recognition.lang = 'ja-JP';
recognition.onresult = (e) => {
    promptInput.value = e.results[0][0].transcript;
};
```

### Step 3-3: 確認ステップの導入

リスクの高い操作（削除・上書き）の前に人間の確認を挟む。

```
エージェントが「保存」を実行しようとする
  → PAUSED へ遷移
  → Side Panel に「この内容で保存しますか？」表示
  → ユーザーが「確認」→ RUNNING に戻り保存実行
  → ユーザーが「キャンセル」→ IDLE に戻る
```

### Step 3-4: プロンプトテンプレート

よく使う操作をワンクリックで実行できるテンプレートボタン：

- 「仕訳一覧を開く」
- 「今月の売上を確認する」
- 「前回の入力を修正する」

---

## 優先順位と目安スケジュール

| Phase | ステップ | 優先度 | 目安工数 |
|---|---|---|---|
| 1 | Step 1-1: Playwright インストール | 最高 | 10分 |
| 1 | Step 1-2: ログイン・セッション確認 | 最高 | 1〜2時間 |
| 1 | Step 1-3: タスク実行動作確認 | 最高 | 半日〜1日 |
| 1 | Step 1-4: エラーハンドリング | 高 | 半日 |
| 2 | Step 2-1: Electron main.ts | 高 | 半日 |
| 2 | Step 2-2: Side Panel UI | 高 | 半日 |
| 2 | Step 2-3: WebSocket | 中 | 2時間 |
| 3 | Step 3-1: 操作ログ表示 | 中 | 2時間 |
| 3 | Step 3-2: 音声入力 | 低 | 2時間 |
| 3 | Step 3-3: 確認ステップ | 中 | 半日 |
| 3 | Step 3-4: テンプレート | 低 | 2時間 |

---

## 次にやること（即座に着手可能）

```bash
# 1. Playwright Chromium インストール
uv run playwright install chromium

# 2. バックエンド起動
PYTHONPATH=backend uv run uvicorn backend.app:app --reload

# 3. 実際に弥生会計へのログインを試す
curl -X POST http://localhost:8000/api/execute \
  -H "Content-Type: application/json" \
  -d '{"prompt": "弥生会計にログインして売上帳を開いて"}'
```
