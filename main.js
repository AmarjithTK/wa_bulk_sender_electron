const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { exec } = require('child_process');


function createWindow() {
    const win = new BrowserWindow({
        width: 720,
        height: 1280,
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        },
        icon: path.join(__dirname, 'assets/logo.png'), // Icon for Linux/Windows

    });

    win.loadFile('index.html');
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});

ipcMain.handle('select-file', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
            { name: 'Excel Files', extensions: ['xlsx', 'xls'] }
        ]
    });
    return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle('select-image', async () => {
    const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
            { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif'] }
        ]
    });
    return result.canceled ? null : result.filePaths[0];
});



ipcMain.on('log-message', (event, message) => {
    console.log('Renderer message:', message);
});

ipcMain.on('execute-command', (event, command) => {
    exec(command, (error, stdout, stderr) => {
        if (error) {
            console.error(`exec error: ${error}`);
            event.reply('command-result', { success: false, error: error.message });
            return;
        }
        event.reply('command-result', { success: true, output: stdout });
    });
});