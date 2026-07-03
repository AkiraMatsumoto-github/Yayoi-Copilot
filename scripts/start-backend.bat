@echo off
chcp 65001 >nul
title 弥生会計コパイロット バックエンド
echo ============================================
echo   弥生会計コパイロット バックエンド起動中
echo   （この窓を閉じると停止します）
echo ============================================
echo.

REM 既に8000番で起動済みなら二重起動しない（前回の窓が残っている場合など）
wsl.exe bash -lc "curl -s --max-time 2 http://localhost:8000/api/health >/dev/null 2>&1"
if %errorlevel%==0 (
  echo すでにバックエンドが起動しています（http://localhost:8000）。
  echo この窓は閉じて構いません。
  echo.
  pause
  exit /b 0
)

REM WSL上でバックエンドを起動（uvicorn がこの窓を占有＝実行中）
wsl.exe bash -lc "cd /home/yahoo/development/yayoi-copilot && PYTHONPATH=backend uv run uvicorn backend.app:app --port 8000"

echo.
echo バックエンドが停止しました。この窓を閉じてください。
pause
