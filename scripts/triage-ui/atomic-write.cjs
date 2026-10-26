// A file other processes poll for and read the moment it exists (the triage server's state/server-info) is written
// under a temporary name and renamed into place, so a reader sees the whole file or none. Written in place, it was
// briefly empty or cut off, and a reader that arrived in that window failed to parse it.
const fs = require('fs');

function writeFileAtomic(file, text) {
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

module.exports = { writeFileAtomic };
