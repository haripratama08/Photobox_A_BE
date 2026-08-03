const nodemailer = require('nodemailer');
const config = require('../config/config');

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: config.EMAIL_USER,
        pass: config.EMAIL_PASS
    }
});

const sendEmailMsg = async (userEmail, userName, attachments) => {
    if (!userEmail || attachments.length === 0) return;

    console.log(`⏳ Mengirim Email ke: ${userEmail}...`);
    try {
        await transporter.sendMail({
            from: '"Photobox Studio" <no-reply@photobox.com>',
            to: userEmail,
            subject: `Hasil Foto Photobox Anda, ${userName}! 📸`,
            text: `Halo ${userName}!\n\nTerima kasih telah berkunjung. Terlampir adalah 1 Foto Frame hasil cetak beserta seluruh foto mentahannya.\n\nSalam Hangat,\nTim Photobox`,
            attachments: attachments
        });
        console.log(`✅ [EMAIL] Sukses terkirim!`);
    } catch (err) {
        console.log(`❌ [EMAIL] Gagal:`, err.message);
    }
};

module.exports = { sendEmailMsg };