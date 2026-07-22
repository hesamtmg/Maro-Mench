<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{
  value: number | null;
  isRolling: boolean;
}>();

// Pip layout per face, as a 3x3 grid of booleans (row-major).
const PIP_LAYOUTS: Record<number, boolean[]> = {
  1: [false, false, false, false, true, false, false, false, false],
  2: [true, false, false, false, false, false, false, false, true],
  3: [true, false, false, false, true, false, false, false, true],
  4: [true, false, true, false, false, false, true, false, true],
  5: [true, false, true, false, true, false, true, false, true],
  6: [true, false, true, true, false, true, true, false, true],
};

const displayValue = computed(() => props.value ?? 1);
const pips = computed(() => PIP_LAYOUTS[displayValue.value] ?? PIP_LAYOUTS[1]);
</script>

<template>
  <div class="die" :class="{ 'die-rolling': props.isRolling }">
    <div class="die-face">
      <span
        v-for="(active, i) in pips"
        :key="i"
        class="pip"
        :class="{ 'pip-active': active }"
      />
    </div>
  </div>
</template>

<style scoped>
.die {
  width: 56px;
  height: 56px;
  perspective: 200px;
}

.die-face {
  width: 100%;
  height: 100%;
  background: white;
  border: 2px solid var(--color-text);
  border-radius: 10px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  padding: 7px;
  box-sizing: border-box;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
}

.pip {
  border-radius: 50%;
  align-self: center;
  justify-self: center;
  width: 9px;
  height: 9px;
}

.pip-active {
  background: var(--color-text);
}

.die-rolling .die-face {
  animation: roll 0.5s ease-in-out;
}

@keyframes roll {
  0% {
    transform: rotate(0deg) scale(1);
  }
  25% {
    transform: rotate(90deg) scale(1.1);
  }
  50% {
    transform: rotate(180deg) scale(1);
  }
  75% {
    transform: rotate(270deg) scale(1.1);
  }
  100% {
    transform: rotate(360deg) scale(1);
  }
}
</style>
