import electron from 'electron'
console.log('[DEBUG] app:', typeof electron.app)
console.log('[DEBUG] BrowserWindow:', typeof electron.BrowserWindow)
console.log('[DEBUG] ipcMain:', typeof electron.ipcMain)
console.log('[DEBUG] desktopCapturer:', typeof electron.desktopCapturer)
console.log('[DEBUG] all keys:', Reflect.ownKeys(electron).join(', '))
const { app, BrowserWindow, ipcMain, desktopCapturer } = electron
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// __dirname is not available in ESM — reconstruct it from import.meta.url
const __dirname = dirname(fileURLToPath(import.meta.url))

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: join(__dirname, 'preload.js'),
    },
  })
  win.loadFile(join(__dirname, 'dist', 'frontend', 'browser', 'index.html'))
}

// Register IPC handler before window is created
ipcMain.handle('get-desktop-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['screen'] })
  return sources.map(s => ({ id: s.id, name: s.name }))
})

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
