// マイク許可専用ページ。サイドパネル（chrome-extension:// ）では getUserMedia の
// 許可プロンプトが出せないため、同一オリジンの通常タブでここから許可を取得する。
// 許可は拡張オリジン全体で共有され、以後サイドパネルの音声認識も動作する。

const allowBtn = document.getElementById("allow");
const resultEl = document.getElementById("result");

allowBtn.addEventListener("click", async () => {
  resultEl.textContent = "";
  resultEl.className = "";
  allowBtn.disabled = true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    // 許可確認だけが目的なので、取得したトラックは即停止する。
    stream.getTracks().forEach((t) => t.stop());
    resultEl.textContent = "✓ 許可されました。このタブを閉じて、サイドパネルのマイクを押してください。";
    resultEl.className = "ok";
    allowBtn.textContent = "許可済み";
    // 少し見せてから自動で閉じる。
    setTimeout(() => window.close(), 2500);
  } catch (err) {
    allowBtn.disabled = false;
    resultEl.className = "ng";
    if (err && (err.name === "NotAllowedError" || err.name === "SecurityError")) {
      resultEl.textContent =
        "許可がブロックされています。アドレスバー左のアイコン→サイトの設定でマイクを「許可」にしてください。";
    } else if (err && err.name === "NotFoundError") {
      resultEl.textContent = "マイクが見つかりませんでした。接続を確認してください。";
    } else {
      resultEl.textContent = "マイクを起動できませんでした（" + (err && err.name) + "）。";
    }
  }
});
