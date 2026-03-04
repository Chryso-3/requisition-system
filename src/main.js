import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'

// Global error handler for dynamic import failures
window.addEventListener('error', (event) => {
  if (
    event.message &&
    (event.message.includes('Failed to fetch dynamically imported module') ||
      event.message.includes('Importing a module script failed'))
  ) {
    event.preventDefault()
    // Avoid infinite reload loop if the file is permanently missing
    if (!window.location.search.includes('reload=true')) {
      window.location.href =
        window.location.href + (window.location.search ? '&' : '?') + 'reload=true'
    }
  }
})

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
