import { eq } from "drizzle-orm";
import { db } from "../../../../db";
import { instanceLicenseEntity } from "../../../../db/schema";
import { systemUsers } from "../../../../db/auth-schema";

const ID = "current";

export async function getStoredLicense() {
	const [row] = await db
		.select({
			key: instanceLicenseEntity.key,
			confirmedAt: instanceLicenseEntity.confirmedAt,
			confirmedByName: systemUsers.name,
			confirmedByEmail: systemUsers.email,
		})
		.from(instanceLicenseEntity)
		.leftJoin(systemUsers, eq(systemUsers.id, instanceLicenseEntity.confirmedBy))
		.where(eq(instanceLicenseEntity.id, ID));
	return row ?? null;
}

export async function saveStoredLicense(value: {
	key: string | null;
	confirmedBy: string | null;
	confirmedAt: Date | null;
}) {
	await db
		.insert(instanceLicenseEntity)
		.values({ id: ID, ...value })
		.onConflictDoUpdate({ target: instanceLicenseEntity.id, set: value });
}
