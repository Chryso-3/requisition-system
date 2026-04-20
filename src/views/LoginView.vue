<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useSystemStore } from '@/stores/system'

const router = useRouter()
const authStore = useAuthStore()
const systemStore = useSystemStore()

const email = ref('')
const password = ref('')
const showPassword = ref(false)
const loading = ref(false)
const error = ref(null)
const showErrorModal = ref(false)

function closeErrorModal() {
  showErrorModal.value = false
  error.value = null
}

async function onSubmit() {
  error.value = null
  loading.value = true
  try {
    await authStore.signIn(email.value, password.value)
    router.replace('/')
  } catch (e) {
    // Map Firebase error codes to friendly messages
    if (
      e.code === 'auth/invalid-credential' ||
      e.code === 'auth/user-not-found' ||
      e.code === 'auth/wrong-password'
    ) {
      error.value = 'Incorrect email or password.'
    } else if (e.code === 'auth/too-many-requests') {
      error.value = 'Too many failed attempts. Please try again later.'
    } else {
      error.value = e.message || 'An error occurred during sign in.'
    }
    showErrorModal.value = true
  } finally {
    loading.value = false
  }
}

async function onGoogleSignIn() {
  error.value = null
  loading.value = true
  try {
    await authStore.signInWithGoogle()
    router.replace('/')
  } catch (e) {
    error.value = e.message || 'Google sign-in failed.'
    showErrorModal.value = true
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="auth-page">
    <!-- Left Panel - Branding -->
    <div class="auth-brand">
      <div class="brand-content">
        <div class="brand-logo">
          <!-- Replace with actual logo -->
          <img class="brand-logo-img" src="@/assets/logos.png" alt="Leyeco III logo" />
        </div>
        <h1>Leyeco III</h1>
        <p class="brand-subtitle">Electric Cooperative Inc.</p>
        <div class="brand-divider"></div>
        <h2>Requisition System</h2>
        <p class="brand-description">
          Streamline your requisition process with our digital management system. Submit, track, and
          approve requests efficiently.
        </p>
        <div class="brand-features">
          <div class="feature">
            <span class="feature-icon">📋</span>
            <span>Easy Requisition Submission</span>
          </div>
          <div class="feature">
            <span class="feature-icon">✅</span>
            <span>Multi-level Approval Workflow</span>
          </div>
          <div class="feature">
            <span class="feature-icon">📊</span>
            <span>Real-time Status Tracking</span>
          </div>
        </div>
      </div>
      <div class="brand-footer">
        <p>&copy; {{ new Date().getFullYear() }} Leyte III Electric Cooperative Inc. | In partnership with Eastern Visayas State University-Tanauan Campus | Designed &amp; Developed by: Alberto R.Tingzon Jr.</p>
      </div>
    </div>

    <!-- Right Panel - Form -->
    <div class="auth-form-container">
      <div class="auth-form-wrapper">
        <div class="form-header">
          <h3>Welcome Back</h3>
          <p>Sign in to your account to continue</p>
        </div>

        <form @submit.prevent="onSubmit" class="auth-form">
          <div class="form-group">
            <label for="email">Email Address</label>
            <div class="input-wrapper">
              <span class="input-icon">📧</span>
              <input
                id="email"
                v-model="email"
                type="email"
                placeholder="Enter your email"
                required
                autocomplete="email"
              />
            </div>
          </div>

          <div class="form-group">
            <label for="password">Password</label>
            <div class="input-wrapper input-wrapper-password">
              <span class="input-icon">🔒</span>
              <input
                id="password"
                v-model="password"
                :type="showPassword ? 'text' : 'password'"
                placeholder="Enter your password"
                required
                autocomplete="current-password"
              />
              <button
                type="button"
                class="btn-toggle-password"
                :aria-label="showPassword ? 'Hide password' : 'Show password'"
                @click="showPassword = !showPassword"
              >
                <!-- Closed eye when password hidden; open eye when password visible -->
                <svg
                  v-if="!showPassword"
                  class="icon-eye"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path
                    d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"
                  />
                  <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
                <svg
                  v-else
                  class="icon-eye"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              </button>
            </div>
          </div>

          <button type="submit" class="btn-submit" :disabled="loading">
            <span v-if="loading" class="spinner"></span>
            {{ loading ? 'Signing in...' : 'Sign In' }}
          </button>

          <template v-if="systemStore.config.googleSignInEnabled">
            <div class="form-divider">
              <span>or continue with</span>
            </div>

            <button type="button" class="btn-google" @click="onGoogleSignIn" :disabled="loading">
              <svg class="google-icon" viewBox="0 0 24 24">
                <path
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                  fill="#4285F4"
                />
                <path
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                  fill="#34A853"
                />
                <path
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
                  fill="#FBBC05"
                />
                <path
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                  fill="#EA4335"
                />
              </svg>
              Google
            </button>
          </template>
        </form>

        <div v-if="systemStore.config.registrationEnabled" class="form-footer">
          <p>Don't have an account?</p>
          <router-link to="/register" class="link-register">Create Account</router-link>
        </div>
      </div>
    </div>

    <!-- Error Modal -->
    <Transition name="modal-fade">
      <div v-if="showErrorModal" class="modal-overlay">
        <div class="modal-backdrop" @click="closeErrorModal"></div>
        <div class="modal-card" role="dialog" aria-modal="true">
          <div class="modal-header">
            <div class="modal-icon-wrapper">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="modal-icon"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="12" y1="8" x2="12" y2="12"></line>
                <line x1="12" y1="16" x2="12.01" y2="16"></line>
              </svg>
            </div>
            <h3 class="modal-title">Sign In Failed</h3>
          </div>
          <div class="modal-body">
            <p class="modal-message">{{ error }}</p>
          </div>
          <div class="modal-footer">
            <button class="btn-modal-close" @click="closeErrorModal">OK</button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.auth-page {
  min-height: 100vh;
  display: flex;
}

/* Left Panel - Branding */
.auth-brand {
  flex: 1;
  background: #1e293b;
  color: #f8fafc;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 3rem;
  position: relative;
  overflow: hidden;
}

.auth-brand::before {
  content: '';
  position: absolute;
  top: -50%;
  right: -50%;
  width: 100%;
  height: 100%;
  background: radial-gradient(circle, rgba(14, 165, 233, 0.08) 0%, transparent 70%);
  pointer-events: none;
}

.brand-content {
  position: relative;
  z-index: 1;
}

.brand-logo {
  width: 80px;
  height: 80px;
  background: rgba(255, 255, 255, 0.12);
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 1.5rem;
}

.logo-icon {
  font-size: 2.5rem;
}

.brand-logo-img {
  width: 56px;
  height: 56px;
  object-fit: contain;
  display: block;
  filter: drop-shadow(0 8px 18px rgba(0, 0, 0, 0.18));
}

.auth-brand h1 {
  margin: 0;
  font-size: 2rem;
  font-weight: 700;
}

.brand-subtitle {
  margin: 0.25rem 0 0;
  font-size: 1rem;
  font-weight: 600;
  opacity: 1;
}

.brand-divider {
  width: 60px;
  height: 4px;
  background: #0ea5e9;
  border-radius: 2px;
  margin: 2rem 0;
}

.auth-brand h2 {
  margin: 0 0 1rem;
  font-size: 1.5rem;
  font-weight: 600;
}

.brand-description {
  margin: 0 0 2rem;
  font-size: 0.95rem;
  line-height: 1.6;
  opacity: 0.85;
  max-width: 400px;
}

.brand-features {
  display: flex;
  flex-direction: column;
  gap: 1rem;
}

.feature {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.9rem;
}

.feature-icon {
  font-size: 1.25rem;
}

.brand-footer {
  position: relative;
  z-index: 1;
}

.brand-footer p {
  margin: 0;
  font-size: 0.8rem;
  opacity: 0.6;
}

/* Right Panel - Form */
.auth-form-container {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  background: #f1f5f9;
}

.auth-form-wrapper {
  width: 100%;
  max-width: 420px;
}

.form-header {
  margin-bottom: 2rem;
  text-align: center;
}

.form-header h3 {
  margin: 0 0 0.5rem;
  font-size: 1.75rem;
  color: #1e293b;
  font-weight: 700;
}

.form-header p {
  margin: 0;
  color: #64748b;
  font-size: 0.95rem;
}

.auth-form {
  background: white;
  padding: 2rem;
  border-radius: 16px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08);
}

.error-alert {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: #fef2f2;
  color: #dc2626;
  padding: 0.875rem 1rem;
  border-radius: 10px;
  margin-bottom: 1.5rem;
  font-size: 0.875rem;
  border: 1px solid #fecaca;
}

.error-icon {
  font-size: 1rem;
}

.form-group {
  margin-bottom: 1.25rem;
}

.form-group label {
  display: block;
  font-weight: 600;
  margin-bottom: 0.5rem;
  font-size: 0.875rem;
  color: #374151;
}

.input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
}

