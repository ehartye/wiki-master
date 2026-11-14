import { existsSync } from 'node:fs';
import { join } from 'node:path';

// A server that does not send its intermediate certificate. A browser, and a downloader built on the operating system's TLS, reads the
// address of the missing certificate from the server's own certificate (Authority Information Access), fetches it and verifies the
// whole chain. Node does neither, so the request fails with UNABLE_TO_VERIFY_LEAF_SIGNATURE, and the hint Node adds (--use-system-ca)
// does not help: the root is already trusted, and the certificate between it and the server's is what is missing.
//
// Verification is never turned off here. The only retry is a second download by a program that verifies the certificate itself,
// against the operating system's trust store. A server with an untrusted root, an expired certificate or a wrong host name fails
// that retry too, and every other certificate error is not retried at all.

// True only for the error a missing intermediate gives. An untrusted root in a full chain (SELF_SIGNED_CERT_IN_CHAIN), a self-signed
// certificate (DEPTH_ZERO_SELF_SIGNED_CERT), an expired one (CERT_HAS_EXPIRED) and a wrong host name (ERR_TLS_CERT_ALTNAME_INVALID)
// have their own codes.
export function isIncompleteChain(error) {
  return (error?.cause?.code ?? error?.code) === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE';
}

// The downloader the operating system ships, where it verifies with the system's trust and completes a chain: curl on Windows
// (Schannel) and on macOS. It is named by its system path, never taken from PATH, because another curl there may use a different TLS
// library. Elsewhere there is none: a curl built on OpenSSL or GnuTLS fails on an incomplete chain exactly as Node does.
export function systemDownloader({ platform = process.platform, env = process.env, exists = existsSync } = {}) {
  const path = platform === 'win32' ? join(env.SystemRoot ?? env.windir ?? 'C:\\Windows', 'System32', 'curl.exe')
    : platform === 'darwin' ? '/usr/bin/curl'
    : null;
  return path && exists(path) ? { name: 'curl', command: path } : null;
}

// One download to standard output. The user's curl configuration is not read (-q, which must come first), so nothing in it can switch
// verification off; redirects are followed as fetch follows them, to http and https only; an error status is an error, not a body.
// No option here relaxes a certificate or revocation check, and none may be added.
export function systemDownloadArgs(url) {
  return ['-q', '--silent', '--show-error', '--globoff', '--fail', '--location', '--max-redirs', '20',
    '--proto', '=http,https', '--proto-redir', '=http,https', '--connect-timeout', '30', '--output', '-', '--url', url];
}

const ROUTE = 'download the file in a browser, then clip the saved file with --source=<address>';
const INCOMPLETE = "the server's certificate chain is incomplete (it does not send its intermediate certificate)";

// What to say when the chain could not be completed: `detail` is the system downloader's own failure, absent when there is no such
// downloader on this system.
export function incompleteChainReason(detail) {
  return detail
    ? `${INCOMPLETE}, and the retry through the system downloader failed (${detail}); ${ROUTE}`
    : `${INCOMPLETE}, and this system has no downloader that completes a chain while verifying it; ${ROUTE}`;
}
