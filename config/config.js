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
    PRINTER_NAME: process.env.PRINTER_NAME || "L8050_Series_Network",
    CAMERA_PORT: process.env.CAMERA_PORT || '',
    REQUIRE_CAMERA_PORT: process.env.REQUIRE_CAMERA_PORT !== 'false',
    REQUIRE_PRINTER: process.env.REQUIRE_PRINTER !== 'false',
    VIDEO_DEVICE: process.env.VIDEO_DEVICE || '/dev/video0',
    PREVIEW_FILE: process.env.PREVIEW_FILE || `/tmp/photobox-${boxSlug}-preview.jpg`,
    DASHBOARD_URL: process.env.DASHBOARD_URL || 'http://127.0.0.1:4000',
    DASHBOARD_AGENT_TOKEN: process.env.DASHBOARD_AGENT_TOKEN || '',
    HEARTBEAT_INTERVAL_MS: Number(process.env.HEARTBEAT_INTERVAL_MS || 10000),
    LIVEVIEW_FALLBACK_FPS: Number(process.env.LIVEVIEW_FALLBACK_FPS || 4),
    LIVEVIEW_BALANCE_INTERVAL_MS: Number(process.env.LIVEVIEW_BALANCE_INTERVAL_MS || 2000),
    ENABLE_WHATSAPP: process.env.ENABLE_WHATSAPP !== 'false',
    FONNTE_TOKEN: process.env.FONNTE_TOKEN || '',
    FONNTE_API_URL: process.env.FONNTE_API_URL || 'https://api.fonnte.com',
    FONNTE_COUNTRY_CODE: process.env.FONNTE_COUNTRY_CODE || '62',
    FONNTE_CONNECT_ONLY: process.env.FONNTE_CONNECT_ONLY === 'true',
    FONNTE_REQUEST_DELAY_MS: Number(process.env.FONNTE_REQUEST_DELAY_MS || 900),
    LAUNCHER_PID: Number(process.env.PHOTOBOX_LAUNCHER_PID || 0) || null,
    EMAIL_USER: process.env.EMAIL_USER,
    EMAIL_PASS: process.env.EMAIL_PASS
};
