<script setup>
import { ref, computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import { USER_ROLE_LABELS, USER_ROLES } from '@/firebase/collections'
import { auth } from '@/firebase'
import { EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth'

const authStore = useAuthStore()

const displayNameEdit = ref('')
const saving = ref(false)
const saveMessage = ref(null)
const sigUploading = ref(false)
const sigMessage = ref(null)
const sigInput = ref(null)

const currentPassword = ref('')
const newPassword = ref('')
const confirmPassword = ref('')
const showCurrentPassword = ref(false)
const showNewPassword = ref(false)
const showConfirmPassword = ref(false)
const passwordChanging = ref(false)
const passwordMessage = ref(null)

const profile = computed(() => authStore.userProfile)
const email = computed(() => authStore.user?.email ?? '—')
const roleLabel = computed(() => USER_ROLE_LABELS[authStore.role] ?? authStore.role)
const isPurchaser = computed(() => authStore.role === USER_ROLES.PURCHASER)
/** E-signature: base64 stored in Firestore (no Storage required) */
const signatureData = computed(() => profile.value?.signatureData ?? null)
const memberSince = computed(() => {
  const t = profile.value?.createdAt
  if (!t) return '—'
  const d = typeof t === 'string' ? new Date(t) : (t?.toDate?.() ?? new Date(t))
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
})

function initFromProfile() {
  displayNameEdit.value = authStore.displayName || ''
}
initFromProfile()

async function saveProfile() {
  const name = (displayNameEdit.value || '').trim()
  if (!name) {
    saveMessage.value = 'Name is required.'
    return
  }
  saving.value = true
  saveMessage.value = null
  try {
    await authStore.updateUserProfile({ displayName: name })
    saveMessage.value = 'Profile saved.'
  } catch (e) {
    saveMessage.value = e?.message || 'Failed to save profile.'
  } finally {
    saving.value = false
  }
}

function avatarInitial() {
  const name = authStore.displayName || authStore.user?.email || 'U'
  return (name.charAt(0) || 'U').toUpperCase()
}

function triggerSigInput() {
  sigInput.value?.click()
}

const MAX_SIGNATURE_BYTES = 150 * 1024 // 150KB – stored as base64 in Firestore

function onSigFileChange(ev) {
  const file = ev.target?.files?.[0]
  ev.target.value = ''
  if (!authStore.user) {
    sigMessage.value = 'You must be signed in to upload a signature.'
    return
  }
  if (!file || !file.type.startsWith('image/')) {
    sigMessage.value = 'Please choose an image file (e.g. PNG, JPG).'
    return
  }
  if (file.size > MAX_SIGNATURE_BYTES) {
    sigMessage.value = `Image too large. Use a file under ${MAX_SIGNATURE_BYTES / 1024} KB (e.g. crop or compress).`
    return
  }
  sigUploading.value = true
  sigMessage.value = null
  const reader = new FileReader()
  reader.onload = async () => {
    try {
      const dataUrl = reader.result
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
        sigMessage.value = 'Invalid image.'
        return
      }
      await authStore.updateUserProfile({ signatureData: dataUrl })
      sigMessage.value = 'E-signature updated.'
    } catch (e) {
      const msg = e?.message || e?.code || String(e)
      sigMessage.value =
        msg.includes('permission') || msg.includes('Permission')
          ? 'Permission denied. Try signing out and back in, then upload again.'
          : `Failed to save signature: ${msg}`
    } finally {
      sigUploading.value = false
    }
  }
  reader.onerror = () => {
    sigMessage.value = 'Failed to read image.'
    sigUploading.value = false
  }
  reader.readAsDataURL(file)
}

async function changePassword() {
  passwordMessage.value = null
  const cur = (currentPassword.value || '').trim()
  const newP = (newPassword.value || '').trim()
  const conf = (confirmPassword.value || '').trim()

  if (!cur) {
    passwordMessage.value = 'Enter your current password.'
    return
  }
  if (!newP) {
    passwordMessage.value = 'Enter a new password.'
    return
  }
  if (newP.length < 6) {
    passwordMessage.value = 'New password must be at least 6 characters.'
    return
  }
  if (newP !== conf) {
    passwordMessage.value = 'New password and confirmation do not match.'
    return
  }

  passwordChanging.value = true
  try {
    const user = auth.currentUser
    if (!user?.email) {
      passwordMessage.value = 'Cannot change password: no email on account.'
      return
    }
    const credential = EmailAuthProvider.credential(user.email, cur)
    await reauthenticateWithCredential(user, credential)
    await updatePassword(user, newP)
    currentPassword.value = ''
    newPassword.value = ''
    confirmPassword.value = ''
    passwordMessage.value = 'Password updated successfully.'
  } catch (e) {
    if (e?.code === 'auth/wrong-password' || e?.code === 'auth/invalid-credential') {
      passwordMessage.value = 'Current password is incorrect.'
    } else if (e?.code === 'auth/weak-password') {
      passwordMessage.value = 'New password should be at least 6 characters.'
    } else {
      passwordMessage.value = e?.message || 'Failed to update password.'
    }
  } finally {
    passwordChanging.value = false
  }
}
</script>

<template>
  <div class="profile-view">
    <div class="profile-scroll">
      <!-- Elegant header with mesh gradient -->
      <header class="profile-header">
        <div class="header-mesh"></div>
        <div class="header-glow"></div>
        <div class="header-content">
          <div class="header-text">
            <h1 class="profile-title">Account Settings</h1>
            <p class="profile-desc">
              Manage your profile, security preferences, and digital signature
            </p>
          </div>
        </div>
      </header>

      <div class="profile-container">
        <div class="profile-grid">
          <!-- Personal Information Card -->
          <section class="card card-animate">
            <div class="card-glow card-glow-blue"></div>
            <div class="card-header">
              <div class="card-icon-wrapper">
                <div class="card-icon card-icon-primary">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                </div>
              </div>
              <div class="card-header-text">
                <h2 class="card-title">Personal Information</h2>
                <p class="card-subtitle">Update your account details</p>
              </div>
            </div>
            <div class="card-body">
              <div class="form-group">
                <label class="form-label">Display Name</label>
                <div class="input-wrapper">
                  <input
                    v-model="displayNameEdit"
                    type="text"
                    class="form-input"
                    placeholder="Enter your full name"
                  />
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">Email Address</label>
                <div class="input-wrapper">
                  <input
                    :value="email"
                    type="email"
                    class="form-input form-input-readonly"
                    disabled
                  />
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">Account Role</label>
                <div class="role-badge-wrapper">
                  <span class="role-badge">
                    <span class="role-badge-dot"></span>
                    {{ roleLabel }}
                  </span>
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">Member Since</label>
                <div class="form-input form-input-readonly form-input-static">
                  {{ memberSince }}
                </div>
              </div>
              <div
                v-if="saveMessage"
                class="message-alert"
                :class="saveMessage === 'Profile saved.' ? 'message-success' : 'message-error'"
              >
                <div class="message-icon">
                  <svg
                    v-if="saveMessage === 'Profile saved.'"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <svg
                    v-else
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <span>{{ saveMessage }}</span>
              </div>
              <button type="button" class="btn btn-primary" :disabled="saving" @click="saveProfile">
                <span v-if="saving" class="btn-loader"></span>
                <span v-else>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                    <polyline points="17 21 17 13 7 13 7 21" />
                    <polyline points="7 3 7 8 15 8" />
                  </svg>
                </span>
                <span>{{ saving ? 'Saving Changes...' : 'Save Changes' }}</span>
              </button>
            </div>
          </section>

          <!-- Security Settings Card -->
          <section class="card card-animate">
            <div class="card-glow card-glow-purple"></div>
            <div class="card-header">
              <div class="card-icon-wrapper">
                <div class="card-icon card-icon-security">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </div>
              </div>
              <div class="card-header-text">
                <h2 class="card-title">Security Settings</h2>
                <p class="card-subtitle">Update your password</p>
              </div>
            </div>
            <div class="card-body">
              <div class="form-group">
                <label class="form-label">Current Password</label>
                <div class="input-with-icon">
                  <input
                    v-model="currentPassword"
                    :type="showCurrentPassword ? 'text' : 'password'"
                    class="form-input"
                    placeholder="Enter current password"
                    autocomplete="current-password"
                  />
                  <button
                    type="button"
                    class="input-icon-btn"
                    :aria-label="showCurrentPassword ? 'Hide password' : 'Show password'"
                    @click="showCurrentPassword = !showCurrentPassword"
                  >
                    <svg
                      v-if="showCurrentPassword"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                    <svg
                      v-else
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path
                        d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"
                      />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  </button>
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">New Password</label>
                <div class="input-with-icon">
                  <input
                    v-model="newPassword"
                    :type="showNewPassword ? 'text' : 'password'"
                    class="form-input"
                    placeholder="Minimum 6 characters"
                    autocomplete="new-password"
                  />
                  <button
                    type="button"
                    class="input-icon-btn"
                    :aria-label="showNewPassword ? 'Hide password' : 'Show password'"
                    @click="showNewPassword = !showNewPassword"
                  >
                    <svg
                      v-if="showNewPassword"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                    <svg
                      v-else
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path
                        d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"
                      />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  </button>
                </div>
              </div>
              <div class="form-group">
                <label class="form-label">Confirm New Password</label>
                <div class="input-with-icon">
                  <input
                    v-model="confirmPassword"
                    :type="showConfirmPassword ? 'text' : 'password'"
                    class="form-input"
                    placeholder="Re-enter new password"
                    autocomplete="new-password"
                  />
                  <button
                    type="button"
                    class="input-icon-btn"
                    :aria-label="showConfirmPassword ? 'Hide password' : 'Show password'"
                    @click="showConfirmPassword = !showConfirmPassword"
                  >
                    <svg
                      v-if="showConfirmPassword"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                    <svg
                      v-else
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path
                        d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"
                      />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  </button>
                </div>
              </div>
              <div
                v-if="passwordMessage"
                class="message-alert"
                :class="
                  passwordMessage === 'Password updated successfully.'
                    ? 'message-success'
                    : 'message-error'
                "
              >
                <div class="message-icon">
                  <svg
                    v-if="passwordMessage === 'Password updated successfully.'"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  <svg
                    v-else
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                  >
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <span
                  :class="
                    passwordMessage === 'Password updated successfully.'
                      ? 'text-success'
                      : 'text-error'
                  "
                  >{{ passwordMessage }}</span
                >
              </div>
              <button
                type="button"
                class="btn btn-primary"
                :disabled="passwordChanging || !currentPassword || !newPassword || !confirmPassword"
                @click="changePassword"
              >
                <span v-if="passwordChanging" class="btn-loader"></span>
                <span v-else>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                </span>
                <span>{{ passwordChanging ? 'Updating Password...' : 'Update Password' }}</span>
              </button>
            </div>
          </section>

          <!-- E-Signature Card (Now available for all roles including Purchaser) -->
          <section class="card card-signature card-animate">
            <div class="card-glow card-glow-green"></div>
            <div class="card-header">
              <div class="card-icon-wrapper">
                <div class="card-icon card-icon-signature">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M20.24 12.24a6 6 0 0 0-8.49-8.49L5 10.5V19h8.5z" />
                    <line x1="16" y1="8" x2="2" y2="22" />
                    <line x1="17.5" y1="15" x2="9" y2="15" />
                  </svg>
                </div>
              </div>
              <div class="card-header-text">
                <h2 class="card-title">Digital Signature</h2>
                <p class="card-subtitle">For requisition forms and approvals</p>
              </div>
            </div>
            <div class="card-body card-body-sig">
              <input
                ref="sigInput"
                type="file"
                accept="image/png,image/jpeg,image/jpg,image/webp"
                class="sig-file-input"
                @change="onSigFileChange"
              />
              <div
                class="sig-zone"
                :class="{ 'sig-zone--filled': signatureData, 'sig-zone--uploading': sigUploading }"
                @click="!sigUploading && triggerSigInput()"
              >
                <template v-if="signatureData && !sigUploading">
                  <div class="sig-zone-preview">
                    <div class="sig-preview-wrapper">
                      <img :src="signatureData" alt="Your signature" />
                    </div>
                  </div>
                  <p class="sig-zone-change">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="17 8 12 3 7 8" />
                      <line x1="12" y1="3" x2="12" y2="15" />
                    </svg>
                    <span class="sig-zone-change-link">Upload different signature</span>
                  </p>
                </template>
                <template v-else>
                  <div class="sig-zone-empty">
                    <div class="sig-zone-icon">
                      <svg
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                    </div>
                    <p class="sig-zone-title">Upload Signature Image</p>
                    <p class="sig-zone-hint">
                      PNG or JPG format recommended. Requestors and approvers: this signature
                      appears on requisition forms. Purchasers/Canvassers: this signature will be
                      used for procurement records and canvas forms.
                    </p>
                    <span class="sig-zone-browse">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      Choose File
                    </span>
                  </div>
                </template>
                <div v-if="sigUploading" class="sig-zone-overlay">
                  <span class="sig-zone-spinner" aria-hidden="true" />
                  <span class="sig-zone-overlay-text">Uploading signature...</span>
                </div>
              </div>
              <p
                v-if="sigMessage"
                class="sig-feedback"
                :class="
                  sigMessage === 'E-signature updated.'
                    ? 'sig-feedback--success'
                    : 'sig-feedback--error'
                "
              >
                <svg
                  v-if="sigMessage === 'E-signature updated.'"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
                <span>{{ sigMessage }}</span>
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700;800&family=Manrope:wght@400;500;600;700;800&display=swap');

:root {
  --color-bg: #f8f9fb;
  --color-surface: #ffffff;
  --color-border: #e1e6ef;
  --color-border-hover: #cbd3e0;

  --color-text-primary: #0f172a;
  --color-text-secondary: #475569;
  --color-text-tertiary: #64748b;
  --color-text-muted: #94a3b8;

  --color-primary: #2563eb;
  --color-primary-hover: #1d4ed8;
  --color-primary-light: #dbeafe;
  --color-primary-dark: #1e40af;

  --color-security: #7c3aed;
  --color-security-light: #ede9fe;

  --color-signature: #059669;
  --color-signature-light: #d1fae5;

  --color-success: #10b981;
  --color-success-bg: #d1fae5;
  --color-success-border: #6ee7b7;

  --color-error: #ef4444;
  --color-error-bg: #fee2e2;
  --color-error-border: #fca5a5;

  --shadow-xs: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --shadow-sm: 0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px -1px rgba(0, 0, 0, 0.1);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -2px rgba(0, 0, 0, 0.1);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -4px rgba(0, 0, 0, 0.1);
  --shadow-xl: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);

  --radius-sm: 10px;
  --radius-md: 14px;
  --radius-lg: 18px;
  --radius-xl: 24px;
}

