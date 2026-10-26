// `--help` asks what a script does, so it must not do it: no vault is resolved, read or written, and no server
// starts. A script that changes things calls this from its command-line entry, before `main()`.
export function helpRequested(argv = process.argv.slice(2)) {
  return argv.includes('--help') || argv.includes('-h');
}

export function exitWithHelp(usage) {
  console.log(usage);
  process.exit(0);
}
