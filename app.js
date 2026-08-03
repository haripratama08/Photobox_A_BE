const express = require('express');
const app = express();
const http = require('http').createServer(app);
const fs = require('fs-extra');

const config = require('./config/config');

const io = require('socket.io')(http, {
    maxHttpBufferSize: 1e8
});
const socketHandler = require('./sockets/socketHandler');
const watcherService = require('./services/watcher');
const cameraService = require('./services/cameraService');
const dashboardClient = require('./services/dashboardClient');

fs.ensureDirSync(config.BASE_PHOTO_FOLDER);
fs.ensureDirSync(config.FRAMES_FOLDER);
app.use('/photos', express.static(config.BASE_PHOTO_FOLDER));
app.use('/frames', express.static(config.FRAMES_FOLDER));

// HALAMAN PREVIEW LIVEVIEW BROWSER (Sangat Enteng)
app.get('/preview', (req, res) => {
    res.send(`
        <html>
        <head><title>Photobox Live Preview</title></head>
        <body style="background:black; color:white; text-align:center; font-family:sans-serif; margin:0; padding:20px;">
            <h2 style="margin-top:0;">Kamera Live Preview (Linux Low-CPU)</h2>
            <img id="camPreview" src="/preview-frame" style="max-width:100%; max-height:80vh; border:2px solid white; border-radius:8px;" />
            <br/><br/>
            <p style="color:#aaa; font-size:12px;">Mode Hemat Baterai/CPU (Auto-refresh 300ms)</p>
            <script>
                setInterval(() => {
                    document.getElementById('camPreview').src = '/preview-frame?t=' + new Date().getTime();
                }, 300);
            </script>
        </body>
        </html>
    `);
});

app.get('/preview-frame', (req, res) => {
    cameraService.getSinglePreviewFrame(res);
});

socketHandler(io);
watcherService.initWatcher(io);

http.listen(config.PORT, config.HOST, () => {
    console.log(`================================================`);
    console.log(`🚀 ${config.BOX_ID} AKTIF DI ${config.HOST}:${config.PORT}`);
    console.log(`================================================`);
    dashboardClient.startHeartbeat();
});
