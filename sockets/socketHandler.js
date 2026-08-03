const fs = require('fs-extra');
const sharp = require('sharp');
const path = require('path');
const { execFile } = require('child_process');
const config = require('../config/config');
const framesData = require(config.FRAMES_DATA_FILE);
const session = require('../state/session');
const { processAndPrint } = require('../controllers/printController');
const { sendWhatsappMsg, getWhatsappStatus } = require('../services/whatsapp');
const { sendEmailMsg } = require('../services/email');
const cameraService = require('../services/cameraService');
const dashboardClient = require('../services/dashboardClient');

let CONFIG_MIRROR = false;

const checkPrinter = () => new Promise((resolve) => {
    execFile('lpstat', ['-p', config.PRINTER_NAME], { timeout: 4000 },
        (error, stdout = '') => {
            const ok = !error && stdout.toLowerCase().includes('printer');
            resolve({
                ok,
                message: ok
                    ? `Printer ${config.PRINTER_NAME} siap`
                    : `Printer ${config.PRINTER_NAME} tidak siap`
            });
        });
});

const checkWritableStorage = async (folderPath, label) => {
    try {
        await fs.ensureDir(folderPath);
        await fs.access(folderPath, fs.constants.W_OK);
        const probePath = path.join(folderPath, `.preflight-${process.pid}.tmp`);
        await fs.writeFile(probePath, 'ok');
        await fs.remove(probePath);
        return { ok: true, message: `${label} siap digunakan` };
    } catch (error) {
        return { ok: false, message: `${label} tidak dapat ditulis` };
    }
};

const checkFrameAssets = async () => {
    try {
        await fs.ensureDir(config.FRAMES_FOLDER);
        const missing = framesData
            .map((frame) => {
                const filename = path.basename(
                    new URL(frame.asset_path, config.PUBLIC_BASE_URL).pathname
                );
                return fs.existsSync(path.join(config.FRAMES_FOLDER, filename))
                    ? null
                    : filename;
            })
            .filter(Boolean);

        return {
            ok: missing.length === 0,
            message: missing.length === 0
                ? `${framesData.length} frame siap digunakan`
                : `${missing.length} aset frame belum tersedia`
        };
    } catch (error) {
        return { ok: false, message: 'Aset frame tidak dapat diperiksa' };
    }
};

const runPreflight = async () => {
    const camera = await cameraService.getStatus();
    const [printer, storage, frames, whatsapp] = await Promise.all([
        checkPrinter(),
        checkWritableStorage(config.BASE_PHOTO_FOLDER, 'Penyimpanan foto'),
        checkFrameAssets(),
        getWhatsappStatus()
    ]);

    const checks = {
        api: {
            ok: true,
            required: true,
            message: `API port ${config.PORT} terhubung`
        },
        camera: {
            ok: Boolean(camera.connected),
            required: true,
            message: camera.connected ? 'Kamera terdeteksi' : 'Kamera tidak terdeteksi'
        },
        camera_port: {
            ok: !config.REQUIRE_CAMERA_PORT || Boolean(config.CAMERA_PORT),
            required: config.REQUIRE_CAMERA_PORT,
            message: config.CAMERA_PORT
                ? `Port kamera ${config.CAMERA_PORT}`
                : 'Belum dikunci (isi CAMERA_PORT untuk 3 kamera)'
        },
        printer: { ...printer, required: true },
        storage: { ...storage, required: true },
        frames: { ...frames, required: true },
        whatsapp: {
            ok: whatsapp.ok,
            required: false,
            message: whatsapp.message
        }
    };

    return {
        ok: Object.values(checks)
            .filter((check) => check.required)
            .every((check) => check.ok),
        checks,
        checked_at: new Date().toISOString()
    };
};

const publicFramesData = framesData.map((frame) => {
    const parsed = new URL(frame.asset_path, config.PUBLIC_BASE_URL);
    return {
        ...frame,
        asset_path: `${config.PUBLIC_BASE_URL}${parsed.pathname}`
    };
});

