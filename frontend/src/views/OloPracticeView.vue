<script setup lang="ts">
import { useRouter } from 'vue-router';
import OloBoard from '../components/OloBoard.vue';

const router = useRouter();
</script>

<template>
  <div class="page-container-wide">
    <div class="row-between" style="margin-bottom: 1.5rem">
      <h1 style="margin: 0">OLO Practice</h1>
      <button class="btn btn-secondary" @click="router.push({ name: 'home' })">
        Back
      </button>
    </div>
    <p class="text-muted text-center" style="margin-bottom: 1rem">
      Offline only -- pass &amp; play on this device, or against a bot. For a
      real online match, create or join a room from the OLO lobby instead.
    </p>
    <OloBoard mode="local" />
  </div>
</template>
