<script setup>
import { ref, onErrorCaptured } from 'vue'

const error = ref(null)

onErrorCaptured((err) => {
  error.value = err
  console.error('[Global Error Boundary]:', err)
  return false // Prevent error from propagating further
})

function handleReload() {
  window.location.href = '/'
}
</script>

<template>
  <div v-if="error" class="error-boundary-overlay">
    <div class="error-card glass-card">
      <div class="error-icon">⚠️</div>
      <h1 class="error-title">System Interruption</h1>
      <p class="error-message">
        The application encountered an unexpected state. Our security protocols have paused the
        current session to prevent data inconsistency.
      </p>
      <div class="error-actions">
        <button @click="handleReload" class="btn-reload">Refresh System</button>
      </div>
      <details class="error-details">
        <summary>Technical Details</summary>
        <pre>{{ error.message || error }}</pre>
      </details>
    </div>
  </div>
  <router-view v-else />
</template>

<style>
* {
  box-sizing: border-box;
}
body {
  margin: 0;
  font-family:
    'Segoe UI',
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    'Helvetica Neue',
    sans-serif;
  font-size: 15px;
  line-height: 1.5;
  color: #0f172a;
  background: #f1f5f9;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}
#app {
  min-height: 100vh;
}

/* ERROR BOUNDARY STYLES */
.error-boundary-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f1f5f9;
  z-index: 9999;
  padding: 2rem;
}

.error-card {
  max-width: 480px;
  width: 100%;
  background: white;
  padding: 3rem;
  border-radius: 24px;
  text-align: center;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
  border: 1px solid #e2e8f0;
}

.error-icon {
  font-size: 3rem;
  margin-bottom: 1.5rem;
}

.error-title {
  font-size: 1.75rem;
  font-weight: 800;
  color: #0f172a;
  margin: 0 0 1rem;
  letter-spacing: -0.02em;
}

.error-message {
  color: #64748b;
  line-height: 1.6;
  margin-bottom: 2rem;
}

.btn-reload {
  background: #0f172a;
  color: white;
  border: none;
  padding: 0.75rem 2rem;
  border-radius: 12px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-reload:hover {
  background: #1e293b;
  transform: translateY(-2px);
}

.error-details {
  margin-top: 3rem;
  text-align: left;
}

.error-details summary {
  font-size: 0.75rem;
  color: #94a3b8;
  cursor: pointer;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.error-details pre {
  margin-top: 1rem;
  padding: 1rem;
  background: #f8fafc;
  border-radius: 8px;
  font-size: 0.75rem;
  color: #ef4444;
  overflow-x: auto;
  border: 1px solid #fee2e2;
}
</style>
