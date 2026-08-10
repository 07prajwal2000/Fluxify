import { createContentLoader } from "vitepress";

export interface Post {
	title: string;
	url: string;
	date: string;
	formattedDate: string;
	excerpt: string | undefined;
	author: string;
	tags: string[];
	pinned: boolean;
}

declare const data: Post[];
export { data };

export default createContentLoader("blog/posts/*.md", {
	excerpt: true,
	transform(raw): Post[] {
		return raw
			.map((page) => {
				const date = page.frontmatter.date as string;
				return {
					title: page.frontmatter.title ?? "Untitled",
					url: page.url,
					date,
					formattedDate: new Date(date).toLocaleDateString("en-US", {
						year: "numeric",
						month: "long",
						day: "numeric",
					}),
					excerpt: page.excerpt,
					author: page.frontmatter.author ?? "Fluxify Team",
					tags: page.frontmatter.tags ?? [],
					pinned: page.frontmatter.pinned === true,
				};
			})
			.sort((a, b) => +new Date(b.date) - +new Date(a.date));
	},
});
