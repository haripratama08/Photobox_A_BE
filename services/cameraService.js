const { execFile } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const config = require('../config/config');

let isLiveViewActive = false;
let cameraConnected = false;
let currentIso = "Auto";
let currentShutter = "Auto";
let targetLiveViewFps = Math.max(1, Math.min(30, config.LIVEVIEW_FALLBACK_FPS));

const cameraArgs = (args) => {
    if (!config.CAMERA_PORT) return args;
    return ['--port', config.CAMERA_PORT, ...args];
};

const runGphoto = (args, options, callback) => {
    execFile('gphoto2', cameraArgs(args), options, callback);
};

/**
 * Layanan Kamera Linux Natif (Tanpa DigiCamControl)
 * Menggunakan command CLI gphoto2 / v4l2 agar super enteng, cepat, dan hemat resource RAM/CPU di Linux.
 */
async function getStatus() {
    if (isCameraBusy || isCapturingFrame) {
        return {
            connected: cameraConnected,
            model: cameraConnected
                ? `🟢 Kamera ${config.BOX_ID} sedang digunakan`
                : `🔴 Kamera ${config.BOX_ID} tidak terdeteksi`
        };
    }

    return new Promise((resolve) => {
        runGphoto(['--summary'], { timeout: 5000 }, (error, stdout) => {
            if (!error && stdout && !stdout.toLowerCase().includes('error')) {
                cameraConnected = true;
                return resolve({
                    connected: true,
                    model: `🟢 Kamera ${config.BOX_ID} terhubung`
                });
            }
            
            if (fs.existsSync(config.VIDEO_DEVICE)) {
                cameraConnected = true;
                return resolve({
                    connected: true,
                    model: `🟢 Kamera video ${config.VIDEO_DEVICE} terhubung`
                });
            }

            cameraConnected = false;
            resolve({
                connected: false,
                model: `🔴 Kamera ${config.BOX_ID} tidak terdeteksi`
            });
        });
    });
}

// --- SISTEM MUTEX LOCK ---
let isCameraBusy = false;
let isCapturingFrame = false; // Status untuk loop LiveView
let globalOnFrameCallback = null; // Menyimpan callback LiveView

const waitForCamera = async () => {
    while (isCameraBusy || isCapturingFrame) {
        await new Promise(r => setTimeout(r, 100)); // Tunggu 100ms sampai jalur USB kosong
    }
};

/**
 * Mengambil foto dari kamera dan menyimpannya di folder target.
 * Saat foto disimpan ke folder utama, watcher.js akan mendeteksi dan mengompresnya secara otomatis.
 */
async function capturePhoto(targetFolder) {
    // 1. Tunggu sampai gphoto2 sebelumnya (LiveView) selesai
    await waitForCamera();
    
    // 2. Kunci jalur USB
    isCameraBusy = true;
    
    // 3. Matikan sementara flag LiveView agar loop tidak menyerobot
    const wasLiveViewActive = isLiveViewActive;
    isLiveViewActive = false;
    
    return new Promise((resolve) => {
        fs.ensureDirSync(targetFolder);
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const filename = `photo_linux_${timestamp}.jpg`;
        const filePath = path.join(targetFolder, filename);

        console.log(`📸 [LINUX CAMERA] (LOCK AKTIF) Mengeksekusi pengambilan foto utama...`);

        runGphoto([
            '--capture-image-and-download',
            '--filename',
            filePath,
            '--force-overwrite'
        ], { timeout: 30000 }, (error) => {
            if (error) {
                console.log(`❌ [LINUX CAMERA] Error saat menjepret:`, error.message);
                execFile('ffmpeg', [
                    '-y',
                    '-f',
                    'video4linux2',
                    '-i',
                    config.VIDEO_DEVICE,
                    '-vframes',
                    '1',
                    filePath
                ], { timeout: 15000 }, (errFfmpeg) => {
                    if (errFfmpeg && !fs.existsSync(filePath)) {
                        console.log(`⏳ Sistem siap menerima file foto di folder pemantauan (${targetFolder}) untuk diproses otomatis.`);
                    }
                });
            } else {
                console.log(`✅ [LINUX CAMERA] Sukses jepret & unduh foto: ${filename}`);
            }
            
            // 4. Buka Kunci USB
            isCameraBusy = false;
            
            // 5. Kembalikan mode LiveView jika sebelumnya menyala
            if (wasLiveViewActive && globalOnFrameCallback) {
                console.log(`📸 [LINUX CAMERA] Melanjutkan LiveView kembali...`);
                isLiveViewActive = true;
                // Beri jeda 1 detik agar mekanik lensa kamera rileks sebelum buka mirror lagi
                setTimeout(() => captureNextFrame(globalOnFrameCallback), 1000); 
            }
            
            resolve(filePath);
        });
    });
}

function autoFocus() {
    console.log(`🎯 [LINUX CAMERA] Memicu Auto-Focus kamera...`);
    runGphoto(['--set-config', 'autofocusdrive=1'], {}, (err) => {
        if (err) runGphoto(['--set-config', 'autofocus=1'], {}, () => {});
    });
}

function setIso(val) {
    currentIso = val;
    console.log(`⚙️ [LINUX CAMERA] Set ISO ke: ${val}`);
    runGphoto(['--set-config', `iso=${val}`], {}, () => {});
}

