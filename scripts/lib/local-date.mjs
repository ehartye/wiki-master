// The machine's local day as YYYY-MM-DD, for the date a clipping or a decline is stamped with. A person reads these
// dates as the day they worked, so an evening clip west of UTC must not carry tomorrow's date, which the UTC cut
// (`toISOString().slice(0, 10)`) gives. scripts/log-entry.mjs builds its day the same way. Authored page stubs
// (lib/catalogs.mjs) and timestamps (`at:`) stay UTC.
export function localDate(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