* {
  box-sizing: border-box;
}

.profile-view {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--color-bg);
  font-family:
    'Manrope',
    -apple-system,
    BlinkMacSystemFont,
    system-ui,
    sans-serif;
  color: var(--color-text-primary);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

.profile-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-overflow-scrolling: touch;
}

/* Enhanced Header with Mesh Gradient */
.profile-header {
  position: relative;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  overflow: hidden;
}

.header-mesh {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(circle at 20% 50%, rgba(59, 130, 246, 0.08) 0%, transparent 50%),
    radial-gradient(circle at 80% 80%, rgba(124, 58, 237, 0.06) 0%, transparent 50%),
    radial-gradient(circle at 40% 20%, rgba(16, 185, 129, 0.05) 0%, transparent 50%);
  z-index: 0;
}

.header-glow {
  position: absolute;
  top: -50%;
  left: 50%;
  transform: translateX(-50%);
  width: 800px;
  height: 800px;
  background: radial-gradient(circle, rgba(59, 130, 246, 0.15) 0%, transparent 70%);
  filter: blur(60px);
  z-index: 0;
  animation: headerGlow 8s ease-in-out infinite;
}

@keyframes headerGlow {
  0%,
  100% {
    opacity: 0.6;
    transform: translateX(-50%) translateY(0);
  }
  50% {
    opacity: 0.8;
    transform: translateX(-50%) translateY(-20px);
  }
}

