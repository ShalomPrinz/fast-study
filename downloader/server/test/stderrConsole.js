// Preloaded into every test child: node --test reads its v8-serialized result frames off the child's
// stdout and misparses app logs interleaved there (nodejs/node#64061), so console output goes to stderr.
console.log = console.error;
console.info = console.error;
