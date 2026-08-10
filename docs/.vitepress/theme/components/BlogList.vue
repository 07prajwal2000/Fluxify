<template>
	<div class="blog-list">
		<div v-if="allTags.length" class="blog-tag-bar">
			<button type="button" class="blog-tag-chip" :class="{ active: !activeTag }" @click="activeTag = null">
				All
			</button>
			<button
				v-for="tag in allTags"
				:key="tag"
				type="button"
				class="blog-tag-chip"
				:class="{ active: activeTag === tag }"
				@click="activeTag = activeTag === tag ? null : tag"
			>
				{{ tag }}
			</button>
		</div>

		<section v-if="pinned.length" class="blog-section">
			<h2 class="blog-section-title">Pinned</h2>
			<div class="blog-posts">
				<a v-for="post in pinned" :key="post.url" :href="post.url" class="blog-card blog-card-pinned">
					<span class="blog-pin-badge">Pinned</span>
					<h3 class="blog-card-title">{{ post.title }}</h3>
					<p v-if="post.excerpt" class="blog-card-excerpt" v-html="post.excerpt"></p>
					<div class="blog-card-meta">
						<span>{{ post.author }}</span>
						<span class="blog-dot">·</span>
						<span>{{ post.formattedDate }}</span>
						<template v-if="post.tags.length">
							<span class="blog-dot">·</span>
							<button
								v-for="tag in post.tags"
								:key="tag"
								type="button"
								class="blog-tag"
								@click.stop.prevent="activeTag = tag"
							>
								{{ tag }}
							</button>
						</template>
					</div>
				</a>
			</div>
		</section>

		<section v-for="year in years" :key="year" class="blog-section">
			<h2 class="blog-section-title">{{ year }}</h2>
			<div class="blog-posts">
				<a v-for="post in byYear[year]" :key="post.url" :href="post.url" class="blog-card">
					<h3 class="blog-card-title">{{ post.title }}</h3>
					<p v-if="post.excerpt" class="blog-card-excerpt" v-html="post.excerpt"></p>
					<div class="blog-card-meta">
						<span>{{ post.author }}</span>
						<span class="blog-dot">·</span>
						<span>{{ post.formattedDate }}</span>
						<template v-if="post.tags.length">
							<span class="blog-dot">·</span>
							<button
								v-for="tag in post.tags"
								:key="tag"
								type="button"
								class="blog-tag"
								@click.stop.prevent="activeTag = tag"
							>
								{{ tag }}
							</button>
						</template>
					</div>
				</a>
			</div>
		</section>

		<p v-if="!posts.length" class="blog-empty">No posts yet.</p>
		<p v-else-if="!pinned.length && !years.length" class="blog-empty">
			No posts tagged "{{ activeTag }}".
		</p>
	</div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import type { Post } from "../../../blog/posts.data";

const props = defineProps<{ posts: Post[] }>();

const activeTag = ref<string | null>(null);

const allTags = computed(() => {
	const tags = new Set<string>();
	for (const post of props.posts) {
		for (const tag of post.tags) tags.add(tag);
	}
	return [...tags].sort();
});

const filtered = computed(() =>
	activeTag.value
		? props.posts.filter((p) => p.tags.includes(activeTag.value!))
		: props.posts,
);

const pinned = computed(() => filtered.value.filter((p) => p.pinned));

const byYear = computed(() => {
	const groups: Record<string, Post[]> = {};
	for (const post of filtered.value) {
		const year = new Date(post.date).getFullYear().toString();
		(groups[year] ??= []).push(post);
	}
	return groups;
});

const years = computed(() =>
	Object.keys(byYear.value).sort((a, b) => Number(b) - Number(a)),
);
</script>

<style scoped>
.blog-list {
	margin-top: 1.5rem;
}

.blog-section {
	margin-bottom: 2.5rem;
}

.blog-section-title {
	font-size: 1.5rem;
	border-top: none;
	padding-top: 0;
	margin-bottom: 1rem;
}

.blog-posts {
	display: flex;
	flex-direction: column;
	gap: 1rem;
}

.blog-card {
	display: block;
	padding: 1.1rem 1.4rem;
	border-radius: 10px;
	border: 1px solid var(--vp-c-divider);
	background-color: var(--vp-c-bg-soft);
	text-decoration: none;
	transition: border-color 0.2s, transform 0.15s;
}

.blog-card:hover {
	border-color: var(--vp-c-brand-1);
	transform: translateY(-1px);
}

.blog-card-pinned {
	border-color: var(--vp-c-brand-1);
	background-color: var(--vp-c-brand-soft);
}

.blog-tag-bar {
	display: flex;
	flex-wrap: wrap;
	gap: 0.5rem;
	margin-bottom: 2rem;
}

.blog-tag-chip {
	padding: 0.3rem 0.8rem;
	border-radius: 999px;
	border: 1px solid var(--vp-c-divider);
	background-color: var(--vp-c-bg-soft);
	color: var(--vp-c-text-2);
	font-size: 0.8rem;
	cursor: pointer;
	transition: border-color 0.2s, color 0.2s;
}

.blog-tag-chip:hover {
	border-color: var(--vp-c-brand-1);
	color: var(--vp-c-text-1);
}

.blog-tag-chip.active {
	border-color: var(--vp-c-brand-1);
	background-color: var(--vp-c-brand-soft);
	color: var(--vp-c-brand-1);
	font-weight: 600;
}

.blog-pin-badge {
	display: inline-block;
	font-size: 0.7rem;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.05em;
	color: var(--vp-c-brand-1);
	margin-bottom: 0.4rem;
}

.blog-card-title {
	margin: 0 0 0.4rem;
	border-top: none;
	padding-top: 0;
	font-size: 1.15rem;
	color: var(--vp-c-text-1);
}

.blog-card-excerpt {
	margin: 0 0 0.6rem;
	color: var(--vp-c-text-2);
	font-size: 0.9rem;
}

.blog-card-meta {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	gap: 0.35rem;
	font-size: 0.8rem;
	color: var(--vp-c-text-3);
}

.blog-dot {
	opacity: 0.5;
}

.blog-tag {
	padding: 0.05rem 0.5rem;
	border-radius: 999px;
	border: none;
	background-color: var(--vp-c-default-soft);
	color: var(--vp-c-text-3);
	font-size: 0.75rem;
	cursor: pointer;
}

.blog-tag:hover {
	background-color: var(--vp-c-brand-soft);
	color: var(--vp-c-brand-1);
}

.blog-empty {
	color: var(--vp-c-text-2);
}
</style>
