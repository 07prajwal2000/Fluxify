// Writes today's version, `YYYY.M.DDNN` (UTC): valid semver with no leading
// zeros, `NN` counting releases on one day from 01. Never a `-n` suffix: that
// is a prerelease and sorts below the plain version.

/** the version after `current` for a release on `now` */
export function nextVersion(current: string, now = new Date()): string {
	const [year, month, day] = [now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate()];
	const [y, m, patch] = current.split(".").map(Number);
	const sameDay = y === year && m === month && Math.floor(patch / 100) === day;
	const n = sameDay ? (patch % 100) + 1 : 1;
	if (n > 99) throw new Error(`already 99 releases on ${year}-${month}-${day}`);
	return `${year}.${month}.${day * 100 + n}`;
}

if (import.meta.main) {
	const file = Bun.file(new URL("../package.json", import.meta.url));
	const pkg = await file.json();
	pkg.version = nextVersion(pkg.version);
	await Bun.write(file, `${JSON.stringify(pkg, null, "\t")}\n`);
	console.log(pkg.version);
}
