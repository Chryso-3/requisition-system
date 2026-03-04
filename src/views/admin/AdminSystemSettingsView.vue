<script setup>
import { ref, onMounted } from 'vue'
import { useSystemStore } from '@/stores/system'
import { updateSystemConfig } from '@/services/adminService'
import {
  Save,
  AlertCircle,
  Megaphone,
  Shield,
  UserPlus,
  Loader2,
  CheckCircle2,
} from 'lucide-vue-next'

const systemStore = useSystemStore()
const loading = ref(false)
const saved = ref(false)
const error = ref(null)

// Local form state
const form = ref({
  registrationEnabled: true,
  maintenanceMode: false,
  announcement: {
    active: false,
    text: '',
    type: 'info',
  },
})

onMounted(async () => {
  if (!systemStore.initialized) {
    await systemStore.fetchConfig()
  }
  // Clone current config into form
  form.value = JSON.parse(JSON.stringify(systemStore.config))
})

async function handleSave() {
  loading.value = true
  saved.value = false
  error.value = null

  try {
    await updateSystemConfig(form.value)
    // Refresh global store
    await systemStore.fetchConfig()
    saved.value = true
    setTimeout(() => {
      saved.value = false
    }, 3000)
  } catch (err) {
    error.value = 'Failed to update settings: ' + err.message
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="admin-settings-view">
    <header class="page-header">
      <div>
        <h1 class="page-title">System Settings</h1>
        <p class="page-subtitle">Configure global parameters and site-wide notifications</p>
      </div>
      <div class="header-actions">
        <div v-if="saved" class="save-success">
          <CheckCircle2 :size="16" />
          Settings Saved
        </div>
        <button
          @click="handleSave"
          :disabled="loading"
          class="btn-save"
          :class="{ loading: loading }"
        >
          <Loader2 v-if="loading" class="animate-spin" :size="18" />
          <Save v-else :size="18" />
          <span>{{ loading ? 'Saving...' : 'Save Changes' }}</span>
        </button>
      </div>
    </header>

    <div v-if="error" class="error-alert">
      <AlertCircle :size="18" />
      {{ error }}
    </div>

    <div class="settings-grid">
      <!-- Access Control -->
      <section class="glass-card elite-card animate-staggered" style="--order: 0">
        <div class="section-header-elite">
          <div class="icon-orb-elite blue-elite">
            <Shield :size="22" />
          </div>
          <div>
            <h2 class="section-title-elite">Access Control</h2>
            <p class="section-desc-elite">Manage system availability and user registration</p>
          </div>
        </div>

        <div class="setting-item-elite">
          <div class="setting-info-elite">
            <h3 class="setting-label-elite">Global Maintenance Mode</h3>
            <p class="setting-help-elite">
              Restrict access to Super Admins only. Other users will see a maintenance page.
            </p>
          </div>
          <label class="elite-switch">
            <input type="checkbox" v-model="form.maintenanceMode" />
            <span class="elite-slider"></span>
          </label>
        </div>

        <div class="setting-divider-elite"></div>

        <div class="setting-item-elite">
          <div class="setting-info-elite">
            <h3 class="setting-label-elite">Public Registration</h3>
            <p class="setting-help-elite">
              Allow new users to create accounts via the registration page.
            </p>
          </div>
          <label class="elite-switch">
            <input type="checkbox" v-model="form.registrationEnabled" />
            <span class="elite-slider"></span>
          </label>
        </div>
      </section>

      <!-- Communications -->
      <section class="glass-card elite-card animate-staggered" style="--order: 1">
        <div class="section-header-elite">
          <div class="icon-orb-elite amber-elite">
            <Megaphone :size="22" />
          </div>
          <div>
            <h2 class="section-title-elite">System Communications</h2>
            <p class="section-desc-elite">Broadcast messages to all active users</p>
          </div>
        </div>

        <div class="setting-item-elite">
          <div class="setting-info-elite">
            <h3 class="setting-label-elite">Announcement Banner</h3>
            <p class="setting-help-elite">Toggle the visibility of the global notification bar.</p>
          </div>
          <label class="elite-switch">
            <input type="checkbox" v-model="form.announcement.active" />
            <span class="elite-slider"></span>
          </label>
        </div>

        <div class="form-group mt-6">
          <label class="input-label-elite">Banner Message</label>
          <textarea
            v-model="form.announcement.text"
            placeholder="e.g. Scheduled downtime tomorrow at 8:00 AM"
            class="elite-textarea"
            :disabled="!form.announcement.active"
          ></textarea>
        </div>

        <div class="form-group mt-4">
          <label class="input-label-elite">Banner Style Theme</label>
          <div class="elite-theme-picker">
            <label class="elite-theme-option">
              <input type="radio" value="info" v-model="form.announcement.type" />
              <div class="elite-theme-preview info-elite">
                <div class="elite-radio-dot"></div>
                Informational Blue
              </div>
            </label>
            <label class="elite-theme-option">
              <input type="radio" value="warning" v-model="form.announcement.type" />
              <div class="elite-theme-preview warning-elite">
                <div class="elite-radio-dot"></div>
                Urgent Amber
              </div>
            </label>
            <label class="elite-theme-option">
              <input type="radio" value="success" v-model="form.announcement.type" />
              <div class="elite-theme-preview success-elite">
                <div class="elite-radio-dot"></div>
                Positive Emerald
              </div>
            </label>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.admin-settings-view {
  padding: 0.5rem 2rem 2rem; /* Balanced horizontal padding */
  max-width: 1200px; /* Better breadth for Compact Elite */
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 1.5rem;
}

.page-title {
  font-size: 1.875rem;
  font-weight: 800;
  letter-spacing: -0.03em;
  color: #0f172a;
}

.page-subtitle {
  color: #64748b;
  font-size: 0.9375rem;
  margin-top: 0.25rem;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 1.25rem;
}

.btn-save {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  background: linear-gradient(135deg, #1e293b 0%, #0f172a 100%);
  color: white;
  border: none;
  padding: 0.75rem 1.25rem;
  border-radius: 0.75rem;
  font-weight: 700;
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
}

.btn-save:hover:not(:disabled) {
  transform: translateY(-2px);
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1);
  filter: brightness(1.1);
}

.btn-save:active {
  transform: translateY(0);
}

.btn-save:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.save-success {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: #10b981;
  font-size: 0.875rem;
  font-weight: 600;
  animation: slideInRight 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

@keyframes slideInRight {
  from {
    opacity: 0;
    transform: translateX(10px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.error-alert {
  background: #fef2f2;
  border: 1px solid #fee2e2;
  color: #ef4444;
  padding: 1rem;
  border-radius: 0.75rem;
  margin-bottom: 2rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.875rem;
  font-weight: 500;
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
  gap: 2rem;
}

.glass-card.elite-card {
  background: rgba(255, 255, 255, 0.4);
  backdrop-filter: blur(25px) saturate(180%);
  -webkit-backdrop-filter: blur(25px) saturate(180%);
  border-radius: 24px;
  border: 1px solid rgba(255, 255, 255, 0.4);
  padding: 2.5rem;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.04),
    inset 0 0 0 1px rgba(255, 255, 255, 0.2);
  transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.glass-card.elite-card:hover {
  transform: translateY(-6px);
  background: rgba(255, 255, 255, 0.55);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.08);
}

.section-header-elite {
  display: flex;
  align-items: flex-start;
  gap: 1.25rem;
  margin-bottom: 2.5rem;
}

.icon-orb-elite {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 8px 16px -4px rgba(0, 0, 0, 0.1);
}

.icon-orb-elite.blue-elite {
  background: linear-gradient(135deg, #0ea5e9, #0284c7);
  color: white;
}

.icon-orb-elite.amber-elite {
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: white;
}

.section-title-elite {
  font-size: 1.125rem;
  font-weight: 800;
  color: #0f172a;
  letter-spacing: -0.01em;
}

.section-desc-elite {
  font-size: 0.85rem;
  color: #64748b;
  margin-top: 0.125rem;
}

.setting-item-elite {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2rem;
}

.setting-label-elite {
  font-size: 0.95rem;
  font-weight: 700;
  color: #1e293b;
}

.setting-help-elite {
  font-size: 0.8125rem;
  color: #94a3b8;
  margin-top: 0.25rem;
  line-height: 1.5;
}

.setting-divider-elite {
  height: 1px;
  background: rgba(0, 0, 0, 0.05);
  margin: 2rem 0;
}

/* Elite Toggle Switch */
.elite-switch {
  position: relative;
  display: inline-block;
  width: 48px;
  height: 26px;
  flex-shrink: 0;
}

.elite-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.elite-slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #e2e8f0;
  transition: 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  border-radius: 26px;
}

.elite-slider:before {
  position: absolute;
  content: '';
  height: 20px;
  width: 20px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: 0.3s cubic-bezier(0.16, 1, 0.3, 1);
  border-radius: 50%;
  box-shadow: 0 2px 5px rgba(0, 0, 0, 0.15);
}

input:checked + .elite-slider {
  background-color: #0f172a;
}
input:checked + .elite-slider:before {
  transform: translateX(22px);
}

/* Form Elements */
.input-label-elite {
  font-size: 0.85rem;
  font-weight: 700;
  color: #475569;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 0.5rem;
}

.elite-textarea {
  width: 100%;
  min-height: 110px;
  background: rgba(255, 255, 255, 0.6);
  border: 1px solid rgba(226, 232, 240, 0.8);
  border-radius: 12px;
  padding: 1rem;
  font-family: inherit;
  font-size: 0.95rem;
  color: #1e293b;
  resize: vertical;
  transition: all 0.2s;
}

.elite-textarea:focus {
  outline: none;
  border-color: #0f172a;
  background: white;
  box-shadow: 0 0 0 4px rgba(15, 23, 42, 0.05);
}

.elite-textarea:disabled {
  background: rgba(241, 245, 249, 0.5);
  cursor: not-allowed;
  opacity: 0.6;
}

.elite-theme-picker {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.elite-theme-option input {
  display: none;
}

.elite-theme-preview {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  padding: 0.875rem 1.25rem;
  border-radius: 12px;
  font-size: 0.875rem;
  font-weight: 700;
  border: 1px solid transparent;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  cursor: pointer;
}

.elite-radio-dot {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid white;
  background: transparent;
  transition: all 0.2s;
}

.info-elite {
  background: rgba(14, 165, 233, 0.08);
  color: #0369a1;
}
.warning-elite {
  background: rgba(245, 158, 11, 0.08);
  color: #b45309;
}
.success-elite {
  background: rgba(16, 185, 129, 0.08);
  color: #047857;
}

.elite-theme-option input:checked + .info-elite {
  border-color: #0369a1;
  background: rgba(14, 165, 233, 0.15);
}
.elite-theme-option input:checked + .warning-elite {
  border-color: #b45309;
  background: rgba(245, 158, 11, 0.15);
}
.elite-theme-option input:checked + .success-elite {
  border-color: #047857;
  background: rgba(16, 185, 129, 0.15);
}

.elite-theme-option input:checked + .elite-theme-preview .elite-radio-dot {
  background: currentColor;
  transform: scale(1.1);
}

.mt-6 {
  margin-top: 1.5rem;
}
.mt-4 {
  margin-top: 1rem;
}

.animate-staggered {
  opacity: 0;
  animation: slideUpElite 0.6s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  animation-delay: calc(var(--order) * 0.1s);
}

@keyframes slideUpElite {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (max-width: 640px) {
  .settings-grid {
    grid-template-columns: 1fr;
  }
}
</style>
