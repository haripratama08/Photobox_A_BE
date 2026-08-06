const { execFile } = require('child_process');
const fs = require('fs-extra');
const path = require('path');
const sharp = require('sharp');
const config = require('../config/config');
const { withResourceLock } = require('../services/resourceLock');

const framesData = require(config.FRAMES_DATA_FILE);

const queuePrint = async (finalCollagePath, printCopies) => {
    const copies = Math.max(1, Number(printCopies) || 1);
    const mediaOption = config.PRINTER_MEDIA || '4x6';

    await withResourceLock(
        `printer:${config.PRINTER_NAME}`,
        () => new Promise((resolve, reject) => {
            execFile(
                'lp',
                [
                    '-d', config.PRINTER_NAME,
                    '-n', String(copies),
                    '-o', `media=${mediaOption}`,
                    '-o', 'fit-to-page',
                    finalCollagePath
                ],
                { timeout: 30000 },
                (error, stdout) => {
                    if (error) return reject(error);
                    console.log(`✅ [PRINT] Masuk antrean CUPS (${mediaOption}): ${stdout.trim()}`);
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
            const baseWidth = 1800;
            const baseHeight = 2700;
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
                .png()
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
    }

    return finalCollagePath;
};

module.exports = { processAndPrint };