.header-content {
  position: relative;
  max-width: 1200px;
  margin: 0 auto;
  padding: 1.5rem 2rem 1.25rem;
  z-index: 1;
}

.header-text {
  max-width: 600px;
}

.profile-title {
  margin: 0 0 0.625rem;
  font-family: 'Sora', sans-serif;
  font-size: 2.5rem;
  font-weight: 800;
  line-height: 1.1;
  letter-spacing: -0.03em;
  background: linear-gradient(135deg, #0f172a 0%, #334155 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  animation: fadeSlideDown 0.7s cubic-bezier(0.16, 1, 0.3, 1);
}

.profile-desc {
  margin: 0;
  font-size: 1.0625rem;
  color: var(--color-text-secondary);
  line-height: 1.6;
  font-weight: 500;
  animation: fadeSlideDown 0.7s cubic-bezier(0.16, 1, 0.3, 1) 0.1s backwards;
}

/* Enhanced Profile Hero with Glassmorphism */
.profile-hero {
  max-width: 1200px;
  margin: -2rem auto 0;
  padding: 0 2rem 2rem;
  position: relative;
  z-index: 2;
}

.hero-card {
  background: rgba(255, 255, 255, 0.8);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: var(--radius-xl);
  padding: 2.5rem;
  box-shadow:
    0 20px 25px -5px rgba(0, 0, 0, 0.08),
    0 8px 10px -6px rgba(0, 0, 0, 0.06),
    inset 0 1px 0 0 rgba(255, 255, 255, 0.9);
  display: flex;
  align-items: center;
  gap: 2rem;
  flex-wrap: wrap;
  animation: fadeSlideUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) 0.2s backwards;
}

