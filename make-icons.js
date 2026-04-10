const { createCanvas } = require('./local-server/node_modules/canvas');
const fs = require('fs');

function makeIcon(size, outPath) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, size, size);

  const fontSize = Math.floor(size * 0.82);
  ctx.font = fontSize + 'px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('\uD83C\uDF4E', size / 2, size / 2 + size * 0.04);

  fs.writeFileSync(outPath, canvas.toBuffer('image/png'));
  console.log('Written ' + outPath + ' (' + size + 'x' + size + ')');
}

makeIcon(32, './chrome-extension/icons/icon32.png');
makeIcon(128, './chrome-extension/icons/icon128.png');
