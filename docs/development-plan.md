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
- **セッション永続化の落とし穴と対策**：browser_use 0.13.1 は Chrome の `user_data_dir` を
  一時ディレクトリにコピーして使い書き戻さないため、通常のパスだと毎回ログインが必要になる。
  ディレクトリ名に `browser-use-user-data-dir-` を含めるとコピーをスキップして直接使うため、
  `SESSION_DIR` をこの名前にすることで永続化を実現（1回ログインすれば以降スキップ。実機確認済み）。
- 操作対象の弥生製品は **「やよいの青色申告 オンライン」**（マイポータルのトップから入る）。
  仕訳は レポート・帳簿 → 仕訳帳 で一覧表示できる。

### 実機検証の結果（2026-06-28）
- **画面遷移＋読み取りタスクが実機で成功**。
  - 例1: マイポータルの「契約管理」を開いて内容を報告（5ステップ）。サブメニュー展開型のUIに
    自己修正しながら到達。
  - 例2: 「やよいの青色申告 オンライン」→ 仕訳帳 を開き、**実データの仕訳11件を正確に読み取り**
    （取引番号・日付・摘要・借方/貸方勘定科目・金額）。読み取り専用の制約も遵守。
  - 複雑な仕訳グリッドの**読み取り精度は実用レベル**であることを確認。書き換え操作は未検証。

### 完了済み（追加）
- [x] **Electron コントロールパネル実装**（`main.ts` でバックエンドをspawn、`index.html` + `renderer.ts` でステータス・実行・一時停止・再開・ログ表示）
- [x] CORS設定（`file://` オリジンからのfetch許可）
- [x] ERROR状態の追加（例外時に `ERROR` へ遷移し、GUIに赤バッジ表示）
- [x] **操作ステップの観察ログ**（`register_new_step_callback` で各ステップのnext_goal/actionを収集、`/api/log` で取得、GUIに表示）
- [x] **セッション永続化の修正**（`SESSION_DIR` 名で temp-copy を回避。1回ログインで以降スキップを実機確認）
- [x] **読み取りタスクの実機検証成功**（契約管理の閲覧／仕訳帳11件の正確な読み取り）

### 未着手
- [ ] 実操作タスクの検証（仕訳の検索・修正）
- [ ] エラーハンドリングの拡充（リトライ・DOM要素未検出時のPAUSED遷移）
- [ ] WebSocketによるリアルタイム状態同期（現状は2秒ポーリング）
- [ ] 操作ログのリアルタイム表示（browser-useコールバック連携）
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

### ⚠ アーキテクチャ変更（重要）

当初は「左: 弥生WebView / 右: Side Panel」を想定していたが、実際には
**browser-use が独自の実Chromeウィンドウを起動**する（手動ログインするのもこの画面）。
ElectronのWebViewとbrowser-useのChromeはセッションも別で、WebViewにAI操作は反映されない。

→ **Electron はコントロールパネルGUIに徹する**方針へ変更。
AIが操作するChromeは別ウィンドウとして表示し、ユーザーはそちらを見る。
ElectronはFastAPIバックエンドを起動・操作し、ステータスとログを表示する。

### Step 2-1: Electronメインプロセス（`main.ts`）の実装 ✅ 完了

```
main.ts の責務：
- BrowserWindow（コントロールパネル）の生成
- アプリ起動時に Python バックエンドを spawn（uv run uvicorn）
- アプリ終了時にバックエンドを kill
```

実装済みポイント：
- `child_process.spawn("uv", ["run","uvicorn","backend.app:app",...])` を `PYTHONPATH=backend` 付きで起動
- `window-all-closed` / `before-quit` でバックエンドを確実に終了
- コンパイル出力は `dist/`、`PROJECT_ROOT = __dirname/..` でルートの `index.html` をロード

### Step 2-2: コントロールパネル UI の仕上げ ✅ 完了

| 要素 | 実装状況 |
|---|---|
| プロンプト入力欄 | ✅ テキストエリア + 実行ボタン |
| ステータスバッジ | ✅ IDLE（灰） / RUNNING（緑） / PAUSED（黄） / ERROR（赤） |
| 一時停止・再開ボタン | ✅ 状態に応じて活性/非活性・表示切替 |
| 操作ログ | ✅ 状態遷移・実行指示をクライアント側でログ表示（browser-useのアクション履歴連携はStep 3-1で対応） |

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
