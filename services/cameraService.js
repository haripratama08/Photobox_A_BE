const { execFile, spawn } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const config = require('../config/config');

let isLiveViewActive = false;
let cameraConnected = false;
let currentIso = "Auto";
let currentShutter = "Auto";
let targetLiveViewFps = Math.max(1, Math.min(30, config.LIVEVIEW_FALLBACK_FPS));
let liveViewGeneration = 0;

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
    // Jangan menjalankan `gphoto2 --summary` ketika LiveView sedang aktif.
    // Perintah status bersamaan dengan capture-preview sering memicu PTP General Error.
    if (isCameraBusy || isCapturingFrame || isLiveViewActive) {
        return {
            connected: cameraConnected,
            model: cameraConnected
                ? `🟢 Kamera ${config.BOX_ID} sedang digunakan`
                : `🔴 Kamera ${config.BOX_ID} tidak terdeteksi`
        };
    }

    return new Promise((resolve) => {
        // Health check tidak boleh memakai --summary karena membuka sesi PTP
        // baru dan dapat mengunci Canon saat worker kamera sedang aktif.
        runGphoto(['--auto-detect'], { timeout: 5000 }, (error, stdout) => {
            if (!error && stdout && /Canon|EOS/i.test(stdout)) {
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
let captureInProgress = false; // Mencegah double-tap/dua request memicu dua jepretan
let globalOnFrameCallback = null; // Menyimpan callback LiveView
let liveViewProcess = null;
let liveViewRestartTimer = null;
let liveViewRestartAttempt = 0;
let liveViewFrameBuffer = Buffer.alloc(0);
let latestLiveViewFrame = null;
let lastFrameEmittedAt = 0;

const MAX_LIVEVIEW_BUFFER_BYTES = 8 * 1024 * 1024;

const clearLiveViewRestartTimer = () => {
    if (liveViewRestartTimer) {
        clearTimeout(liveViewRestartTimer);
        liveViewRestartTimer = null;
    }
};

const stopLiveViewTransport = () => {
    clearLiveViewRestartTimer();
    liveViewFrameBuffer = Buffer.alloc(0);

    const child = liveViewProcess;
    liveViewProcess = null;
    if (!child || child.exitCode !== null) {
        isCapturingFrame = false;
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        let finished = false;
        let forceStopTimer = null;
        const finish = () => {
            if (finished) return;
            finished = true;
            if (forceStopTimer) clearTimeout(forceStopTimer);
            isCapturingFrame = false;
            resolve();
        };

        child.once('close', finish);
        child.kill('SIGTERM');

        forceStopTimer = setTimeout(() => {
            if (child.exitCode === null) child.kill('SIGKILL');
            finish();
        }, 3000);
        forceStopTimer.unref?.();
    });
};

/**
 * Mengambil foto dari kamera dan menyimpannya di folder target.
 * Saat foto disimpan ke folder utama, watcher.js akan mendeteksi dan mengompresnya secara otomatis.
 */
async function capturePhoto(targetFolder) {
    // Kunci harus dipasang sebelum await. Jika dipasang setelah waitForCamera(),
    // dua request yang datang bersamaan bisa sama-sama lolos dan menjepret dua kali.
    if (captureInProgress || isCameraBusy) {
        console.log(`⚠️ [LINUX CAMERA] Permintaan foto diabaikan: kamera masih memproses foto sebelumnya.`);
        return null;
    }
    captureInProgress = true;

    // Canon hanya menerima satu sesi PTP. Kunci jalur kamera, hentikan proses
    // LiveView persisten, lalu tunggu sampai transport benar-benar bebas.
    const shouldResumeLiveView = isLiveViewActive;
    isCameraBusy = true;
    await stopLiveViewTransport();
    await new Promise(r => setTimeout(r, 500));
    while (isCapturingFrame) {
        await new Promise(r => setTimeout(r, 100));
    }
    
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
            if (shouldResumeLiveView && isLiveViewActive && globalOnFrameCallback) {
                console.log(`📸 [LINUX CAMERA] Melanjutkan LiveView kembali...`);
                // Beri jeda agar mekanik kamera rileks sebelum masuk LiveView kembali.
                scheduleLiveViewStart(1800, liveViewGeneration);
            }
            
            captureInProgress = false;
            resolve(filePath);
        });
    });
}