module.exports = (io) => {
    io.on('connection', async (socket) => {
        console.log(`📱 Frontend Flutter ${config.BOX_ID} terhubung!`);

        socket.emit('camera-status', await cameraService.getStatus());
        const statusInterval = setInterval(async () => {
            socket.emit('camera-status', await cameraService.getStatus());
        }, 3000);

        socket.on('preflight-check', async () => {
            try {
                socket.emit('preflight-result', await runPreflight());
            } catch (error) {
                socket.emit('preflight-result', {
                    ok: false,
                    checks: {},
                    checked_at: new Date().toISOString(),
                    error: 'Pemeriksaan kesiapan gagal dijalankan'
                });
            }
        });

        socket.on('set-active-user', (userName) => {
            const safeName = userName.replace(/[^a-zA-Z0-9 \-]/g, "_").trim();
            session.setActiveUserFolder(safeName || "Guest");
            console.log(`\n👤 SESI FOTO: [${session.getActiveUserFolder()}]`);
        });

        socket.on('take-photo', async () => {
            try {
                await cameraService.capturePhoto(config.BASE_PHOTO_FOLDER);
            } catch (e) {
                console.log('❌ Error take-photo Linux:', e.message);
            }
        });

        socket.on('auto-focus', () => {
            cameraService.autoFocus();
        });

        socket.on('set-iso', (val) => {
            cameraService.setIso(val);
        });

        socket.on('set-shutter', (val) => {
            cameraService.setShutter(val);
        });

        socket.on('set-mirror', (isMirror) => {
            CONFIG_MIRROR = isMirror;
            console.log(`🪞 Status Mirror Internal Node.js: ${CONFIG_MIRROR ? 'ON' : 'OFF'}`);
        });

        socket.on('get-frames', () => {
            socket.emit('frames-list', publicFramesData);
        });

        socket.on('start-liveview', () => {
            cameraService.startLiveView((frameBase64) => {
                socket.emit('liveview-frame', frameBase64);
            });
            dashboardClient.setLiveViewActive(true, (targetFps, activeCount) => {
                cameraService.setTargetFps(targetFps, activeCount);
            });
        });

        socket.on('stop-liveview', () => {
            cameraService.stopLiveView();
            dashboardClient.setLiveViewActive(false);
        });

        socket.on('send-results', async (data) => {
            try {
                let { userName, userWA, userEmail, mergedImageBase64, photos, printCopies = 1, frameName } = data;

                console.log(`\n===========================================`);
                console.log(`📥 PROSES DATA DARI FLUTTER UNTUK: ${userName}`);
                console.log(`📝 Permintaan Cetak: ${printCopies} Lembar`);
                if (frameName) console.log(`🖼️ Menggunakan Frame: ${frameName}`);

                const activeFolder = session.getActiveUserFolder();
                const userFolderPath = path.join(config.BASE_PHOTO_FOLDER, activeFolder);
                fs.ensureDirSync(userFolderPath);

                // 1. PROSES CETAK KOLASE (Tanpa mirror ganda agar teks frame tepat)
                const finalCollagePath = await processAndPrint({
                    mergedImageBase64,
                    frameName,
                    photos,
                    userFolderPath,
                    printCopies
                });

                // 2. PROSES FOTO MENTAH (INDIVIDUAL) - BACA SEMUA FOTO DARI FOLDER
                const rawFiles = [];
                try {
                    const filesInDir = fs.readdirSync(userFolderPath);
                    for (let file of filesInDir) {
                        if (file.startsWith('Cetak_Frame_') || file.endsWith('_mirror.jpg')) {
                            continue;
                        }
                        if (!file.toLowerCase().match(/\.(jpg|jpeg|png)$/)) {
                            continue;
                        }

                        const absolutePath = path.join(userFolderPath, file);
                        if (fs.existsSync(absolutePath)) {
                            if (CONFIG_MIRROR) {
                                const flippedPath = absolutePath.replace(/\.([a-zA-Z0-9]+)$/, '_mirror.$1');
                                if (!fs.existsSync(flippedPath)) {
                                    await sharp(absolutePath).flop().toFile(flippedPath);
                                }
                                rawFiles.push({ path: flippedPath });
                                console.log(`🪞 Foto mentah di-mirror: ${path.basename(flippedPath)}`);
                            } else {
                                rawFiles.push({ path: absolutePath });
                            }
                        }
                    }
                } catch (e) {
                    console.log(`❌ Gagal membaca foto dari folder:`, e.message);
                }

                const attachments = [];
                if (fs.existsSync(finalCollagePath)) {
                    attachments.push({ filename: path.basename(finalCollagePath), path: finalCollagePath });
                }
                rawFiles.forEach(file => {
                    attachments.push({ filename: path.basename(file.path), path: file.path });
                });

                if (userEmail && attachments.length > 0) {
                    console.log(`📧 Mengirim Email ke ${userEmail}...`);
                    await sendEmailMsg(userEmail, userName, attachments);
                }
                if (userWA && attachments.length > 0) {
                    console.log(`📱 Mengirim WhatsApp ke ${userWA}...`);
                    await sendWhatsappMsg(userWA, userName, attachments);
                }

                console.log(`✅ Proses untuk ${userName} Selesai!`);
                console.log(`===========================================\n`);
                dashboardClient.reportSession(printCopies).catch((error) => {
                    console.log(`⚠️ Dashboard session report gagal: ${error.message}`);
                });

            } catch (fatalError) {
                console.log(`🚨 ERROR SAAT PROSES DATA:`, fatalError.message);
            }
        });

        socket.on('disconnect', () => {
            clearInterval(statusInterval);
            cameraService.stopLiveView();
            dashboardClient.setLiveViewActive(false);
        });
    });
};
