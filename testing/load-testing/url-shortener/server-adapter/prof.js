// loads a server bundle and serves it, exiting cleanly on SIGTERM so --cpu-prof flushes
const m = await import(process.env.BUNDLE);
Bun.serve(m.default);
process.on("SIGTERM", () => process.exit(0));
