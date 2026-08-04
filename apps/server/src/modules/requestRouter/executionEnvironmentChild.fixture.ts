export {};

const response = await fetch(process.argv[2]!);
process.exit(response.ok ? 0 : 1);
