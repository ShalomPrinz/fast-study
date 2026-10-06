// Turns `hb <action> [args…]` into the request a browser.mjs session takes, so a caller types plain
// arguments instead of JSON escaped inside shell quotes.

export const ACTIONS = {
  goto: { usage: 'goto <path-or-url> [--browser TAG]', fields: ['url'], required: 1 },
  click: {
    usage: 'click <selector> [--shot NAME] [--browser TAG]',
    fields: ['selector'],
    required: 1,
  },
  fill: {
    usage: 'fill <selector> <value> [--shot NAME] [--browser TAG]',
    fields: ['selector', 'value'],
    required: 2,
  },
  press: {
    usage: 'press <key> [selector] [--shot NAME] [--browser TAG]',
    fields: ['key', 'selector'],
    required: 1,
  },
  eval: { usage: 'eval [js|-] [--browser TAG]', fields: [], required: 0 },
};

// Splits `--browser TAG` and `--shot NAME` from the positionals; `--` ends the flags, so a value
// that is itself `--shot` can still be passed.
function parse(args) {
  const flags = { browser: 'main', shot: undefined };
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--') {
      positional.push(...args.slice(i + 1));
      break;
    }
    if (arg === '--browser' || arg === '--shot') {
      if (i + 1 >= args.length) throw new Error(`${arg} needs a value`);
      flags[arg.slice(2)] = args[++i];
    } else positional.push(arg);
  }
  return { flags, positional };
}

// The request for one action: `{ tag, path, body }`, body a JSON string (or eval's raw JS).
// `readStdin` supplies eval's JS when none is given as an argument, or when it is `-`.
export function actionRequest(name, args, readStdin) {
  const action = ACTIONS[name];
  const { flags, positional } = parse(args);
  const usage = `usage: ${action.usage}`;
  const shotless = name === 'goto' || name === 'eval';
  if (shotless && flags.shot !== undefined) throw new Error(usage);
  if (positional.length < action.required || positional.length > Math.max(action.fields.length, 1))
    throw new Error(usage);
  if (name === 'eval') {
    const js = positional[0] === undefined || positional[0] === '-' ? readStdin() : positional[0];
    return { tag: flags.browser, path: '/eval', body: js };
  }
  const body = Object.fromEntries(action.fields.map((field, i) => [field, positional[i]]));
  if (flags.shot !== undefined) body.screenshot = flags.shot;
  return { tag: flags.browser, path: `/${name}`, body: JSON.stringify(body) };
}