.profile-hero-avatar-wrap {
  position: relative;
  flex-shrink: 0;
}

.avatar-ring {
  position: absolute;
  inset: -4px;
  border-radius: 50%;
  background: linear-gradient(135deg, #3b82f6 0%, #8b5cf6 50%, #10b981 100%);
  opacity: 0.6;
  filter: blur(8px);
  animation: avatarPulse 3s ease-in-out infinite;
}

@keyframes avatarPulse {
  0%,
  100% {
    opacity: 0.6;
    transform: scale(1);
  }
  50% {
    opacity: 0.8;
    transform: scale(1.05);
  }
}

.profile-hero-avatar {
  position: relative;
  width: 110px;
  height: 110px;
  border-radius: 50%;
  overflow: hidden;
  border: 4px solid var(--color-surface);
  background: linear-gradient(135deg, #dbeafe 0%, #ede9fe 100%);
  box-shadow:
    0 10px 15px -3px rgba(0, 0, 0, 0.1),
    inset 0 2px 4px 0 rgba(0, 0, 0, 0.05);
}

.profile-hero-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.profile-hero-avatar--initial {
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 2.75rem;
  font-weight: 800;
  color: var(--color-primary);
  font-family: 'Sora', sans-serif;
}

.profile-hero-avatar-btn {
  position: absolute;
  right: -2px;
  bottom: 2px;
  width: 38px;
  height: 38px;
  border-radius: 50%;
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%);
  color: #fff;
  border: 3px solid var(--color-surface);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  padding: 0;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.2);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.profile-hero-avatar-btn:hover:not(:disabled) {
  transform: scale(1.1);
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.3);
}

