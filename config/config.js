const path = require('path');
const dotenv = require('dotenv');

const apiRoot = path.join(__dirname, '..');
const inheritedEnvironment = { ...process.env };
dotenv.config({ path: path.join(apiRoot, '.env') });

const instanceEnvFile = process.env.PHOTOBOX_ENV_FILE;
if (instanceEnvFile) {
    dotenv.config({
        path: path.resolve(instanceEnvFile),
        override: true
    });
}
Object.assign(process.env, inheritedEnvironment);

const resolveApiPath = (value, fallback) => {
    const selected = value || fallback;
    return path.isAbsolute(selected) ? selected : path.resolve(apiRoot, selected);
};

const boxId = process.env.BOX_ID || 'Box A';
const boxSlug = process.env.BOX_SLUG
    || boxId.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    || 'box-a';
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';

module.exports = {
    BOX_ID: boxId,
    BOX_SLUG: boxSlug,
    PORT: port,
    HOST: host,
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${port}`,
    BASE_PHOTO_FOLDER: resolveApiPath(
        process.env.BASE_PHOTO_FOLDER,
        `runtime/${boxSlug}/photos`
    ),
    FRAMES_FOLDER: resolveApiPath(
        process.env.FRAMES_FOLDER,
        `runtime/${boxSlug}/frames`
    ),
    FRAMES_DATA_FILE: resolveApiPath(
        process.env.FRAMES_DATA_FILE,
        'data/frames.json'
    ),
    DEVICE_CONFIG_FILE: resolveApiPath(
        process.env.DEVICE_CONFIG_FILE,
        'config/devices.json'
    ),
    LOG_FILE: resolveApiPath(process.env.LOG_FILE, 'state/logs/photobox.jsonl'),
    PRINTER_NAME: process.env.PRINTER_NAME || "L8050_Series_Network",
    // Pada PPD Epson ESC/P-R, awalan T menandakan ukuran tanpa batas.
    PRINTER_MEDIA: process.env.PRINTER_MEDIA || 'T4X6FULL',
    PRINTER_MEDIA_TYPE: process.env.PRINTER_MEDIA_TYPE || 'PLAIN_HIGH',
    PRINTER_BORDERLESS: process.env.PRINTER_BORDERLESS !== 'false',
    PRINTER_BORDERLESS_MEDIA_TYPE: process.env.PRINTER_BORDERLESS_MEDIA_TYPE || 'GLOSSYPHOTO_HIGH',
    PRINT_BORDERLESS_OVERSCAN: Number(process.env.PRINT_BORDERLESS_OVERSCAN || 106),
    PRINTER_INK: process.env.PRINTER_INK || 'COLOR',
    PRINT_WIDTH: Number(process.env.PRINT_WIDTH || 2400),
    PRINT_HEIGHT: Number(process.env.PRINT_HEIGHT || 3600),
    PRINT_DPI: Number(process.env.PRINT_DPI || 720),
    CAMERA_PORT: process.env.CAMERA_PORT || '',
    REQUIRE_CAMERA_PORT: process.env.REQUIRE_CAMERA_PORT !== 'false',
    REQUIRE_PRINTER: process.env.REQUIRE_PRINTER !== 'false',
    CAMERA_AGENT_ENABLED: process.env.CAMERA_AGENT_ENABLED !== 'false',
    CAMERA_AGENT_BIN: resolveApiPath(
        process.env.CAMERA_AGENT_BIN,
        'native/photobox-camera-agent'
    ),
    // Kosong berarti tidak memakai V4L2/HDMI capture. Ini wajib untuk
    // kamera DSLR yang terhubung langsung lewat satu kabel USB (gphoto2).
    // Jangan memakai fallback /dev/video0 karena dapat memilih webcam atau
    // device lain dan membuat LiveView tidak pernah menerima frame kamera.
    VIDEO_DEVICE: process.env.VIDEO_DEVICE === undefined
        ? ''
        : process.env.VIDEO_DEVICE.trim(),
    PREVIEW_FILE: process.env.PREVIEW_FILE || `/tmp/photobox-${boxSlug}-preview.jpg`,
    DASHBOARD_URL: process.env.DASHBOARD_URL || 'http://127.0.0.1:4000',
    DASHBOARD_AGENT_TOKEN: process.env.DASHBOARD_AGENT_TOKEN || '',
    HEARTBEAT_INTERVAL_MS: Number(process.env.HEARTBEAT_INTERVAL_MS || 10000),
    LIVEVIEW_FALLBACK_FPS: Number(process.env.LIVEVIEW_FALLBACK_FPS || 4),
    LIVEVIEW_TARGET_FPS: Number(process.env.LIVEVIEW_TARGET_FPS || 30),
    LIVEVIEW_MODE: process.env.LIVEVIEW_MODE === 'movie' ? 'movie' : 'preview',
    LIVEVIEW_FRAME_TIMEOUT_MS: Number(process.env.LIVEVIEW_FRAME_TIMEOUT_MS || 7000),
    CAMERA_RESET_COOLDOWN_MS: Number(process.env.CAMERA_RESET_COOLDOWN_MS || 20000),
    CAMERA_RESET_SETTLE_MS: Number(process.env.CAMERA_RESET_SETTLE_MS || 3000),
    CAPTURE_DEBOUNCE_MS: Number(process.env.CAPTURE_DEBOUNCE_MS || 2000),
    LIVEVIEW_BALANCE_INTERVAL_MS: Number(process.env.LIVEVIEW_BALANCE_INTERVAL_MS || 2000),
    ENABLE_WHATSAPP: process.env.ENABLE_WHATSAPP !== 'false',
    WHATSAPP_PROVIDER: String(process.env.WHATSAPP_PROVIDER || 'fonnte').toLowerCase(),
    FONNTE_TOKEN: process.env.FONNTE_TOKEN || '',
    FONNTE_API_URL: process.env.FONNTE_API_URL || 'https://api.fonnte.com',
    FONNTE_COUNTRY_CODE: process.env.FONNTE_COUNTRY_CODE || '62',
    FONNTE_CONNECT_ONLY: process.env.FONNTE_CONNECT_ONLY === 'true',
    FONNTE_REQUEST_DELAY_MS: Number(process.env.FONNTE_REQUEST_DELAY_MS || 900),
    MIMACH_API_URL: (process.env.MIMACH_API_URL || 'http://127.0.0.1:5001').replace(/\/$/, ''),
    MIMACH_API_KEY: process.env.MIMACH_API_KEY || '',
    MIMACH_SESSION: process.env.MIMACH_SESSION || 'box-a',
    MIMACH_MEDIA_BASE_URL: (process.env.MIMACH_MEDIA_BASE_URL || `${process.env.PUBLIC_BASE_URL || `http://127.0.0.1:${port}`}/photos`).replace(/\/$/, ''),
    MIMACH_REQUEST_DELAY_MS: Number(process.env.MIMACH_REQUEST_DELAY_MS || 900),
    LAUNCHER_PID: Number(process.env.PHOTOBOX_LAUNCHER_PID || 0) || null,
    EMAIL_USER: process.env.EMAIL_USER,
    EMAIL_PASS: process.env.EMAIL_PASS
};