async function runCameraControl(args, fallbackArgs = null) {
    if (captureInProgress || isCameraBusy) return;

    isCameraBusy = true;
    const shouldResumeLiveView = isLiveViewActive;
    await stopLiveViewTransport();
    await new Promise(r => setTimeout(r, 400));

    await new Promise((resolve) => {
        runGphoto(args, { timeout: 10000 }, (error) => {
            if (error && fallbackArgs) {
                return runGphoto(fallbackArgs, { timeout: 10000 }, () => resolve());
            }
            resolve();
        });
    });

    isCameraBusy = false;
    if (shouldResumeLiveView && isLiveViewActive && globalOnFrameCallback) {
        scheduleLiveViewStart(1200, liveViewGeneration);
    }
}

function autoFocus() {
    console.log(`🎯 [LINUX CAMERA] Memicu Auto-Focus kamera...`);
    runCameraControl(
        ['--set-config', 'autofocusdrive=1'],
        ['--set-config', 'autofocus=1']
    ).catch(() => {});
}

function setIso(val) {
    currentIso = val;
    console.log(`⚙️ [LINUX CAMERA] Set ISO ke: ${val}`);
    runCameraControl(['--set-config', `iso=${val}`]).catch(() => {});
}

function setShutter(val) {
    currentShutter = val;
    console.log(`⚙️ [LINUX CAMERA] Set Shutter Speed ke: ${val}`);
    runCameraControl(['--set-config', `shutterspeed=${val}`]).catch(() => {});
}

function emitJpegFrames(data, onFrameCallback) {
    liveViewFrameBuffer = Buffer.concat([liveViewFrameBuffer, data]);

    while (liveViewFrameBuffer.length > 0) {
        const start = liveViewFrameBuffer.indexOf(Buffer.from([0xff, 0xd8]));
        if (start < 0) {
            liveViewFrameBuffer = liveViewFrameBuffer.subarray(
                Math.max(0, liveViewFrameBuffer.length - 1)
            );
            return;
        }

        const end = liveViewFrameBuffer.indexOf(Buffer.from([0xff, 0xd9]), start + 2);
        if (end < 0) {
            liveViewFrameBuffer = liveViewFrameBuffer.subarray(start);
            if (liveViewFrameBuffer.length > MAX_LIVEVIEW_BUFFER_BYTES) {
                liveViewFrameBuffer = Buffer.alloc(0);
            }
            return;
        }

        const frame = Buffer.from(liveViewFrameBuffer.subarray(start, end + 2));
        liveViewFrameBuffer = liveViewFrameBuffer.subarray(end + 2);
        latestLiveViewFrame = frame;
        cameraConnected = true;
        liveViewRestartAttempt = 0;

        const minimumFrameInterval = Math.round(1000 / targetLiveViewFps);
        if (Date.now() - lastFrameEmittedAt >= minimumFrameInterval) {
            lastFrameEmittedAt = Date.now();
            onFrameCallback(frame.toString('base64'));
        }
    }
}

