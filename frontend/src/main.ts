import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import router from './router';
import { useAuthStore } from './stores/auth.store';
import './style.css';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);

// Restore session from localStorage before mounting, so the router guard
// sees the correct auth state on first navigation.
const authStore = useAuthStore();
authStore.initializeFromStorage();

app.mount('#app');
