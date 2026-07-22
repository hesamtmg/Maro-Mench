<script setup lang="ts">
import { ref } from 'vue';
import { useAuthStore } from '../stores/auth.store';

const authStore = useAuthStore();

const email = ref('');
const isSubmitting = ref(false);
const message = ref('');

async function handleSubmit() {
  isSubmitting.value = true;
  try {
    const response = await authStore.forgotPassword(email.value);
    message.value = response.message;
  } catch {
    // Backend always returns a generic success message regardless of
    // whether the email exists, so a network/server error is the only
    // real failure case here.
    message.value = 'Something went wrong. Please try again.';
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <div class="page-container">
    <div class="card">
      <h1 class="text-center">Reset your password</h1>
      <p class="text-muted text-center">
        We'll email you a link to reset your password.
      </p>

      <form class="stack" @submit.prevent="handleSubmit">
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

        <p v-if="message" class="text-muted">{{ message }}</p>

        <button type="submit" class="btn btn-primary" :disabled="isSubmitting">
          {{ isSubmitting ? 'Sending…' : 'Send reset link' }}
        </button>
      </form>

      <p class="text-center" style="margin-top: 1.5rem">
        <router-link :to="{ name: 'login' }">Back to login</router-link>
      </p>
    </div>
  </div>
</template>
