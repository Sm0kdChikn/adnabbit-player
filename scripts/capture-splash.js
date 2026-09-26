const { app, BrowserWindow } = require("electron");
const path = require("path");
const fs = require("fs");

const root = path.join(__dirname, "..");
const out =
  process.argv[2] || path.join(root, "demo-shots", "ticket-p13-splash.png");

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 420,
    height: 320,
    frame: false,
    resizable: false,
    backgroundColor: "#0B0F14",
    show: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setMenuBarVisibility(false);
  await win.loadFile(path.join(root, "src", "renderer", "splash.html"));
  await new Promise((r) => setTimeout(r, 900));
  const img = await win.webContents.capturePage();
  const png = img.toPNG();
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, png);
  console.log("wrote", out, png.length, "bytes");
  app.quit();
});
