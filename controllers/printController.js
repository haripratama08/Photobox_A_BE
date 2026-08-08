const { execFile } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const sharp = require('sharp');
const config = require('../config/config');
const { withResourceLock } = require('../services/resourceLock');
const logger = require('../services/logger');
const printerService = require('../services/printerService');

const framesData = require(config.FRAMES_DATA_FILE);

const queuePrint = async (finalCollagePath, printCopies) => {
    const copies = Math.max(1, Number(printCopies) || 1);
    const configuredMedia = config.PRINTER_MEDIA || 'T4X6FULL';
    // Epson ESC/P-R memakai T4X6FULL untuk 4 x 6 inci tanpa batas.
    // Konfigurasi lama 4x6/4X6FULL otomatis dinaikkan ke borderless.
    const isFourBySix = /^(?:4x6|4X6FULL|T4X6FULL)$/i.test(configuredMedia);
    const borderless = config.PRINTER_BORDERLESS && isFourBySix;
    const mediaOption = borderless ? 'T4X6FULL' : configuredMedia;
    const requestedMediaType = config.PRINTER_MEDIA_TYPE || 'PLAIN_HIGH';
    // PPD Epson menolak kombinasi borderless dengan PLAIN_HIGH. Gunakan
    // mode foto saat borderless agar driver tidak kembali ke halaman bermargin.
    const mediaType = borderless && /^PLAIN_/i.test(requestedMediaType)
        ? config.PRINTER_BORDERLESS_MEDIA_TYPE
        : requestedMediaType;
    const overscan = Math.min(
        120,
        Math.max(100, Number(config.PRINT_BORDERLESS_OVERSCAN) || 106)
    );
    const ink = config.PRINTER_INK || 'COLOR';
    const printerQueue = await printerService.resolveQueue();
    if (!printerQueue) throw new Error('Tidak ada printer CUPS yang terdeteksi');
    logger.info('print_start', {
        printer: printerQueue,
        file: finalCollagePath,
        copies,
        media: mediaOption,
        mediaType,
        requestedMediaType,
        ink,
        dpi: config.PRINT_DPI,
        borderless,
        overscan: borderless ? overscan : null,
        fitToPage: !borderless
    });

    await withResourceLock(
        `printer:${printerQueue}`,
        () => new Promise((resolve, reject) => {
            const lpArguments = [
                '-d', printerQueue,
                '-n', String(copies),
                '-o', `PageSize=${mediaOption}`,
                '-o', `MediaType=${mediaType}`,
                '-o', `Ink=${ink}`,
                '-o', 'print-quality=5',
                '-o', `resolution=${config.PRINT_DPI}dpi`,
                '-o', 'job-sheets=none,none',
                '-o', 'position=center',
                ...(borderless
                    ? ['-o', `scaling=${overscan}`]
                    : ['-o', 'fit-to-page']),
                finalCollagePath
            ];
            execFile(
                'lp',
                lpArguments,
                { timeout: 30000 },
                (error, stdout) => {
                    if (error) {
                        logger.error('print_failed', { printer: printerQueue, file: finalCollagePath, error: error.message, stderr: error.stderr });
                        return reject(error);
                    }
                    console.log(`✅ [PRINT] Masuk antrean CUPS (${mediaOption}): ${stdout.trim()}`);
                    logger.info('print_queued', { printer: printerQueue, output: stdout.trim() });
                    resolve();
                }
            );
        }),
        {
            label: `printer ${config.PRINTER_NAME}`,
            timeoutMs: 120000,
            staleMs: 300000
        }
    );
};

const processAndPrint = async ({
    mergedImageBase64,
    frameName,
    photos,
    userFolderPath,
    printCopies
}) => {
    const finalCollagePath = path.join(
        userFolderPath,
        `Cetak_Frame_${Date.now()}.png`
    );
    let renderingDone = false;

    if (frameName && photos && photos.length > 0) {
        const frameConfig = framesData.find((frame) => frame.name === frameName);
        if (frameConfig) {
            const baseWidth = config.PRINT_WIDTH;
            const baseHeight = config.PRINT_HEIGHT;
            const frameFileName = path.basename(
                new URL(frameConfig.asset_path, config.PUBLIC_BASE_URL).pathname
            );
            const frameLocalPath = path.join(config.FRAMES_FOLDER, frameFileName);
            const compositeOperations = [];

            for (let index = 0; index < photos.length; index += 1) {
                if (!frameConfig.slots[index]) continue;
                const slot = frameConfig.slots[index];
                const urlPath = new URL(photos[index]).pathname;
                const relativePath = decodeURIComponent(
                    urlPath.replace('/photos/', '')
                );
                const absolutePath = path.join(
                    config.BASE_PHOTO_FOLDER,
                    relativePath
                );
                const slotWidth = Math.round(baseWidth * slot.w);
                const slotHeight = Math.round(baseHeight * slot.h);

                if (fs.existsSync(absolutePath)) {
                    compositeOperations.push({
                        input: await sharp(absolutePath)
                            .resize({
                                width: slotWidth,
                                height: slotHeight,
                                fit: 'cover'
                            })
                            .toBuffer(),
                        top: Math.round(baseHeight * slot.t),
                        left: Math.round(baseWidth * slot.l)
                    });
                }
            }

            if (fs.existsSync(frameLocalPath)) {
                compositeOperations.push({
                    input: await sharp(frameLocalPath)
                        .resize(baseWidth, baseHeight)
                        .toBuffer(),
                    top: 0,
                    left: 0
                });
            } else {
                console.log(`⚠️ Template frame tidak ditemukan: ${frameLocalPath}`);
            }

            await sharp({
                create: {
                    width: baseWidth,
                    height: baseHeight,
                    channels: 4,
                    background: { r: 255, g: 255, b: 255, alpha: 1 }
                }
            })
                .composite(compositeOperations)
                .withMetadata({ density: 450 })
                .png({ compressionLevel: 6, adaptiveFiltering: true })
                .toFile(finalCollagePath);

            console.log(`✅ Kolase high-res berhasil dibuat: ${finalCollagePath}`);
            renderingDone = true;
        }
    }

    if (!renderingDone && mergedImageBase64) {
        const base64Data = mergedImageBase64.replace(
            /^data:image\/\w+;base64,/,
            ''
        );
        await fs.writeFile(finalCollagePath, Buffer.from(base64Data, 'base64'));
        renderingDone = true;
    }

    if (!renderingDone || !fs.existsSync(finalCollagePath)) {
        throw new Error('Kolase cetak gagal dibuat');
    }

    console.log(
        `🖨️ Mengantrekan ${printCopies} salinan ke ${config.PRINTER_NAME}...`
    );
    try {
        await queuePrint(finalCollagePath, printCopies);
    } catch (error) {
        console.log(
            `⚠️ [PRINT] Gagal masuk antrean ${config.PRINTER_NAME}: ${error.message}`
        );
        logger.error('print_pipeline_failed', { printer: config.PRINTER_NAME, file: finalCollagePath, error: error.message });
    }

    return finalCollagePath;
};

module.exports = { processAndPrint };
