// Optional pm2 integration for `tapdeck setup` — registering tapdeck with the
// pm2 process manager so it starts at boot. Isolated here so the entry point
// stays routing + handlers, and so the only `--allow-run` use is in one place.

// Run a pm2 command, capturing stdout. Returns null if pm2 isn't installed.
async function pm2(
  args: string[],
): Promise<{ ok: boolean; stdout: string } | null> {
  try {
    const out = await new Deno.Command('pm2', {
      args,
      stdout: 'piped',
      stderr: 'null',
    }).output();
    return { ok: out.success, stdout: new TextDecoder().decode(out.stdout) };
  } catch {
    return null; // not on PATH
  }
}

// Offer to register tapdeck with pm2 so it starts at boot. Detects whether pm2
// is installed and whether tapdeck is already managed, and only acts on a yes.
export async function offerPm2(): Promise<void> {
  const list = await pm2(['jlist']);
  if (list === null) {
    console.log(
      '\nTo run tapdeck at boot, install pm2 (npm i -g pm2) and then:\n' +
        '  pm2 start tapdeck --name tapdeck && pm2 save',
    );
    return;
  }
  let managed = false;
  try {
    managed = (JSON.parse(list.stdout || '[]') as { name?: string }[])
      .some((p) => p?.name === 'tapdeck');
  } catch {
    // unparseable jlist — treat as not managed
  }
  if (managed) {
    console.log('\npm2 is already managing tapdeck — autostart is set.');
    return;
  }
  if (!confirm('\nStart tapdeck at boot with pm2 now?')) return;
  // Use the running binary's own path so pm2 launches tapdeck, not a stray name.
  await pm2(['start', Deno.execPath(), '--name', 'tapdeck']);
  await pm2(['save']);
  console.log(
    'Registered with pm2. Run `pm2 startup` once and follow its instructions ' +
      'to enable start-at-boot.',
  );
}
