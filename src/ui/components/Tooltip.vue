<script setup lang="ts">
import { tip } from './tooltip';
</script>

<template>
  <div v-if="tip.visible" class="tooltip" role="tooltip" :style="{ left: `${tip.x}px`, top: `${tip.y}px` }">
    <div v-for="(l, i) in tip.lines" :key="i" :class="{ first: i === 0 }">{{ l }}</div>
  </div>
</template>

<style scoped>
.first { font-weight: 600; margin-bottom: 2px; }
</style>
