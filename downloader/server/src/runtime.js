// Binds the express app to loopback only and reports the port it actually got.
// FASTSTUDY_PORT=0 asks the OS for an ephemeral port, so the bound port is read back off
// server.address() and printed alone on its own line for the launcher to parse.
export function serve(app, defaultPort, onListening) {
  const port = Number(process.env.FASTSTUDY_PORT ?? defaultPort);
  const server = app.listen(port, '127.0.0.1', () => {
    const boundPort = server.address().port;
    console.log(`FASTSTUDY_PORT=${boundPort}`);
    onListening(boundPort);
  });
  return server;
}