function setShutter(val) {
    currentShutter = val;
    console.log(`⚙️ [LINUX CAMERA] Set Shutter Speed ke: ${val}`);
    runGphoto(['--set-config', `shutterspeed=${val}`], {}, () => {});
}

function captureNextFrame(onFrameCallback) {
    // Berhenti jika dimatikan atau jika kamera sedang dijepret (Lock)
    if (!isLiveViewActive) return;
    if (isCapturingFrame || isCameraBusy) return; 
    
    isCapturingFrame = true;
    const cycleStartedAt = Date.now();
    
    // Kamera DSLR butuh 3-5 detik untuk mengangkat cermin mekanik (mirror lock-up) saat pertama kali masuk LiveView.
    const previewFile = config.PREVIEW_FILE;
    const thumbFile = path.join(
        path.dirname(previewFile),
        `thumb_${path.basename(previewFile)}`
    );
    
    runGphoto([
        '--capture-preview',
        '--filename',
        previewFile,
        '--force-overwrite'
    ], { timeout: 10000 }, (err) => {
        let frameData = null;
        try {
            if (fs.existsSync(thumbFile)) {
                frameData = fs.readFileSync(thumbFile);
            } else if (fs.existsSync(previewFile)) {
                frameData = fs.readFileSync(previewFile);
            }
        } catch (e) {}

        if (frameData && frameData.length > 100) {
            // Jika sukses baca file fisik
            if (isLiveViewActive && !isCameraBusy) {
                onFrameCallback(frameData.toString('base64'));
            }
        } else {
            // Hindari spam error saat sedang dijepret
            if (!isCameraBusy) {
                console.log("❌ [DEBUG] gphoto2 ERROR:", err ? err.message : "File preview gagal dibuat");
                console.log("⚠️ [DEBUG] Mengulangi permintaan frame dari kamera...");
            }
        }
        
        isCapturingFrame = false;
        
        // Target FPS adalah batas atas. Durasi proses gphoto2 ikut dihitung agar
        // tiga kamera tidak menghasilkan antrean frame atau beban CPU berlebih.
        if (isLiveViewActive && !isCameraBusy) {
            const frameIntervalMs = Math.round(1000 / targetLiveViewFps);
            const elapsedMs = Date.now() - cycleStartedAt;
            const nextFrameDelayMs = Math.max(0, frameIntervalMs - elapsedMs);
            setTimeout(() => captureNextFrame(onFrameCallback), nextFrameDelayMs);
        }
    });
}

function setTargetFps(fps, activeCount = 0) {
    const parsedFps = Number(fps);
    const nextFps = Number.isFinite(parsedFps)
        ? Math.max(1, Math.min(30, Math.round(parsedFps)))
        : config.LIVEVIEW_FALLBACK_FPS;

    if (nextFps === targetLiveViewFps) return;
    targetLiveViewFps = nextFps;
    const source = activeCount > 0 ? `${activeCount} liveview aktif` : 'mode aman';
    console.log(`⚖️ [LIVEVIEW BALANCER] Target ${targetLiveViewFps} FPS (${source}).`);
}

function getLiveViewState() {
    return {
        active: isLiveViewActive,
        targetFps: targetLiveViewFps
    };
}

function startLiveView(onFrameCallback) {
    if (isLiveViewActive) return;
    isLiveViewActive = true;
    globalOnFrameCallback = onFrameCallback;
    console.log(`📹 [LINUX CAMERA] Memulai streaming LiveView...`);
    
    isCapturingFrame = false;
    captureNextFrame(onFrameCallback);
}

function stopLiveView() {
    isLiveViewActive = false;
    console.log(`⏹️ [LINUX CAMERA] LiveView dihentikan.`);
}

/**
 * Menarik SATU frame pratinjau cepat (JPEG) langsung dari buffer stdout (Tanpa simpan ke disk).
 * Digunakan untuk Web Browser Live Preview (http://localhost:3000/preview)
 */
function getSinglePreviewFrame(res) {
    const previewFile = config.PREVIEW_FILE;
    const thumbFile = path.join(
        path.dirname(previewFile),
        `thumb_${path.basename(previewFile)}`
    );

    runGphoto([
        '--capture-preview',
        '--filename',
        previewFile,
        '--force-overwrite'
    ], { timeout: 3000 }, (err) => {
        let frameData = null;
        try {
            if (fs.existsSync(thumbFile)) frameData = fs.readFileSync(thumbFile);
            else if (fs.existsSync(previewFile)) frameData = fs.readFileSync(previewFile);
        } catch (e) {}

        if (frameData && frameData.length > 100) {
            res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
            res.end(frameData);
        } else {
            execFile('ffmpeg', [
                '-y',
                '-f',
                'video4linux2',
                '-i',
                config.VIDEO_DEVICE,
                '-vframes',
                '1',
                '-f',
                'image2pipe',
                '-'
            ], { encoding: 'buffer', timeout: 3000, maxBuffer: 20 * 1024 * 1024 }, (errF, stdoutF) => {
                if (!errF && stdoutF && stdoutF.length > 100) {
                    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Cache-Control': 'no-cache, no-store, must-revalidate' });
                    res.end(stdoutF);
                } else {
                    res.status(500).send('Kamera tidak terdeteksi atau mati.');
                }
            });
        }
    });
}

module.exports = {
    getStatus,
    capturePhoto,
    autoFocus,
    setIso,
    setShutter,
    startLiveView,
    stopLiveView,
    setTargetFps,
    getLiveViewState,
    getSinglePreviewFrame
};
