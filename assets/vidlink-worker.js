// Worker persistente que genera tokens de vidlink.
// Protocolo por stdin/stdout: recibe un id por línea, responde `OK <id> <token>` o `ERR <id> <msg>`.
const fs = require('node:fs');
const readline = require('node:readline');

function fail(msg) {
  process.stdout.write(`FATAL ${msg}\n`);
  process.exit(1);
}

if (!globalThis.fs) {
  const nfs = require('node:fs');
  globalThis.fs = {
    constants: { O_WRONLY: nfs.constants.O_WRONLY, O_RDWR: nfs.constants.O_RDWR, O_CREAT: nfs.constants.O_CREAT, O_TRUNC: nfs.constants.O_TRUNC, O_APPEND: nfs.constants.O_APPEND, O_EXCL: nfs.constants.O_EXCL },
    writeSync(fd, buf) { process.stderr.write(String(buf)); return buf.length; },
    write(fd, buf, offset, length, position, cb) { if (cb) cb(null, length); return length; },
    readSync() { throw new Error('not implemented'); },
    read() { throw new Error('not implemented'); },
    open() { throw new Error('not implemented'); },
    close() {},
    stat() { throw new Error('not implemented'); },
    lstat() { throw new Error('not implemented'); },
    fstat() { throw new Error('not implemented'); },
  };
}
globalThis.window = globalThis;
globalThis.self = globalThis;
globalThis.proc = globalThis.proc || { exit: () => {} };
globalThis.navigator = {
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  platform: 'Win32',
  language: 'es-MX',
  languages: ['es-MX', 'es', 'en'],
  hardwareConcurrency: 8,
  maxTouchPoints: 0,
};
globalThis.location = { href: 'https://vidlink.pro/', origin: 'https://vidlink.pro', protocol: 'https:', host: 'vidlink.pro' };

(async () => {
  const sodium = require(process.argv[4]);
  await sodium.ready;
  globalThis.sodium = sodium;

  const scriptPath = process.argv[2];
  const wasmPath = process.argv[3];

  eval(fs.readFileSync(scriptPath, 'utf8'));

  const go = new globalThis.Dm();
  const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasmPath), go.importObject);
  go.run(instance);
  await new Promise((r) => setTimeout(r, 900));

  if (typeof globalThis.getAdv !== 'function') fail('getAdv unavailable');

  process.stdout.write('READY\n');

  const rl = readline.createInterface({ input: process.stdin });
  rl.on('line', (line) => {
    const id = line.trim();
    if (!id) return;
    try {
      const token = globalThis.getAdv(id);
      process.stdout.write(`${!token || token === 'null' ? 'ERR' : 'OK'} ${id} ${token || 'null'}\n`);
    } catch (e) {
      process.stdout.write(`ERR ${id} ${e.message}\n`);
    }
  });
})();
