// `fs` for anything that walks or removes a `.app` tree: Electron's patched `fs` reads a file named `*.asar` as a virtual directory.
module.exports = process.versions.electron ? require('original-fs') : require('node:fs');
