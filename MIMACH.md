# Mimamch WhatsApp Gateway

Photobox dapat memakai gateway `mimamch/wa-gateway` sebagai provider WhatsApp
self-hosted. Fonnte tetap menjadi default sampai `WHATSAPP_PROVIDER=mimach` diisi.

## Gateway

```bash
cd ~/Apk/PHOTOBOX_A/API/deploy/mimach
mkdir -p wa_credentials media
docker compose up -d
```

Buka `http://127.0.0.1:5001`, masukkan `KEY`, buat session `box-a`, lalu scan QR.

Tambahkan ke `API/.env`:

```env
ENABLE_WHATSAPP=true
WHATSAPP_PROVIDER=mimach
MIMACH_API_URL=http://127.0.0.1:5001
MIMACH_API_KEY=ganti-dengan-key-yang-sama
MIMACH_SESSION=box-a
MIMACH_MEDIA_BASE_URL=http://127.0.0.1:3000/photos
```

`MIMACH_MEDIA_BASE_URL` harus dapat diakses dari container gateway. Jika gateway
menggunakan jaringan Docker biasa, gunakan host network atau mount folder media
yang sama; URL `127.0.0.1` dari container tidak selalu menunjuk ke host Linux.

Status session:

```bash
curl "http://127.0.0.1:5001/session?key=ganti-dengan-key-yang-sama"
```

Log Photobox:

```bash
tail -f state/logs/photobox.jsonl
```