.profile-hero-avatar-btn:active:not(:disabled) {
  transform: scale(1.05);
}

.profile-hero-avatar-btn:disabled {
  opacity: 0.7;
  cursor: not-allowed;
}

.profile-hero-avatar-btn svg {
  width: 18px;
  height: 18px;
}

.avatar-btn-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

.profile-hero-info {
  flex: 1;
  min-width: 0;
}

.profile-hero-name {
  margin: 0 0 0.5rem;
  font-family: 'Sora', sans-serif;
  font-size: 1.875rem;
  font-weight: 700;
  color: var(--color-text-primary);
  letter-spacing: -0.02em;
}

.profile-hero-badges {
  margin-bottom: 0.75rem;
}

.profile-hero-role {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 1rem;
  font-size: 0.875rem;
  font-weight: 700;
  color: var(--color-primary);
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(59, 130, 246, 0.05) 100%);
  border: 1.5px solid rgba(59, 130, 246, 0.3);
  border-radius: 999px;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  font-size: 0.75rem;
}

.profile-hero-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.9375rem;
  color: var(--color-text-tertiary);
  font-weight: 500;
}

.profile-hero-meta svg {
  width: 16px;
  height: 16px;
  opacity: 0.7;
}

/* Container & Grid */
.profile-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 2rem;
}

.profile-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(360px, 1fr));
  gap: 1.75rem;
}

/* Enhanced Card Styles with Glow Effects */
.card {
  position: relative;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  overflow: hidden;
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: var(--shadow-sm);
}

