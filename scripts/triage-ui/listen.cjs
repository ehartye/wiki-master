'use strict';

// Binding a server to a chosen port, moving to another when the choice is unusable.
//
// The port is not load-bearing: the session link is reprintable, so a pick that fails is
// better replaced than fatal. Two failures are about the port rather than the host:
//   EADDRINUSE  another process holds it (another vault's server, or anything that grabbed it).
//   EACCES      the OS refuses this process the port. On Windows that is a reserved range or a
//               port another process holds exclusively; measured on one machine, 716 of the
//               16,383 ports in 49152-65534 refused a bind this way, so a uniformly random pick
//               died about one launch in 25 while only EADDRINUSE was retried.
// Anything else (an unusable host address, no network stack) will not change with the port, so it
// fails at once instead of looping.
const PORT_SPECIFIC = new Set(['EADDRINUSE', 'EACCES']);

function bindWithFallback(server, { host, port, pickPort, onBound, onFailed, maxMoves = 10 }) {
  let current = port;
  let moves = 0;
  server.on('error', (err) => {
    if (PORT_SPECIFIC.has(err.code) && moves < maxMoves) {
      moves++;
      current = pickPort();
      server.listen(current, host);
      return;
    }
    onFailed(err);
  });
  server.once('listening', () => onBound(current));
  server.listen(current, host);
}

module.exports = { bindWithFallback, PORT_SPECIFIC };
