import DefaultTheme from "vitepress/theme";
import { h } from "vue";
import BlogList from "./components/BlogList.vue";
import ImageLightbox from "./components/ImageLightbox.vue";
import KeyGenerator from "./components/KeyGenerator.vue";
import RelatedPosts from "./components/RelatedPosts.vue";
import "./custom.css";

export default {
	extends: DefaultTheme,
	Layout() {
		return h(DefaultTheme.Layout, null, {
			"doc-after": () => h("div", [h(RelatedPosts), h(ImageLightbox)]),
		});
	},
	enhanceApp({ app }) {
		app.component("KeyGenerator", KeyGenerator);
		app.component("BlogList", BlogList);
	},
};
