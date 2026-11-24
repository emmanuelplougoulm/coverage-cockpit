<script setup lang="ts">
import { ref } from 'vue';

/** Cadre de graphique : titre, phrase de lecture, et bascule vers la vue tableau. */
const props = defineProps<{ title: string; lede?: string }>();
const table = ref(false);
</script>

<template>
  <section class="card frame">
    <header>
      <div>
        <h3>{{ props.title }}</h3>
        <p v-if="props.lede" class="lede">{{ props.lede }}</p>
      </div>
      <button class="ghost small" :aria-pressed="table" @click="table = !table">{{ table ? 'Graphique' : 'Tableau' }}</button>
    </header>
    <slot v-if="!table" />
    <slot v-else name="table" />
  </section>
</template>

<style scoped>
.frame header { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
.small { font-size: 12px; padding: 3px 8px; }
</style>
