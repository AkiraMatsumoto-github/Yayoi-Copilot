import { app, BrowserWindow } from "electron";
import { spawn, ChildProcess } from "child_process";
import path from "path";

let mainWindow: BrowserWindow | null = null;
let backendProcess: ChildProcess | null = null;

function startBackend(): void {
  const backendPath = path.join(__dirname, "backend", "app.py");
  backendProcess = spawn("uvicorn", ["app:app", "--port", "8000"], {
    cwd: path.join(__dirname, "backend"),
    stdio: "inherit",
  });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
    },
  });

  mainWindow.loadFile("index.html");
}

app.whenReady().then(() => {
  startBackend();
  createWindow();
});

app.on("window-all-closed", () => {
  if (backendProcess) backendProcess.kill();
  app.quit();
});