.card::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  padding: 1px;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.5), transparent);
  -webkit-mask:
    linear-gradient(#fff 0 0) content-box,
    linear-gradient(#fff 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.4s ease;
}

.card:hover::before {
  opacity: 1;
}

.card:hover {
  border-color: var(--color-border-hover);
  box-shadow: var(--shadow-lg);
  transform: translateY(-4px);
}

.card-glow {
  position: absolute;
  inset: 0;
  opacity: 0;
  transition: opacity 0.4s ease;
  pointer-events: none;
  z-index: 0;
}

.card-glow-blue {
  background: radial-gradient(circle at 50% 0%, rgba(59, 130, 246, 0.15) 0%, transparent 70%);
}

.card-glow-purple {
  background: radial-gradient(circle at 50% 0%, rgba(124, 58, 237, 0.15) 0%, transparent 70%);
}

.card-glow-green {
  background: radial-gradient(circle at 50% 0%, rgba(16, 185, 129, 0.15) 0%, transparent 70%);
}

.card:hover .card-glow {
  opacity: 1;
}

.card-animate {
  animation: fadeSlideUp 0.7s cubic-bezier(0.16, 1, 0.3, 1) backwards;
}

.card:nth-child(1) {
  animation-delay: 0.15s;
}
.card:nth-child(2) {
  animation-delay: 0.25s;
}
.card:nth-child(3) {
  animation-delay: 0.35s;
}

.card-signature {
  grid-column: 1 / -1;
}

/* Card Header */
.card-header {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 1.125rem;
  padding: 2rem 2rem 1.5rem;
  border-bottom: 1px solid var(--color-border);
  background: linear-gradient(to bottom, rgba(255, 255, 255, 0) 0%, rgba(0, 0, 0, 0.01) 100%);
  z-index: 1;
}

.card-icon-wrapper {
  flex-shrink: 0;
}

.card-icon {
  width: 52px;
  height: 52px;
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.card-icon::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: inherit;
  opacity: 0.5;
  filter: blur(10px);
  transform: scale(1.1);
  transition: opacity 0.3s ease;
}

.card:hover .card-icon {
  transform: scale(1.08) rotate(-2deg);
}

.card:hover .card-icon::before {
  opacity: 0.8;
}

.card-icon svg {
  width: 26px;
  height: 26px;
  position: relative;
  z-index: 1;
}

.card-icon-primary {
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.15) 0%, rgba(59, 130, 246, 0.08) 100%);
  color: var(--color-primary);
  border: 1.5px solid rgba(59, 130, 246, 0.2);
}

.card-icon-security {
  background: linear-gradient(135deg, rgba(124, 58, 237, 0.15) 0%, rgba(124, 58, 237, 0.08) 100%);
  color: var(--color-security);
  border: 1.5px solid rgba(124, 58, 237, 0.2);
}

.card-icon-signature {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.15) 0%, rgba(16, 185, 129, 0.08) 100%);
  color: var(--color-signature);
  border: 1.5px solid rgba(16, 185, 129, 0.2);
}

.card-header-text {
  flex: 1;
  min-width: 0;
}

.card-title {
  margin: 0 0 0.375rem;
  font-family: 'Sora', sans-serif;
  font-size: 1.25rem;
  font-weight: 700;
  line-height: 1.2;
  color: var(--color-text-primary);
  letter-spacing: -0.01em;
}

.card-subtitle {
  margin: 0;
  font-size: 0.9375rem;
  line-height: 1.5;
  color: var(--color-text-tertiary);
  font-weight: 500;
}

/* Card Body */
.card-body {
  position: relative;
  padding: 2rem;
  z-index: 1;
}

/* Form Groups */
.form-group {
  margin-bottom: 1.75rem;
}

.form-group:last-of-type {
  margin-bottom: 2rem;
}

.form-label {
  display: block;
  margin-bottom: 0.625rem;
  font-size: 0.9375rem;
  font-weight: 700;
  color: var(--color-text-secondary);
  letter-spacing: 0.01em;
}

.input-wrapper {
  position: relative;
}

.form-input {
  width: 100%;
  padding: 0.875rem 1.125rem;
  font-size: 1rem;
  font-family: inherit;
  font-weight: 500;
  line-height: 1.5;
  color: var(--color-text-primary);
  background: var(--color-surface);
  border: 1px solid #cbd5e1;
  border-radius: var(--radius-sm);
  transition: all 0.2s ease;
  outline: none;
}

.form-input::placeholder {
  color: var(--color-text-muted);
  font-weight: 400;
}

.form-input:hover:not(:disabled) {
  border-color: #94a3b8;
}

.form-input:focus {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.1);
}

.form-input-readonly {
  background: #f8fafc;
  color: var(--color-text-tertiary);
  cursor: not-allowed;
  border: 1px solid #cbd5e1;
}

.form-input-static {
  cursor: default;
  display: block;
  min-height: 3rem;
  line-height: 1.4;
  padding-top: 0.75rem;
  padding-bottom: 0.75rem;
}

/* Input with Icon */
.input-with-icon {
  position: relative;
}

.input-with-icon .form-input {
  padding-right: 3.25rem;
}

.input-icon-btn {
  position: absolute;
  right: 0.625rem;
  top: 50%;
  transform: translateY(-50%);
  width: 2.5rem;
  height: 2.5rem;
  padding: 0;
  border: none;
  background: none;
  color: var(--color-text-muted);
  cursor: pointer;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
}

.input-icon-btn svg {
  width: 1.25rem;
  height: 1.25rem;
}

.input-icon-btn:hover {
  color: var(--color-primary);
  background: rgba(59, 130, 246, 0.08);
}

/* Enhanced Role Badge */
.role-badge-wrapper {
  display: inline-flex;
}

