const quote = (s: string) => "'" + s.replaceAll("'", "'\"'\"'") + "'";
export function museCommands(base: string, binary: string, stage = "screening", taskFile = `${base}/task.md`) {
  const plugin = `${base}/integrations/muse/jobpipe-observer`;
  return {
    setup: `${quote(binary)} plugins validate ${quote(plugin)} --json && (\n  jobpipe_setup_dir="$(mktemp -d)" &&\n  cd "$jobpipe_setup_dir" &&\n  ${quote(binary)} plugins install ${quote(plugin)} --scope user --json\n) && ${quote(binary)} plugins approve jobpipe-observer --json`,
    start: `cd ${quote(base)} && node ${quote(`${base}/scripts/muse-start.ts`)} --stage ${quote(stage)} --task-file ${quote(taskFile)} --trust-workspace`,
    revoke: `${quote(binary)} plugins reject jobpipe-observer --json`,
  };
}
