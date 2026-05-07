const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
  min: () => ipcRenderer.send("min-win"),
  max: () => ipcRenderer.send("max-win"),
  cls: () => ipcRenderer.send("cls-win"),
});
