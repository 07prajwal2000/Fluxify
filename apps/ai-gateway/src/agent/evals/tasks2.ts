import { expectCall, routeActive, type Task } from "./checks";

/**
 * More eval tasks, kept out of tasks.ts so that file stays under the FTA cap.
 * Same rules: checks call the route, so any working solution passes.
 */

export const moreTasks: Task[] = [
	{
		id: "greeting-expression",
		title: "Dynamic value from the query",
		prompt:
			'Build GET /hello that answers { "message": "Hello <name>" }, using the `name` query param.',
		checks: [
			routeActive("GET", "/hello"),
			expectCall(
				"greets Ada",
				"GET",
				"/hello",
				{ query: { name: "Ada" } },
				{ status: 200, body: { message: "Hello Ada" } },
			),
			expectCall(
				"greets Grace",
				"GET",
				"/hello",
				{ query: { name: "Grace" } },
				{ status: 200, body: { message: "Hello Grace" } },
			),
		],
		judge: [
			"Made the name dynamic with a `js:` value or code, not a `{{ }}` template or text like `input.name` in a plain field",
			"Called the route with more than one name, or saw the result change with the name",
			"Ended with a short, accurate summary of what changed",
		],
	},
];
