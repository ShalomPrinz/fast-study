// Preloaded into every test child: node --test shares the child's stdout with its v8-serialized
// result frames and misparses interleaved app output (nodejs/node#64061), so app logs go to stderr.
console.log = console.error;
console.info = console.error;
