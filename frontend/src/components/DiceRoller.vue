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
  <div class="die-wrap" :class="{ 'die-rolling': props.isRolling }">
    <div class="die">
      <div class="die-face">
        <span
          v-for="(active, i) in pips"
          :key="i"
          class="pip"
          :class="{ 'pip-active': active }"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Fixed, theme-independent colors -- like the game boards, a die is a
   physical object that should look the same regardless of light/dark
   app theme. It previously used var(--color-text) for its border and
   pips, which is near-white in the current dark theme and made the
   whole die nearly invisible against its own white face. */
.die-wrap {
  width: 38px;
  height: 38px;
}

.die {
  position: relative;
  width: 100%;
  height: 100%;
}

/* Front face */
.die-face {
  position: relative;
  z-index: 2;
  width: 100%;
  height: 100%;
  background: linear-gradient(155deg, #ffffff, #e7e1cf);
  border: 1.5px solid #2b2b2b;
  border-radius: 7px;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  padding: 4px;
  box-sizing: border-box;
  box-shadow:
    inset 0 2px 3px rgba(255, 255, 255, 0.9),
    inset 0 -4px 5px rgba(0, 0, 0, 0.18);
}

/* Right and bottom side faces, skewed to fake a cube viewed slightly
   from above -- a well-worn CSS trick for a die/box that reads as a
   real 3D object without distorting (and so keeping legible) the pips
   on the front face. */
.die::before,
.die::after {
  content: '';
  position: absolute;
  background: linear-gradient(180deg, #cbbf9e, #8a7c56);
  z-index: 1;
}

.die::before {
  top: 2px;
  right: -6px;
  width: 6px;
  height: calc(100% - 2px);
  border-radius: 0 4px 4px 0;
  transform: skewY(45deg);
  transform-origin: top left;
}

.die::after {
  left: 2px;
  bottom: -6px;
  width: calc(100% - 2px);
  height: 6px;
  border-radius: 0 0 4px 4px;
  transform: skewX(45deg);
  transform-origin: top left;
  background: linear-gradient(90deg, #a5966b, #8a7c56);
}

.pip {
  border-radius: 50%;
  align-self: center;
  justify-self: center;
  width: 6px;
  height: 6px;
}

.pip-active {
  background: radial-gradient(circle at 32% 28%, #4b5563, #111827 75%);
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.35),
    0 1px 1px rgba(0, 0, 0, 0.4);
}

.die-rolling .die {
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
