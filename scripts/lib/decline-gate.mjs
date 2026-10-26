import { loadDeclines, isDeclined, isAutomaticDecline, supersedeDecline } from './decline.mjs';

// What a clipper does when the source it was given has an active decline, and the two flags that lift one.
//
//   --override-decline            the decline was recorded by a clipper from what it read (thin, wrong node) and the
//                                 caller has the document another way (a saved file, a manual print to PDF)
//   --supersede-decline="reason"  any decline: the reason it no longer holds is written down with it
//
// Neither flag does anything until the clipper has written its clipping and calls `finish()`, so a clip that fails
// leaves the decline in place. A decline someone recorded on purpose is never lifted by --override-decline.

export const OVERRIDE_REASON = 'overridden: clipped by hand after an automatic decline';

export function declineFlags(argv) {
  const override = argv.includes('--override-decline');
  const arg = argv.find((a) => a.startsWith('--supersede-decline'));
  if (arg === undefined) return { override, supersede: undefined };
  const reason = arg.startsWith('--supersede-decline=') ? arg.slice('--supersede-decline='.length).trim() : '';
  if (!reason) return { error: '--supersede-decline needs a reason: --supersede-decline="why this decline no longer holds"' };
  if (override) return { error: 'use one of --override-decline and --supersede-decline, not both' };
  return { override: false, supersede: reason };
}

// { blocked: true, message | error } stops the clipper; { blocked: false, finish } lets it go on and `finish()` is
// called once the clipping is written.
export function declineGate(vaultPath, source, argv, { log = console.log } = {}) {
  const flags = declineFlags(argv);
  if (flags.error) return { blocked: true, error: flags.error };
  const entry = loadDeclines(vaultPath).find((d) => isDeclined(source, [d]));
  if (!entry) return { blocked: false, finish() {} };
  const prior = `${entry.date}: ${entry.reason}`;
  if (flags.supersede) {
    return { blocked: false, finish() { supersedeDecline(vaultPath, source, flags.supersede); log(`superseded the prior decline (${prior}): ${source}`); } };
  }
  if (flags.override) {
    if (isAutomaticDecline(entry)) {
      return { blocked: false, finish() { supersedeDecline(vaultPath, source, OVERRIDE_REASON, { onlyAutomatic: true }); log(`lifted the prior automatic decline (--override-decline; ${prior}): ${source}`); } };
    }
    return { blocked: true, message: `declined previously (${prior}): ${source}\n  --override-decline lifts only a decline the clippers recorded themselves (thin content, wrong node); this one was recorded on purpose. To clip anyway and keep the reason: --supersede-decline="reason"` };
  }
  return { blocked: true, message: `declined previously (${prior}): ${source}` };
}
