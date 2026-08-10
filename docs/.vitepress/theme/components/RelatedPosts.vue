<template>
	<div v-if="related.length" class="related-posts">
		<h2 class="related-posts-title">Related posts</h2>
		<div class="related-posts-grid">
			<a v-for="post in related" :key="post.url" :href="post.url" class="related-card">
				<h3 class="related-card-title">{{ post.title }}</h3>
				<div class="related-card-meta">
					<span>{{ post.formattedDate }}</span>
					<span class="related-dot">·</span>
					<span v-for="tag in post.tags" :key="tag" class="related-tag" :class="{ shared: tags.includes(tag) }">
						{{ tag }}
					</span>
				</div>
			</a>
		</div>
	</div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useData } from "vitepress";
import { data as posts } from "../../../blog/posts.data";

const { frontmatter, page } = useData();

const tags = computed<string[]>(() => frontmatter.value.tags ?? []);

const related = computed(() => {
	if (!tags.value.length) return [];

	const currentUrl = "/" + page.value.relativePath.replace(/\.md$/, ".html");

	return posts
		.filter((p) => p.url !== currentUrl)
		.map((p) => ({
			post: p,
			shared: p.tags.filter((t) => tags.value.includes(t)).length,
		}))
		.filter((entry) => entry.shared > 0)
		.sort((a, b) => b.shared - a.shared || +new Date(b.post.date) - +new Date(a.post.date))
		.slice(0, 3)
		.map((entry) => entry.post);
});
</script>

<style scoped>
.related-posts {
	margin-top: 3rem;
	padding-top: 2rem;
	border-top: 1px solid var(--vp-c-divider);
}

.related-posts-title {
	font-size: 1.25rem;
	border-top: none;
	padding-top: 0;
	margin-bottom: 1rem;
}

.related-posts-grid {
	display: grid;
	grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
	gap: 1rem;
}

.related-card {
	display: block;
	padding: 0.9rem 1.1rem;
	border-radius: 10px;
	border: 1px solid var(--vp-c-divider);
	background-color: var(--vp-c-bg-soft);
	text-decoration: none;
	transition: border-color 0.2s, transform 0.15s;
}

.related-card:hover {
	border-color: var(--vp-c-brand-1);
	transform: translateY(-1px);
}

.related-card-title {
	margin: 0 0 0.5rem;
	border-top: none;
	padding-top: 0;
	font-size: 1rem;
	color: var(--vp-c-text-1);
}

.related-card-meta {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.35rem;
	font-size: 0.75rem;
	color: var(--vp-c-text-3);
}

.related-dot {
	opacity: 0.5;
}

.related-tag {
	padding: 0.05rem 0.5rem;
	border-radius: 999px;
	background-color: var(--vp-c-default-soft);
}

.related-tag.shared {
	background-color: var(--vp-c-brand-soft);
	color: var(--vp-c-brand-1);
}
</style>
