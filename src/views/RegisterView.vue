<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { USER_ROLES, USER_ROLE_LABELS } from '@/firebase/collections'
import { getSystemConfig } from '@/services/adminService'

const router = useRouter()
const authStore = useAuthStore()

const fullName = ref('')
const email = ref('')
const password = ref('')
const confirmPassword = ref('')
const showPassword = ref(false)
const showConfirmPassword = ref(false)
const selectedRole = ref(USER_ROLES.REQUESTER)
const loading = ref(false)
const error = ref(null)
const registrationClosed = ref(false)

// Lock down roles: Only Requestor can be self-registered
const roleOptions = [{ value: USER_ROLES.REQUESTER, label: USER_ROLE_LABELS[USER_ROLES.REQUESTER] }]

const passwordsMatch = computed(() => password.value === confirmPassword.value)
const canSubmit = computed(
  () =>
    !registrationClosed.value &&
    fullName.value.trim() &&
    email.value &&
    password.value.length >= 6 &&
    passwordsMatch.value &&
    selectedRole.value,
)

onMounted(async () => {
  try {
    const config = await getSystemConfig()
    if (config && config.registrationEnabled === false) {
      registrationClosed.value = true
      error.value = 'Public registration is currently closed by the administrator.'
    }
  } catch (err) {
    console.error('Error checking registration status:', err)
  }
})