.input-icon {
  position: absolute;
  left: 1rem;
  font-size: 1rem;
  z-index: 1;
}

.input-wrapper input {
  width: 100%;
  padding: 0.875rem 1rem 0.875rem 3rem;
  border: 2px solid #e5e7eb;
  border-radius: 10px;
  font-size: 0.95rem;
  transition: all 0.2s;
  background: #f8fafc;
}

.input-wrapper-password {
  position: relative;
}

.input-wrapper-password input {
  padding-right: 3rem;
}

.btn-toggle-password {
  position: absolute;
  right: 0.75rem;
  top: 50%;
  transform: translateY(-50%);
  width: 2rem;
  height: 2rem;
  padding: 0;
  border: none;
  background: none;
  color: #64748b;
  cursor: pointer;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition:
    color 0.2s,
    background 0.2s;
}

.btn-toggle-password:hover {
  color: #0ea5e9;
  background: rgba(14, 165, 233, 0.08);
}

.icon-eye {
  width: 1.25rem;
  height: 1.25rem;
}

.input-wrapper input:focus {
  outline: none;
  border-color: #0ea5e9;
  background: white;
  box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.1);
}

.input-wrapper input::placeholder {
  color: #9ca3af;
}

.btn-submit {
  width: 100%;
  padding: 0.875rem;
  background: #0ea5e9;
  color: #fff;
  border: none;
  border-radius: 10px;
  font-size: 1rem;
  font-weight: 600;
  cursor: pointer;
  margin-top: 0.5rem;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  transition:
    background 0.15s,
    box-shadow 0.15s;
  box-shadow: 0 2px 8px rgba(14, 165, 233, 0.25);
}