function startGphotoMovieStream(onFrameCallback, generation) {
    if (!isLiveViewActive || isCameraBusy || generation !== liveViewGeneration) return;
    if (liveViewProcess && liveViewProcess.exitCode === null) return;

    liveViewFrameBuffer = Buffer.alloc(0);
    lastFrameEmittedAt = 0;
    const child = spawn(
        'gphoto2',
        cameraArgs([
            '--set-config', 'viewfinder=1',
            '--capture-movie',
            '--stdout'
        ]),
        { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    liveViewProcess = child;
    isCapturingFrame = true;
    let stderrText = '';

    child.stdout.on('data', (data) => {
        if (isLiveViewActive && !isCameraBusy && generation === liveViewGeneration) {
            emitJpegFrames(data, onFrameCallback);
        }
    });

    child.stderr.on('data', (data) => {
        stderrText = `${stderrText}${data.toString()}`.slice(-4000);
    });

    child.on('error', (error) => {
        stderrText = error.message;
    });

    child.on('close', (code, signal) => {
        if (liveViewProcess === child) liveViewProcess = null;
        isCapturingFrame = false;
        if (!isLiveViewActive || isCameraBusy || generation !== liveViewGeneration) return;

        liveViewRestartAttempt += 1;
        const retryDelay = Math.min(15000, 2000 * liveViewRestartAttempt);
        const reason = stderrText.trim().split(/\r?\n/).slice(-2).join(' ')
            || `exit=${code || signal}`;
        console.log(`⚠️ [LINUX CAMERA] LiveView terputus: ${reason}`);
        if (/0\s*(frame|bingkai)|movie capture error|galat menangkap film/i.test(stderrText)) {
            console.log('🎥 [LINUX CAMERA] Canon EOS harus berada pada mode Movie/Video untuk LiveView USB.');
        }
        console.log(`⏳ [LINUX CAMERA] Mencoba lagi dalam ${retryDelay / 1000} detik...`);
        scheduleLiveViewStart(retryDelay, generation);
    });
}

function captureV4l2Frame(onFrameCallback, generation) {
    if (!isLiveViewActive || isCameraBusy || generation !== liveViewGeneration) return;
    isCapturingFrame = true;
    const cycleStartedAt = Date.now();
    execFile('ffmpeg', [
        '-loglevel', 'error', '-y', '-f', 'video4linux2',
        '-i', config.VIDEO_DEVICE, '-frames:v', '1', '-f', 'image2pipe', '-'
    ], { encoding: 'buffer', timeout: 5000, maxBuffer: 20 * 1024 * 1024 }, (err, stdout) => {
        if (!err && stdout && stdout.length > 100 && isLiveViewActive && !isCameraBusy) {
            latestLiveViewFrame = Buffer.from(stdout);
            onFrameCallback(stdout.toString('base64'));
        }
        isCapturingFrame = false;
        if (isLiveViewActive && !isCameraBusy && generation === liveViewGeneration) {
            const delay = Math.max(
                0,
                Math.round(1000 / targetLiveViewFps) - (Date.now() - cycleStartedAt)
            );
            scheduleLiveViewStart(delay, generation);
        }
    });
}

function scheduleLiveViewStart(delayMs, generation = liveViewGeneration) {
    clearLiveViewRestartTimer();
    liveViewRestartTimer = setTimeout(() => {
        liveViewRestartTimer = null;
        if (!isLiveViewActive || isCameraBusy || generation !== liveViewGeneration) return;

        if (config.VIDEO_DEVICE && fs.existsSync(config.VIDEO_DEVICE)) {
            captureV4l2Frame(globalOnFrameCallback, generation);
            return;
        }
        startGphotoMovieStream(globalOnFrameCallback, generation);
    }, Math.max(0, delayMs));
    liveViewRestartTimer.unref?.();
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
    globalOnFrameCallback = onFrameCallback;
    if (isLiveViewActive) {
        if (!liveViewProcess && !isCapturingFrame && !isCameraBusy) {
            scheduleLiveViewStart(0, liveViewGeneration);
        }
        return;
    }
    isLiveViewActive = true;
    const generation = ++liveViewGeneration;
    console.log(`📹 [LINUX CAMERA] Memulai streaming LiveView...`);

    isCapturingFrame = false;
    liveViewRestartAttempt = 0;
    latestLiveViewFrame = null;
    // viewfinder dan capture-movie dijalankan oleh proses gphoto2 yang sama
    // sehingga aktivasi LiveView tidak membuka sesi PTP kedua.
    scheduleLiveViewStart(1000, generation);
}

function stopLiveView() {
    isLiveViewActive = false;
    liveViewGeneration += 1;
    console.log(`⏹️ [LINUX CAMERA] LiveView dihentikan.`);
    stopLiveViewTransport().catch(() => {});
}

async function shutdown() {
    isLiveViewActive = false;
    liveViewGeneration += 1;
    await stopLiveViewTransport();
}

/**
 * Menarik SATU frame pratinjau cepat (JPEG) langsung dari buffer stdout (Tanpa simpan ke disk).
 * Digunakan untuk Web Browser Live Preview (http://localhost:3000/preview)
 */
function getSinglePreviewFrame(res) {
    // Endpoint browser memakai frame terakhir dari stream yang sama. Jangan
    // membuka proses gphoto2 kedua saat LiveView aktif karena PTP bersifat eksklusif.
    if (latestLiveViewFrame && isLiveViewActive) {
        res.writeHead(200, {
            'Content-Type': 'image/jpeg',
            'Cache-Control': 'no-cache, no-store, must-revalidate'
        });
        return res.end(latestLiveViewFrame);
    }
    if (isLiveViewActive || isCameraBusy || captureInProgress) {
        return res.status(503).send('LiveView sedang menyiapkan frame.');
    }

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
    shutdown,
    setTargetFps,
    getLiveViewState,
    getSinglePreviewFrame
};
