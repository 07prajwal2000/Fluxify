/** Vite's `?worker` import suffix — declared here so the package doesn't need
 *  a dependency on vite just for its client types. */
declare module "*?worker" {
	const WorkerConstructor: new () => Worker;
	export default WorkerConstructor;
}
