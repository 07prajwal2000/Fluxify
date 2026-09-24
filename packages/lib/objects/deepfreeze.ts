export function deepFreeze(obj: any) {
	Object.freeze(obj);
	Object.getOwnPropertyNames(obj).forEach((prop) => {
		if (
			Object.hasOwn(obj, prop) &&
			obj[prop] !== null &&
			(typeof obj[prop] === "object" || typeof obj[prop] === "function") &&
			!Object.isFrozen(obj[prop])
		) {
			deepFreeze(obj[prop]);
		}
	});

	return obj;
}