async function onSubmit() {
  if (registrationClosed.value) return
  error.value = null
  if (!canSubmit.value) return
  loading.value = true
  try {
    await authStore.signUp(email.value, password.value, fullName.value.trim(), selectedRole.value)
    router.replace('/')
  } catch (e) {
    if (e.code === 'auth/email-already-in-use') {
      error.value = 'This email is already registered. Try signing in instead.'
    } else if (e.code === 'auth/weak-password') {
      error.value = 'Password should be at least 6 characters.'
    } else {
      error.value = e.message || 'Registration failed. Please try again.'
    }
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
          <img class="brand-logo-img" src="@/assets/logos.png" alt="Leyeco III logo" />
        </div>
        <h1>Leyeco III</h1>
        <p class="brand-subtitle">Electric Cooperative Inc.</p>
        <div class="brand-divider"></div>
        <h2>Requisition System</h2>
        <p class="brand-description">
          Join our digital requisition platform. Create your account to submit, track, and manage
          requisition requests seamlessly.
        </p>
        <div class="brand-roles">
          <h4>Available Roles</h4>
          <div class="role-list">
            <div class="role-item">
              <span class="role-badge requester">Requestor</span>
              <span>Submit requisitions</span>
            </div>
            <div class="role-item">
              <span class="role-badge approver">Approvers</span>
              <span>Review & approve requests</span>
            </div>
          </div>
        </div>
      </div>
      <div class="brand-footer">
        <p>&copy; {{ new Date().getFullYear() }} Leyte III Electric Cooperative Inc. | In partnership with Eastern Visayas State University-Tanauan Campus | Designed &amp; Developed by Alberto Tingzon</p>
      </div>
    </div>

    <!-- Right Panel - Form -->
    <div class="auth-form-container">
      <div class="auth-form-wrapper">
        <div class="form-header">
          <h3>Create Account</h3>
          <p>Register to access the requisition system</p>
        </div>

        <form @submit.prevent="onSubmit" class="auth-form">
          <div v-if="error" class="error-alert">
            <span class="error-icon">⚠️</span>
            {{ error }}
          </div>

          <div class="form-group">
            <label for="role">Account Type</label>
            <div class="select-wrapper">
              <span class="input-icon">👤</span>
              <select id="role" v-model="selectedRole" required>
                <option value="" disabled>Select your role</option>
                <option v-for="role in roleOptions" :key="role.value" :value="role.value">
                  {{ role.label }}
                </option>
              </select>
              <span class="select-arrow">▼</span>
            </div>
          </div>

          <div class="form-group">
            <label for="fullName">Full Name</label>
            <div class="input-wrapper">
              <span class="input-icon">📝</span>
              <input
                id="fullName"
                v-model="fullName"
                type="text"
                placeholder="Enter your full name"
                required
                autocomplete="name"
              />
            </div>
          </div>

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

          <div class="form-row">
            <div class="form-group">
              <label for="password">Password</label>
              <div class="input-wrapper input-wrapper-password">
                <span class="input-icon">🔒</span>
                <input
                  id="password"
                  v-model="password"
                  :type="showPassword ? 'text' : 'password'"
                  placeholder="Min. 6 characters"
                  required
                  minlength="6"
                  autocomplete="new-password"
                />
                <button
                  type="button"
                  class="btn-toggle-password"
                  :aria-label="showPassword ? 'Hide password' : 'Show password'"
                  @click.prevent="showPassword = !showPassword"
                >
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

            <div class="form-group">
              <label for="confirmPassword">Confirm Password</label>
              <div
                class="input-wrapper input-wrapper-password"
                :class="{ 'has-error': confirmPassword && !passwordsMatch }"
              >
                <span class="input-icon">🔒</span>
                <input
                  id="confirmPassword"
                  v-model="confirmPassword"
                  :type="showConfirmPassword ? 'text' : 'password'"
                  placeholder="Repeat password"
                  required
                  autocomplete="new-password"
                />
                <button
                  type="button"
                  class="btn-toggle-password"
                  :aria-label="showConfirmPassword ? 'Hide password' : 'Show password'"
                  @click.prevent="showConfirmPassword = !showConfirmPassword"
                >
                  <svg
                    v-if="!showConfirmPassword"
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
              <span v-if="confirmPassword && !passwordsMatch" class="field-error">
                Passwords do not match
              </span>
            </div>
          </div>

          <button type="submit" class="btn-submit" :disabled="loading || !canSubmit">
            <span v-if="loading" class="spinner"></span>
            {{ loading ? 'Creating Account...' : 'Create Account' }}
          </button>
        </form>

        <div class="form-footer">
          <p>Already have an account?</p>
          <router-link to="/login" class="link-login">Sign In</router-link>
        </div>
      </div>
    </div>
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
  border-radius: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 1.5rem;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.12);
  border: 1px solid rgba(255, 255, 255, 0.18);
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

.brand-roles h4 {
  margin: 0 0 1rem;
  font-size: 0.9rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  opacity: 0.7;
}

.role-list {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.role-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.9rem;
}

.role-badge {
  padding: 0.25rem 0.625rem;
  border-radius: 20px;
  font-size: 0.75rem;
  font-weight: 600;
}
.role-badge.requester {
  background: #16a34a;
}
.role-badge.approver {
  background: #2563eb;
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
  background: #f8fafc;
  overflow-y: auto;
}

.auth-form-wrapper {
  width: 100%;
  max-width: 480px;
}

.form-header {
  margin-bottom: 1.5rem;
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

.form-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1rem;
}

.form-group label {
  display: block;
  font-weight: 600;
  margin-bottom: 0.5rem;
  font-size: 0.875rem;
  color: #374151;
}

.input-wrapper,
.select-wrapper {
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

.input-wrapper input,
.select-wrapper select {
  width: 100%;
  padding: 0.875rem 1rem 0.875rem 3rem;
  border: 2px solid #e5e7eb;
  border-radius: 10px;
  font-size: 0.95rem;
  transition: all 0.2s;
  background: #f8fafc;
}

.select-wrapper select {
  padding-right: 2.5rem;
  appearance: none;
  cursor: pointer;
}

.select-arrow {
  position: absolute;
  right: 1rem;
  font-size: 0.625rem;
  color: #64748b;
  pointer-events: none;
}

.input-wrapper input:focus,
.select-wrapper select:focus {
  outline: none;
  border-color: #2563eb;
  background: white;
  box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.1);
}

.input-wrapper.has-error input {
  border-color: #dc2626;
}

.input-wrapper-password {
  position: relative;
}

.input-wrapper-password input {
  padding-right: 3rem;
}

.btn-toggle-password {
  position: absolute;
  right: 0.5rem;
  top: 50%;
  transform: translateY(-50%);
  width: 2.25rem;
  height: 2.25rem;
  padding: 0;
  border: none;
  background: none;
  color: #64748b;
  cursor: pointer;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
  transition:
    color 0.2s,
    background 0.2s;
}

.btn-toggle-password:hover {
  color: #2563eb;
  background: rgba(37, 99, 235, 0.08);
}

.icon-eye {
  width: 1.25rem;
  height: 1.25rem;
  pointer-events: none;
}

.input-wrapper input::placeholder {
  color: #9ca3af;
}

.field-error {
  display: block;
  font-size: 0.75rem;
  color: #dc2626;
  margin-top: 0.375rem;
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
  transform: none;
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

.form-footer {
  margin-top: 2rem;
  text-align: center;
}

.form-footer p {
  margin: 0 0 0.5rem;
  color: #64748b;
  font-size: 0.875rem;
}

.link-login {
  color: #2563eb;
  text-decoration: none;
  font-weight: 600;
  font-size: 0.95rem;
  transition: color 0.2s;
}

.link-login:hover {
  color: #1d4ed8;
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

  .brand-roles {
    display: none;
  }

  .auth-form-container {
    padding: 2rem 1rem;
  }

  .form-row {
    grid-template-columns: 1fr;
  }
}
</style>
