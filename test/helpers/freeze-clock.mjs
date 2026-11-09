// A preload for a child process that must see a chosen instant: `node --import <this file's URL> script.mjs ...` with
// WM_FREEZE_NOW=<ISO instant> in the child's environment. `new Date()` and `Date.now()` then start at that instant and
// advance with the real clock, so timeouts and deadlines in the script still work. Every other use of Date (a date
// built from an argument, Date.parse, Date.UTC, instanceof) is the real one.
//
// Without WM_FREEZE_NOW this module does nothing: `node --test` loads every .mjs below test/ as a test file, this one
// included.
const frozen = process.env.WM_FREEZE_NOW;
if (frozen !== undefined) {
  const RealDate = Date;
  const start = RealDate.parse(frozen);
  if (Number.isNaN(start)) throw new Error(`freeze-clock: WM_FREEZE_NOW is not a date: ${JSON.stringify(frozen)}`);
  const realNow = RealDate.now;
  const origin = realNow();
  const now = () => start + (realNow() - origin);
  globalThis.Date = new Proxy(RealDate, {
    construct: (target, args, newTarget) => Reflect.construct(target, args.length ? args : [now()], newTarget),
    apply: (target) => new target(now()).toString(),
    get: (target, prop, receiver) => (prop === 'now' ? now : Reflect.get(target, prop, receiver)),
  });
}
