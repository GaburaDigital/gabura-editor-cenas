// Gera docs/qrcode.png com o link do editor (rode: npm run qrcode).
import QRCode from 'qrcode';
const LINK = 'https://gaburadigital.github.io/gabura-editor-cenas/';
await QRCode.toFile('docs/qrcode.png', LINK, { width: 360, margin: 2, color: { dark: '#0c1a24', light: '#ffffff' } });
console.log('QR code salvo em docs/qrcode.png →', LINK);
