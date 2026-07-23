<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.store';
import type { AxiosError } from 'axios';

const router = useRouter();
const authStore = useAuthStore();

const phoneNumber = ref('');
const email = ref('');
const password = ref('');
const displayName = ref('');
const isSubmitting = ref(false);
const errorMessage = ref('');

async function handleSubmit() {
  errorMessage.value = '';
  isSubmitting.value = true;
  try {
    await authStore.register({
      phoneNumber: phoneNumber.value,
      email: email.value,
      password: password.value,
      displayName: displayName.value,
    });
    await router.push({ name: 'home' });
  } catch (err) {
    const axiosErr = err as AxiosError<{ message: string | string[] }>;
    const message = axiosErr.response?.data?.message;
    errorMessage.value = Array.isArray(message)
      ? message.join(', ')
      : message ?? 'Registration failed. Please try again.';
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <div class="page-container">
    <div class="card">
      <h1 class="text-center">MaroMench</h1>
      <p class="text-muted text-center">Create your account</p>

      <form class="stack" @submit.prevent="handleSubmit">
        <div class="form-group">
          <label for="displayName">Display name</label>
          <input
            id="displayName"
            v-model="displayName"
            type="text"
            required
            minlength="2"
            maxlength="64"
            placeholder="Your name"
          />
        </div>

        <div class="form-group">
          <label for="phoneNumber">Phone number</label>
          <input
            id="phoneNumber"
            v-model="phoneNumber"
            type="tel"
            required
            placeholder="+15551234567"
          />
        </div>

        <div class="form-group">
          <label for="email">Email</label>
          <input
            id="email"
            v-model="email"
            type="email"
            required
            placeholder="you@example.com"
          />
        </div>

        <div class="form-group">
          <label for="password">Password</label>
          <input
            id="password"
            v-model="password"
            type="password"
            required
            minlength="8"
            placeholder="At least 8 characters"
          />
        </div>

        <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>

        <button type="submit" class="btn btn-primary" :disabled="isSubmitting">
          {{ isSubmitting ? 'Creating account…' : 'Create account' }}
        </button>
      </form>

      <p class="text-center text-muted" style="margin-top: 1.5rem">
        Already have an account?
        <router-link :to="{ name: 'login' }">Log in</router-link>
      </p>
    </div>
  </div>
</template>
