import { app, BrowserWindow } from "electron";
import { spawn, ChildProcess } from "child_process";
import path from "path";

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;

// コンパイル後 main.js は dist/ に出力されるため、プロジェクトルートは1つ上。
const PROJECT_ROOT = path.join(__dirname, "..");

function startBackend(): void {
  // uv 経由で FastAPI を起動。PYTHONPATH=backend で agent モジュールを解決する。
  backendProcess = spawn(
    "uv",
    ["run", "uvicorn", "backend.app:app", "--port", "8000"],
    {
      cwd: PROJECT_ROOT,
      env: { ...process.env, PYTHONPATH: "backend" },
      stdio: "inherit",
    }
  );

  backendProcess.on("error", (err) => {
    console.error("バックエンド起動失敗:", err);
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 480,
    height: 720,
    title: "Yayoi Copilot",
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadFile(path.join(PROJECT_ROOT, "index.html"));

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  startBackend();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

function shutdown(): void {
  if (backendProcess) {
    backendProcess.kill();
    backendProcess = null;
  }
}

app.on("window-all-closed", () => {
  shutdown();
  app.quit();
});

app.on("before-quit", shutdown);
