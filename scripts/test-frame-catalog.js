const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const apiRoot = path.resolve(__dirname, '..');
const frames = require(path.join(apiRoot, 'data', 'frames.json'));
const removedFrames = [
  'Frame 8 - Birthday',
  'Frame 10 - Classic White',
  'Frame 14 - Dirgahayu Indonesia',
  'Frame 15 - Selamat Hari Merdeka',
  'Frame 16 - Indonesia Oval',
  'Frame 17 - Batik Merdeka',
  'Happy Anniversary 1 Year',
];
for (const name of removedFrames) {
  assert.ok(!frames.some((frame) => frame.name === name), `${name} is absent from the catalog`);
}

const expectedFrames = [
  { name: 'Frame 19 - Di Cerita Kita Film', asset: 'frame_19_film_negative.png', width: 1181, height: 1772, slots: 4 },
  { name: 'Frame 20 - Diceritakita Vintage', asset: 'frame_20_diceritakita_oval.png', width: 1181, height: 1772, slots: 4 },
  { name: 'Frame 21 - Cloud Dream', asset: 'frame_21_cloud_blue.png', width: 1181, height: 1772, slots: 4 },
  { name: 'Frame 22 - Heart Lace', asset: 'frame_22_heart_lace.png', width: 1182, height: 1772, slots: 6 },
  { name: 'Frame 23 - Result of Diceritakita', asset: 'frame_23_result_blue.png', width: 1182, height: 1772, slots: 6 },
  { name: 'Frame 24 - Pink Scallop', asset: 'frame_24_pink_scallop.png', width: 1182, height: 1772, slots: 6 },
  { name: 'Frame 25 - Blue Lace', asset: 'frame_25_blue_lace.png', width: 1182, height: 1772, slots: 8 },
  { name: 'Frame 26 - Black Filmstrip', asset: 'frame_26_black_polka.png', width: 1181, height: 1772, slots: 6 },
  { name: 'Frame 27 - Ivory Filmstrip', asset: 'frame_27_cream_polka.png', width: 1181, height: 1772, slots: 6 },
];

for (const expected of expectedFrames) {
  const frame = frames.find((entry) => entry.name === expected.name);
  assert.ok(frame, `${expected.name} is present in the Photobox A catalog`);
  assert.equal(path.basename(new URL(frame.asset_path).pathname), expected.asset);
  assert.equal(frame.slot_count, expected.slots);
  assert.equal(frame.slots.length, frame.slot_count);

  const assetPath = path.join(apiRoot, 'frames', expected.asset);
  assert.ok(fs.existsSync(assetPath), `frame asset exists: ${assetPath}`);
  const image = fs.readFileSync(assetPath);
  assert.equal(image.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'asset is a PNG');
  assert.equal(image.readUInt32BE(16), expected.width, 'PNG width matches supplied design');
  assert.equal(image.readUInt32BE(20), expected.height, 'PNG height matches supplied design');
  assert.equal(image[25], 6, 'PNG supports RGBA transparency');

  for (const [index, slot] of frame.slots.entries()) {
    for (const key of ['t', 'l', 'w', 'h']) {
      assert.equal(typeof slot[key], 'number', `${expected.name} slot ${index + 1} ${key} is numeric`);
    }
    assert.ok(slot.t >= 0 && slot.l >= 0, `${expected.name} slot ${index + 1} starts inside the canvas`);
    assert.ok(slot.w > 0 && slot.h > 0, `${expected.name} slot ${index + 1} has positive dimensions`);
    assert.ok(slot.t + slot.h <= 1 && slot.l + slot.w <= 1, `${expected.name} slot ${index + 1} ends inside the canvas`);
  }
}

console.log(`PASS: ${expectedFrames.length} Photobox A frame assets and slot layouts are valid.`);