.role-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1.25rem;
  font-size: 0.9375rem;
  font-weight: 700;
  color: var(--color-primary);
  background: linear-gradient(135deg, rgba(59, 130, 246, 0.1) 0%, rgba(59, 130, 246, 0.05) 100%);
  border: 1.5px solid rgba(59, 130, 246, 0.25);
  border-radius: var(--radius-sm);
  letter-spacing: 0.01em;
}

.role-badge-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--color-primary);
  box-shadow: 0 0 8px rgba(59, 130, 246, 0.6);
  animation: badgePulse 2s ease-in-out infinite;
}

@keyframes badgePulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.7;
    transform: scale(0.9);
  }
}

/* Message Alerts */
.message-alert {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: 1rem 1.25rem;
  margin-bottom: 1.5rem;
  font-size: 0.9375rem;
  font-weight: 600;
  line-height: 1.5;
  border-radius: var(--radius-sm);
  animation: fadeSlideUp 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  color: red;
}

.message-icon {
  flex-shrink: 0;
  width: 1.375rem;
  height: 1.375rem;
}

.message-icon svg {
  width: 100%;
  height: 100%;
}

.message-success {
  color: var(--color-success);
  background: var(--color-success-bg);
  border: 1.5px solid var(--color-success-border);
}

.message-error {
  color: var(--color-error);
  background: var(--color-error-bg);
  border: 1.5px solid var(--color-error-border);
}

.text-success {
  color: var(--color-success);
}

.text-error {
  color: var(--color-error);
}

/* Enhanced Buttons */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 0.75rem;
  padding: 0.875rem 1.75rem;
  font-size: 1rem;
  font-weight: 700;
  font-family: inherit;
  line-height: 1.5;
  border: none;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  letter-spacing: 0.01em;
  outline: none;
  position: relative;
  overflow: hidden;
}

.btn::before {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(255, 255, 255, 0.2) 0%, transparent 100%);
  opacity: 0;
  transition: opacity 0.3s ease;
}

.btn:hover::before {
  opacity: 1;
}

.btn svg {
  width: 1.25rem;
  height: 1.25rem;
}

.btn-primary {
  background: linear-gradient(135deg, var(--color-primary) 0%, var(--color-primary-dark) 100%);
  color: rgb(0, 0, 0);
  box-shadow:
    0 4px 6px -1px rgba(37, 99, 235, 0.3),
    0 2px 4px -2px rgba(37, 99, 235, 0.2);
}

.btn-primary:hover:not(:disabled) {
  box-shadow:
    0 10px 15px -3px rgba(37, 99, 235, 0.4),
    0 4px 6px -4px rgba(37, 99, 235, 0.3);
  transform: translateY(-2px);
}

.btn-primary:active:not(:disabled) {
  transform: translateY(-1px);
}

.btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
  transform: none !important;
}