.btn-submit:hover:not(:disabled) {
  background: #0284c7;
  box-shadow: 0 4px 12px rgba(14, 165, 233, 0.3);
}

.btn-submit:disabled {
  opacity: 0.7;
  cursor: not-allowed;
  transform: none;
}

.spinner {
  width: 18px;
  height: 18px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.form-divider {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin: 1.5rem 0;
  color: #94a3b8;
  font-size: 0.8rem;
}

.form-divider::before,
.form-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: #e2e8f0;
}

.btn-google {
  width: 100%;
  padding: 0.75rem;
  background: white;
  color: #1e293b;
  border: 2px solid #e2e8f0;
  border-radius: 10px;
  font-size: 0.95rem;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  transition: all 0.2s;
}

.btn-google:hover:not(:disabled) {
  background: #f8fafc;
  border-color: #cbd5e1;
}

.google-icon {
  width: 20px;
  height: 20px;
}

.form-footer {
  margin-top: 2rem;
  text-align: center;
}

.form-footer p {
  margin: 0 0 0.5rem;
  color: #64748b;
  font-size: 0.875rem;
}

.link-register {
  color: #0ea5e9;
  text-decoration: none;
  font-weight: 600;
  font-size: 0.95rem;
  transition: color 0.2s;
}

.link-register:hover {
  color: #0284c7;
  text-decoration: underline;
}

/* Responsive */
@media (max-width: 900px) {
  .auth-page {
    flex-direction: column;
  }

  .auth-brand {
    padding: 2rem;
    min-height: auto;
  }

  .brand-features {
    display: none;
  }

  .auth-form-container {
    padding: 2rem 1rem;
  }
}

/* Error Modal Styles */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 999;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}

.modal-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(15, 23, 42, 0.6);
  backdrop-filter: blur(4px);
}

.modal-card {
  position: relative;
  background: white;
  width: 100%;
  max-width: 400px;
  border-radius: 16px;
  box-shadow:
    0 20px 25px -5px rgba(0, 0, 0, 0.1),
    0 10px 10px -5px rgba(0, 0, 0, 0.04);
  overflow: hidden;
  transform: translateZ(0);
}

.modal-header {
  background: #fef2f2;
  padding: 1.5rem 1.5rem 0.5rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.modal-icon-wrapper {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: #fee2e2;
  color: #ef4444;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 1rem;
}

.modal-icon {
  width: 24px;
  height: 24px;
}

.modal-title {
  font-size: 1.125rem;
  font-weight: 600;
  color: #991b1b;
  margin: 0;
}

.modal-body {
  padding: 1rem 1.75rem 1.5rem;
  text-align: center;
}

.modal-message {
  font-size: 0.95rem;
  color: #4b5563;
  line-height: 1.5;
  margin: 0;
}

.modal-footer {
  padding: 0 1.5rem 1.5rem;
}

.btn-modal-close {
  width: 100%;
  padding: 0.75rem;
  background: #ef4444;
  color: white;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  font-size: 0.95rem;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-modal-close:hover {
  background: #dc2626;
}

/* Modal Transition */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.2s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.modal-fade-enter-active .modal-card {
  transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.modal-fade-leave-active .modal-card {
  transition: transform 0.2s ease-in;
}

.modal-fade-enter-from .modal-card {
  transform: scale(0.95) translateY(10px);
}
.modal-fade-leave-to .modal-card {
  transform: scale(0.95) translateY(10px);
}
</style>
