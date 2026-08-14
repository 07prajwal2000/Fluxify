<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";

const image = ref<{ src: string; alt: string } | null>(null);

function close() {
  image.value = null;
}

function onDocumentClick(event: MouseEvent) {
  const target = event.target;

  if (!(target instanceof HTMLImageElement)) return;
  if (!target.closest(".vp-doc") || target.closest(".image-lightbox")) return;
  if (target.dataset.zoom === "false") return;

  event.preventDefault();
  image.value = {
    src: target.currentSrc || target.src,
    alt: target.alt || "Expanded documentation image",
  };
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") close();
}

watch(image, (value) => {
  document.documentElement.classList.toggle("image-lightbox-open", Boolean(value));
});

onMounted(() => {
  document.addEventListener("click", onDocumentClick);
  document.addEventListener("keydown", onKeydown);
});

onBeforeUnmount(() => {
  document.documentElement.classList.remove("image-lightbox-open");
  document.removeEventListener("click", onDocumentClick);
  document.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="image"
      class="image-lightbox"
      role="dialog"
      aria-modal="true"
      :aria-label="image.alt"
      @click.self="close"
    >
      <button class="image-lightbox__close" type="button" aria-label="Close expanded image" @click="close">
        ×
      </button>
      <img class="image-lightbox__image" :src="image.src" :alt="image.alt" />
    </div>
  </Teleport>
</template>