/* Button Loader */
.btn-loader {
  width: 1.125rem;
  height: 1.125rem;
  border: 2.5px solid rgba(255, 255, 255, 0.3);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

/* E-Signature Zone */
.card-body-sig {
  padding: 2rem;
}

.sig-file-input {
  position: absolute;
  width: 0.1px;
  height: 0.1px;
  opacity: 0;
  overflow: hidden;
  z-index: -1;
}

.signature-file-input {
  position: absolute;
  width: 0.1px;
  height: 0.1px;
  opacity: 0;
  overflow: hidden;
  z-index: -1;
}

.sig-zone {
  position: relative;
  min-height: 220px;
  border: 2px dashed var(--color-border);
  border-radius: var(--radius-md);
  background: linear-gradient(135deg, #fafbfc 0%, #f8f9fb 100%);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 2.5rem 2rem;
  cursor: pointer;
  transition: all 0.3s ease;
}

.sig-zone:hover {
  border-color: var(--color-signature);
  background: linear-gradient(135deg, var(--color-signature-light) 0%, #f0fdf4 100%);
  box-shadow:
    0 4px 6px -1px rgba(5, 150, 105, 0.1),
    inset 0 2px 4px 0 rgba(5, 150, 105, 0.05);
}

.sig-zone--filled {
  border-style: solid;
  border-color: var(--color-border);
  background: #fff;
  min-height: 200px;
  padding: 2rem;
}

.sig-zone--filled:hover {
  border-color: var(--color-border-hover);
  background: #fafbfc;
}

.sig-zone--uploading {
  pointer-events: none;
  cursor: wait;
}

.sig-zone-preview {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  max-height: 140px;
}

.sig-preview-wrapper {
  padding: 1rem 1.5rem;
  background: #fff;
  border-radius: var(--radius-sm);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.06);
}

.sig-zone-preview img {
  max-width: 100%;
  max-height: 120px;
  object-fit: contain;
}

.sig-zone-change {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 1rem 0 0;
  font-size: 0.9375rem;
  font-weight: 600;
}

.sig-zone-change svg {
  width: 16px;
  height: 16px;
  color: var(--color-signature);
}

.sig-zone-change-link {
  color: var(--color-signature);
  text-decoration: none;
  border-bottom: 2px solid transparent;
  transition: border-color 0.2s;
}

.sig-zone:hover .sig-zone-change-link {
  border-bottom-color: var(--color-signature);
}

.sig-zone-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  pointer-events: none;
}

.sig-zone-icon {
  width: 64px;
  height: 64px;
  margin-bottom: 1.25rem;
  color: var(--color-signature);
  opacity: 0.8;
}

.sig-zone-icon svg {
  width: 100%;
  height: 100%;
}

.sig-zone-title {
  margin: 0 0 0.5rem;
  font-size: 1.125rem;
  font-weight: 700;
  color: var(--color-text-primary);
  font-family: 'Sora', sans-serif;
}

.sig-zone-hint {
  margin: 0 0 1.5rem;
  font-size: 0.9375rem;
  color: var(--color-text-tertiary);
  line-height: 1.5;
  max-width: 320px;
  font-weight: 500;
}

.sig-zone-browse {
  display: inline-flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.75rem 1.5rem;
  font-size: 0.9375rem;
  font-weight: 700;
  color: #0f172a;
  background: linear-gradient(135deg, var(--color-signature) 0%, #047857 100%);
  border-radius: var(--radius-sm);
  box-shadow: 0 4px 6px -1px rgba(5, 150, 105, 0.3);
  transition: all 0.3s ease;
}

.sig-zone-browse svg {
  width: 18px;
  height: 18px;
}

.sig-zone:hover .sig-zone-browse {
  box-shadow: 0 10px 15px -3px rgba(5, 150, 105, 0.4);
  transform: translateY(-2px);
}

.sig-zone-overlay {
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.95);
  backdrop-filter: blur(8px);
  border-radius: inherit;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
}

.sig-zone-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(5, 150, 105, 0.2);
  border-top-color: var(--color-signature);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.sig-zone-overlay-text {
  font-size: 1rem;
  font-weight: 600;
  color: var(--color-text-secondary);
}

.sig-feedback {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin: 1.25rem 0 0;
  padding: 0.875rem 1.125rem;
  font-size: 0.9375rem;
  font-weight: 600;
  line-height: 1.4;
  border-radius: var(--radius-sm);
}

.sig-feedback svg {
  width: 1.25rem;
  height: 1.25rem;
  flex-shrink: 0;
}

.sig-feedback--success {
  background: var(--color-success-bg);
  color: var(--color-success);
  border: 1.5px solid var(--color-success-border);
}

.sig-feedback--error {
  background: var(--color-error-bg);
  color: var(--color-error);
  border: 1.5px solid var(--color-error-border);
}

/* Animations */
@keyframes fadeSlideDown {
  from {
    opacity: 0;
    transform: translateY(-12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes fadeSlideUp {
  from {
    opacity: 0;
    transform: translateY(12px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* Responsive Design */
@media (max-width: 768px) {
  .profile-grid {
    grid-template-columns: 1fr;
  }

  .profile-container {
    padding: 1.5rem 1rem;
  }

  .header-content {
    padding: 1.25rem 1rem 1rem;
  }

  .profile-title {
    font-size: 2rem;
  }

  .hero-card {
    padding: 2rem 1.5rem;
  }

  .card-header {
    padding: 1.75rem 1.5rem 1.25rem;
  }

  .card-body,
  .card-body-sig {
    padding: 1.75rem 1.5rem;
  }
}

@media (max-width: 480px) {
  .profile-title {
    font-size: 1.75rem;
  }

  .profile-desc {
    font-size: 1rem;
  }

  .hero-card {
    padding: 1.75rem 1.25rem;
  }

  .profile-hero-avatar,
  .avatar-ring {
    width: 90px;
    height: 90px;
  }

  .profile-hero-name {
    font-size: 1.5rem;
  }

  .card-icon {
    width: 44px;
    height: 44px;
  }

  .card-icon svg {
    width: 22px;
    height: 22px;
  }

  .sig-zone {
    min-height: 200px;
    padding: 2rem 1.5rem;
  }
}
</style>
