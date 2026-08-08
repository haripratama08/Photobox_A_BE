const { execFile } = require('child_process');
const config = require('../config/config');
const logger = require('./logger');

const run = (args) => new Promise((resolve) => {
    execFile('lpstat', args, { timeout: 5000, encoding: 'utf8' }, (error, stdout = '', stderr = '') => {
        resolve({ ok: !error, stdout, stderr });
    });
});

let cachedQueue = null;
let cachedAt = 0;

async function discoverDeviceUri() {
    const result = await new Promise((resolve) => {
        execFile('lpinfo', ['-v'], { timeout: 8000, encoding: 'utf8' }, (error, stdout = '', stderr = '') =>
            resolve({ ok: !error, stdout, stderr }));
    });
    const devices = result.stdout.split(/\r?\n/)
        .map((line) => line.match(/^\s*network\s+(.+)$/i)?.[1]?.trim())
        .filter(Boolean);
    const uri = devices.find((value) => /epson|l8050|dnssd|pdl-datastream/i.test(value)) || null;
    logger.info('printer_discovery', { uri, devices });
    return uri;
}

async function updateQueueUri(queue, uri) {
    if (!queue || !uri) return false;
    const result = await new Promise((resolve) => {
        execFile('lpadmin', ['-p', queue, '-v', uri], { timeout: 10000, encoding: 'utf8' }, (error, stdout = '', stderr = '') =>
            resolve({ ok: !error, stdout, stderr, error }));
    });
    if (result.ok) logger.info('printer_uri_updated', { queue, uri });
    else logger.warn('printer_uri_update_failed', { queue, uri, error: result.stderr || result.error?.message });
    return result.ok;
}

async function resolveQueue(force = false) {
    if (!force && cachedQueue && Date.now() - cachedAt < 30000) return cachedQueue;
    const [printers, devices] = await Promise.all([run(['-p']), run(['-v'])]);
    const queues = printers.stdout.split(/\r?\n/)
        .map((line) => line.match(/^printer\s+(\S+)\s+/i)?.[1])
        .filter(Boolean);
    const configured = config.PRINTER_NAME;
    const preferred = ['PHOTO_PRINTER', configured]
        .filter(Boolean)
        .find((name) => queues.includes(name));
    // lpstat -v is intentionally queried here as a diagnostic source; the
    // actual print queue must already exist in CUPS so its URI/IP stays managed
    // by CUPS rather than being hardcoded in the application.
    // lpstat -v does not always expose a queue in the same order as -p;
    // prefer an existing queue whose name identifies Epson/L8050.
    const namedEpson = queues.find((name) => /epson|l8050|photo_printer/i.test(name));
    cachedQueue = preferred || namedEpson || queues[0] || null;
    cachedAt = Date.now();
    if (cachedQueue) {
        const discoveredUri = await discoverDeviceUri();
        await updateQueueUri(cachedQueue, discoveredUri);
    }
    logger.info('printer_resolved', { queue: cachedQueue, configured, queues });
    return cachedQueue;
}

async function status() {
    const queue = await resolveQueue();
    if (!queue) return { ok: false, queue: null, message: 'Tidak ada queue printer CUPS' };
    const result = await run(['-p', queue]);
    const ok = result.ok && result.stdout.toLowerCase().includes('printer');
    return { ok, queue, message: ok ? `Printer ${queue} siap` : `Printer ${queue} tidak siap` };
}

module.exports = { resolveQueue, status };
