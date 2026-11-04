const { app, BrowserWindow, ipcMain, shell } = require("electron");
const path = require("path");
const isDev = !app.isPackaged;
const { spawn } = require("child_process");

let win, srv;

function startSrv() {
  const py = process.env.LUMINA_PYTHON || (require("fs").existsSync("v/Scripts/python.exe") ? "v/Scripts/python.exe" : "python");
  srv = spawn(path.normalize(py), ["server.py"], { stdio: "inherit", shell: true });
  srv.on("error", (e) => console.error("Srv err:", e));
}

function createWin() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    frame: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const url = isDev ? "http://localhost:3000" : `file://${path.join(__dirname, "out/index.html")}`;
  win.loadURL(url);
  win.on("closed", () => (win = null));
}

app.whenReady().then(() => {
  startSrv();
  createWin();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("will-quit", () => {
  if (srv) srv.kill();
});

ipcMain.on("min-win", () => win.minimize());
ipcMain.on("max-win", () => win.isMaximized() ? win.unmaximize() : win.maximize());
ipcMain.on("cls-win", () => win.close());
