import { h } from "vue";
import DefaultTheme from "vitepress/theme";
import KeyGenerator from "./components/KeyGenerator.vue";
import BlogList from "./components/BlogList.vue";
import RelatedPosts from "./components/RelatedPosts.vue";
import ImageLightbox from "./components/ImageLightbox.vue";
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
  }
};
