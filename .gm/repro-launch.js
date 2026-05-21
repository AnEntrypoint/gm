const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const chromiumBin = path.join(process.env.LOCALAPPDATA, 'ms-playwright', 'chromium-1223', 'chrome-win64', 'chrome.exe');
const profileDir = 'C:\\dev\\gm\\.gm\\browser-profile-repro';
fs.mkdirSync(profileDir, {recursive:true});
const port = 62820;
const args = [
  '--user-data-dir=' + profileDir,
  '--remote-debugging-port=' + port,
  '--remote-debugging-address=127.0.0.1',
  '--no-first-run', '--no-default-browser-check', '--disable-default-apps'
];
const child = spawn(chromiumBin, args, {
  detached: true,
  stdio: 'ignore',
  windowsHide: true,
  env: process.env,
  ...(process.platform === 'win32' ? { creationFlags: 0x08000000 | 0x00000008 } : {})
});
console.log('pid=' + child.pid);
child.unref();
setTimeout(() => {
  const http = require('http');
  http.get('http://127.0.0.1:' + port + '/json/version', (res) => {
    let b = '';
    res.on('data', d => b += d);
    res.on('end', () => console.log('CDP status=' + res.statusCode + ' body=' + b.slice(0, 300)));
  }).on('error', e => console.log('CDP err=' + e.message));
}, 6000);
setTimeout(() => process.exit(0), 10000);
