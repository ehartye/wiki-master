import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// `node --test` runs every .mjs under test/ as a test file, this one included, so importing it must do nothing.

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');

// The `skip` option for every test in this lane.
export const laneSkip = process.env.WIKI_MASTER_BROWSER_TESTS === '1' ? false : 'set WIKI_MASTER_BROWSER_TESTS=1 to run real-browser tests';

// Serves test/browser/fixtures on a free local port and keeps a list of the requests it saw. Run the browser
// asynchronously against it: a spawnSync in this process would block the server it is waiting for.
export async function startFixtureServer() {
  const requests = [];
  const server = createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://fixture.test');
    requests.push({ method: req.method, path: pathname });
    try {
      const body = await readFile(join(FIXTURES, basename(pathname)));
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    requests,
    url: (path) => `http://127.0.0.1:${port}${path}`,
    close: () => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }),
  };
}
