import DefaultTheme from "vitepress/theme";
import KeyGenerator from "./components/KeyGenerator.vue";
import "./custom.css";

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component("KeyGenerator", KeyGenerator);
  }
};
