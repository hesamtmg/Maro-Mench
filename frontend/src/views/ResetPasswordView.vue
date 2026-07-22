<script setup lang="ts">
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth.store';
import type { AxiosError } from 'axios';

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

const token = ref((route.query.token as string) || '');
const newPassword = ref('');
const isSubmitting = ref(false);
const errorMessage = ref('');
const successMessage = ref('');

async function handleSubmit() {
  errorMessage.value = '';
  isSubmitting.value = true;
  try {
    const response = await authStore.resetPassword(
      token.value,
      newPassword.value,
    );
    successMessage.value = response.message;
    setTimeout(() => {
      void router.push({ name: 'login' });
    }, 1500);
  } catch (err) {
    const axiosErr = err as AxiosError<{ message: string }>;
    errorMessage.value =
      axiosErr.response?.data?.message ??
      'This reset link is invalid or has expired.';
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <div class="page-container">
    <div class="card">
      <h1 class="text-center">Set a new password</h1>

      <form class="stack" @submit.prevent="handleSubmit">
        <div class="form-group">
          <label for="token">Reset token</label>
          <input
            id="token"
            v-model="token"
            type="text"
            required
            placeholder="Paste the token from your email"
          />
        </div>

        <div class="form-group">
          <label for="newPassword">New password</label>
          <input
            id="newPassword"
            v-model="newPassword"
            type="password"
            required
            minlength="8"
            placeholder="At least 8 characters"
          />
        </div>

        <p v-if="errorMessage" class="error-text">{{ errorMessage }}</p>
        <p v-if="successMessage" class="text-muted">{{ successMessage }}</p>

        <button type="submit" class="btn btn-primary" :disabled="isSubmitting">
          {{ isSubmitting ? 'Saving…' : 'Save new password' }}
        </button>
      </form>
    </div>
  </div>
</template>
