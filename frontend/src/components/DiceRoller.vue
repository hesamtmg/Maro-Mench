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

// A real six-faced cube: opposite faces sum to 7, like a physical die.
// Each entry is the face's placement on the cube, and the rotation that
// turns the whole cube so that face points at the viewer.
const FACES: Array<{ value: number; place: string; show: string }> = [
  { value: 1, place: 'rotateY(0deg)', show: 'rotateX(0deg) rotateY(0deg)' },
  { value: 6, place: 'rotateY(180deg)', show: 'rotateX(0deg) rotateY(180deg)' },
  { value: 2, place: 'rotateY(90deg)', show: 'rotateX(0deg) rotateY(-90deg)' },
  { value: 5, place: 'rotateY(-90deg)', show: 'rotateX(0deg) rotateY(90deg)' },
  { value: 3, place: 'rotateX(90deg)', show: 'rotateX(-90deg) rotateY(0deg)' },
  { value: 4, place: 'rotateX(-90deg)', show: 'rotateX(90deg) rotateY(0deg)' },
];

const displayValue = computed(() => {
  const v = props.value ?? 1;
  return PIP_LAYOUTS[v] ? v : 1;
});

const cubeTransform = computed(
  () => FACES.find((f) => f.value === displayValue.value)?.show ?? FACES[0].show,
);
</script>

<template>
  <div
    class="die-wrap"
    :class="{ 'die-rolling': props.isRolling }"
    role="img"
    :aria-label="props.isRolling ? 'Rolling die' : `Die showing ${displayValue}`"
  >
    <div class="die-tilt">
      <div class="die-cube" :style="{ transform: cubeTransform }">
        <div
          v-for="face in FACES"
          :key="face.value"
          class="die-face"
          :class="{ 'die-face-front': face.value === displayValue }"
          :style="{ transform: `${face.place} translateZ(var(--half))` }"
        >
          <!-- Only the face that's actually showing carries .pip-active,
               so the count of active pips always equals the rolled value. -->
          <span
            v-for="(active, i) in PIP_LAYOUTS[face.value]"
            :key="i"
            class="pip"
            :class="{
              'pip-on': active,
              'pip-active': active && face.value === displayValue,
              'pip-red': active && face.value === 1,
            }"
          />
        </div>
      </div>
    </div>
    <span class="die-shadow" />
  </div>
</template>

<style scoped>
/* Fixed, theme-independent colors: a die is a physical object and should
   look the same regardless of app theme. */
.die-wrap {
  --size: 40px;
  --half: calc(var(--size) / 2);
  position: relative;
  width: var(--size);
  height: var(--size);
  perspective: 260px;
  flex-shrink: 0;
}

/* A fixed viewing angle, so two side faces always show a little and the
   die reads as a solid cube rather than a flat tile. */
.die-tilt {
  width: 100%;
  height: 100%;
  transform-style: preserve-3d;
  transform: rotateX(-18deg) rotateY(-24deg);
}

.die-cube {
  position: relative;
  width: 100%;
  height: 100%;
  transform-style: preserve-3d;
  transition: transform 0.55s cubic-bezier(0.2, 1.4, 0.4, 1);
}

.die-face {
  position: absolute;
  inset: 0;
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  grid-template-rows: repeat(3, 1fr);
  padding: 15%;
  border-radius: 22%;
  background:
    radial-gradient(circle at 30% 25%, #ffffff 0%, #f6f1e4 55%, #ddd3bb 100%);
  box-shadow:
    inset 0 0 0 1px rgba(0, 0, 0, 0.18),
    inset 0 -3px 5px rgba(0, 0, 0, 0.12),
    inset 0 2px 3px rgba(255, 255, 255, 0.9);
  backface-visibility: hidden;
}

.pip {
  align-self: center;
  justify-self: center;
  width: 72%;
  aspect-ratio: 1;
  border-radius: 50%;
}

.pip-on {
  background: radial-gradient(circle at 35% 30%, #4b5563, #0f172a 75%);
  box-shadow:
    inset 0 1px 1px rgba(255, 255, 255, 0.25),
    0 0.5px 0 rgba(255, 255, 255, 0.8);
}

/* Classic red ace. */
.pip-red {
  width: 95%;
  background: radial-gradient(circle at 35% 30%, #f87171, #b91c1c 75%);
}

.die-shadow {
  position: absolute;
  left: 8%;
  right: 0;
  bottom: -9px;
  height: 8px;
  border-radius: 50%;
  background: radial-gradient(ellipse, rgba(0, 0, 0, 0.55), transparent 70%);
  filter: blur(1px);
  pointer-events: none;
}

.die-rolling .die-cube {
  animation: tumble 0.6s linear infinite;
}

.die-rolling .die-shadow {
  animation: shadow-bob 0.3s ease-in-out infinite alternate;
}

.die-rolling {
  animation: hop 0.3s ease-in-out infinite alternate;
}

@keyframes tumble {
  0% {
    transform: rotateX(0deg) rotateY(0deg) rotateZ(0deg);
  }
  100% {
    transform: rotateX(360deg) rotateY(720deg) rotateZ(180deg);
  }
}

@keyframes hop {
  from {
    translate: 0 0;
  }
  to {
    translate: 0 -6px;
  }
}

@keyframes shadow-bob {
  from {
    transform: scale(1);
    opacity: 1;
  }
  to {
    transform: scale(0.7);
    opacity: 0.5;
  }
}

@media (prefers-reduced-motion: reduce) {
  .die-cube {
    transition: none;
  }
  .die-rolling,
  .die-rolling .die-cube,
  .die-rolling .die-shadow {
    animation: none;
  }
}
</style>
