<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.store';
import type { AxiosError } from 'axios';

const router = useRouter();
const route = useRoute();
const authStore = useAuthStore();

const identifier = ref('');
const password = ref('');
const isSubmitting = ref(false);
const errorMessage = ref('');

async function handleSubmit() {
  errorMessage.value = '';
  isSubmitting.value = true;
  try {
    await authStore.login(identifier.value, password.value);
    const redirect = (route.query.redirect as string) || '/';
    await router.push(redirect);
  } catch (err) {
    const axiosErr = err as AxiosError<{ message: string }>;
    errorMessage.value =
      axiosErr.response?.data?.message ?? 'Invalid email/phone or password.';
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <div class="page-container">
    <div class="card">
      <h1 class="text-center">MaroMench</h1>
      <p class="text-muted text-center">Log in to play منچ &amp; ماروپله</p>

      <form class="stack" @submit.prevent="handleSubmit">
        <div class="form-group">
          <label for="identifier">Email or phone number</label>
          <input
            id="identifier"
            v-model="identifier"
            type="text"
            required
            placeholder="you@example.com or +15551234567"
          />
        </div>

        <div class="form-group">
          <label for="password">Password</label>
          <input
            id="password"
            v-model="password"
            type="password"
            required
            placeholder="Your password"
          />
        </div>

        <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>

        <button type="submit" class="btn btn-primary" :disabled="isSubmitting">
          {{ isSubmitting ? 'Logging in…' : 'Log in' }}
        </button>
      </form>

      <div class="row-between" style="margin-top: 1.5rem">
        <router-link :to="{ name: 'forgot-password' }" class="text-muted"
          >Forgot password?</router-link
        >
        <router-link :to="{ name: 'register' }">Create account</router-link>
      </div>
    </div>
  </div>
</template>
