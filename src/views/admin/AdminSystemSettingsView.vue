<script setup>
import { ref, onMounted } from 'vue'
import { useSystemStore } from '@/stores/system'
import { updateSystemConfig } from '@/services/adminService'
import {
  Save,
  AlertCircle,
  ShieldCheck,
  Megaphone,
  Loader2,
  CheckCircle2,
  Settings,
} from 'lucide-vue-next'

const systemStore = useSystemStore()
const loading = ref(false)
const saved = ref(false)
const error = ref(null)
const activeSection = ref('access')

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
  if (!systemStore.initialized) await systemStore.fetchConfig()
  form.value = JSON.parse(JSON.stringify(systemStore.config))
})

async function handleSave() {
  loading.value = true
  saved.value = false
  error.value = null
  try {
    await updateSystemConfig(form.value)
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

const navItems = [
  { id: 'access', label: 'Access Control', icon: ShieldCheck },
  { id: 'comms', label: 'Communications', icon: Megaphone },
]
</script>

<template>
  <div class="page-root">
    <div class="topbar">
      <div class="topbar-left">
        <Settings :size="15" class="topbar-icon" />
        <span class="topbar-title">System Settings</span>
      </div>
      <div class="topbar-right">
        <transition name="fade">
          <span v-if="saved" class="badge-saved"> <CheckCircle2 :size="13" /> Saved </span>
        </transition>
        <button @click="handleSave" :disabled="loading" class="btn-primary">
          <Loader2 v-if="loading" :size="14" class="spin" />
          <Save v-else :size="14" />
          {{ loading ? 'Saving…' : 'Save changes' }}
        </button>
      </div>
    </div>

    <div class="layout">
      <nav class="sidebar">
        <p class="sidebar-label">Configuration</p>
        <button
          v-for="item in navItems"
          :key="item.id"
          class="nav-item"
          :class="{ 'nav-item--active': activeSection === item.id }"
          @click="activeSection = item.id"
        >
          <component :is="item.icon" :size="15" />
          {{ item.label }}
        </button>
      </nav>

      <main class="content">
        <transition name="fade" mode="out-in">
          <div v-if="activeSection === 'access'" key="access">
            <div class="section-head">
              <h2 class="section-title">Access Control</h2>
              <p class="section-desc">Manage system availability and user registration settings.</p>
            </div>
            <transition name="slide-down">
              <div v-if="error" class="error-bar"><AlertCircle :size="14" /> {{ error }}</div>
            </transition>
            <div class="card">
              <div class="setting-row">
                <div class="setting-info">
                  <div class="setting-name">Maintenance Mode</div>
                  <div class="setting-help">
                    Restricts access to super admins only. Other users are redirected to a
                    maintenance page.
                  </div>
                </div>
                <label class="toggle">
                  <input type="checkbox" v-model="form.maintenanceMode" />
                  <span class="track"><span class="thumb" /></span>
                </label>
              </div>
              <div class="row-sep" />
              <div class="setting-row">
                <div class="setting-info">
                  <div class="setting-name">Public Registration</div>
                  <div class="setting-help">
                    Allow visitors to create new accounts through the public registration page.
                  </div>
                </div>
                <label class="toggle">
                  <input type="checkbox" v-model="form.registrationEnabled" />
                  <span class="track"><span class="thumb" /></span>
                </label>
              </div>
            </div>
          </div>

          <div v-else-if="activeSection === 'comms'" key="comms">
            <div class="section-head">
              <h2 class="section-title">System Communications</h2>
              <p class="section-desc">
                Broadcast announcements and notifications to all active users.
              </p>
            </div>
            <transition name="slide-down">
              <div v-if="error" class="error-bar"><AlertCircle :size="14" /> {{ error }}</div>
            </transition>
            <div class="card">
              <div class="setting-row">
                <div class="setting-info">
                  <div class="setting-name">Announcement Banner</div>
                  <div class="setting-help">
                    Display a system-wide notification bar at the top of every page.
                  </div>
                </div>
                <label class="toggle">
                  <input type="checkbox" v-model="form.announcement.active" />
                  <span class="track"><span class="thumb" /></span>
                </label>
              </div>
              <div class="row-sep" />
              <div class="field-block">
                <label class="field-label">Banner message</label>
                <textarea
                  v-model="form.announcement.text"
                  class="field-textarea"
                  :disabled="!form.announcement.active"
                  placeholder="e.g. Scheduled downtime tomorrow at 8:00 AM UTC"
                  rows="3"
                />
              </div>
              <div class="row-sep" />
              <div class="field-block">
                <label class="field-label">Banner style</label>
                <div class="style-grid">
                  <label
                    v-for="opt in [
                      { value: 'info', label: 'Informational', cls: 'opt--blue' },
                      { value: 'warning', label: 'Urgent', cls: 'opt--amber' },
                      { value: 'success', label: 'Positive', cls: 'opt--green' },
                    ]"
                    :key="opt.value"
                    class="style-opt"
                    :class="[opt.cls, { 'style-opt--on': form.announcement.type === opt.value }]"
                  >
                    <input type="radio" :value="opt.value" v-model="form.announcement.type" />
                    <span class="style-pip" />
                    {{ opt.label }}
                  </label>
                </div>
              </div>
            </div>
          </div>
        </transition>
      </main>
    </div>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');

*,
*::before,
*::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

.page-root {
  font-family: 'Inter', system-ui, sans-serif;
  font-size: 14px;
  color: #18181b;
  -webkit-font-smoothing: antialiased;
  background: #f7f7f8;
  min-height: 100vh;
}

/* ── Topbar ─────────────────────────────────── */
.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 52px;
  padding: 0 1.5rem;
  background: #fff;
  border-bottom: 1px solid #e4e4e7;
  position: sticky;
  top: 0;
  z-index: 20;
}

.topbar-left {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.topbar-icon {
  color: #71717a;
}
.topbar-title {
  font-size: 0.875rem;
  font-weight: 600;
  letter-spacing: -0.01em;
}
.topbar-right {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

/* ── Save button ────────────────────────────── */
.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 0.875rem;
  background: #18181b;
  color: #fff;
  border: none;
  border-radius: 7px;
  font-size: 0.8125rem;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition:
    background 0.12s,
    transform 0.1s;
}
.btn-primary:hover:not(:disabled) {
  background: #27272a;
}
.btn-primary:active:not(:disabled) {
  transform: scale(0.97);
}
.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* ── Saved badge ────────────────────────────── */
.badge-saved {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.8rem;
  font-weight: 500;
  color: #16a34a;
  background: #f0fdf4;
  border: 1px solid #bbf7d0;
  padding: 0.3rem 0.65rem;
  border-radius: 6px;
}

/* ── Layout ─────────────────────────────────── */
.layout {
  display: flex;
  max-width: 1100px;
  margin: 0 auto;
  padding: 1.75rem 2rem;
  gap: 0;
  align-items: flex-start;
}

/* ── Sidebar ─────────────────────────────────── */
.sidebar {
  width: 220px;
  flex-shrink: 0;
  position: sticky;
  top: 52px;
  padding: 0 1.5rem 0 0;
  border-right: 1px solid #e4e4e7;
}

.sidebar-label {
  font-size: 0.69rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: #a1a1aa;
  padding: 0 0.5rem;
  margin-bottom: 0.375rem;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 0.55rem;
  width: 100%;
  padding: 0.5rem 0.75rem;
  border: none;
  background: none;
  border-radius: 7px;
  font-size: 0.875rem;
  font-weight: 500;
  font-family: inherit;
  color: #52525b;
  cursor: pointer;
  transition: background 0.1s;
  text-align: left;
  margin-bottom: 1px;
}
.nav-item:hover {
  background: #ededef;
  color: #18181b;
}
.nav-item--active {
  background: #18181b;
  color: #fff;
}
.nav-item--active:hover {
  background: #27272a;
  color: #fff;
}

/* ── Content area ───────────────────────────── */
.content {
  flex: 1;
  min-width: 0;
  padding: 0 0 0 2rem;
}

.section-head {
  margin-bottom: 1.25rem;
}

.section-title {
  font-size: 1rem;
  font-weight: 600;
  letter-spacing: -0.02em;
  color: #18181b;
  margin-bottom: 0.25rem;
}

.section-desc {
  font-size: 0.8125rem;
  color: #71717a;
  line-height: 1.5;
}

/* ── Card ───────────────────────────────────── */
.card {
  background: #fff;
  border: 1px solid #e4e4e7;
  border-radius: 12px;
  overflow: hidden;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2rem;
  padding: 1.1rem 1.25rem;
}

.setting-name {
  font-size: 0.875rem;
  font-weight: 500;
  color: #18181b;
  margin-bottom: 0.2rem;
}

.setting-help {
  font-size: 0.8rem;
  color: #a1a1aa;
  line-height: 1.5;
}

.row-sep {
  height: 1px;
  background: #f4f4f5;
}

.field-block {
  padding: 1.1rem 1.25rem;
}

.field-label {
  display: block;
  font-size: 0.8rem;
  font-weight: 500;
  color: #52525b;
  margin-bottom: 0.45rem;
}

.field-textarea {
  display: block;
  width: 100%;
  background: #fafafa;
  border: 1px solid #e4e4e7;
  border-radius: 8px;
  padding: 0.65rem 0.875rem;
  font-family: inherit;
  font-size: 0.875rem;
  color: #18181b;
  resize: vertical;
  line-height: 1.5;
  transition:
    border-color 0.12s,
    box-shadow 0.12s;
}
.field-textarea::placeholder {
  color: #d4d4d8;
}
.field-textarea:focus {
  outline: none;
  border-color: #a1a1aa;
  background: #fff;
  box-shadow: 0 0 0 3px rgba(24, 24, 27, 0.05);
}
.field-textarea:disabled {
  background: #f4f4f5;
  color: #a1a1aa;
  cursor: not-allowed;
}

/* ── Style picker ────────────────────────────── */
.style-grid {
  display: flex;
  gap: 0.5rem;
}

.style-opt {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.6rem 0.75rem;
  border-radius: 8px;
  border: 1px solid #e4e4e7;
  background: #fafafa;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition:
    border-color 0.12s,
    background 0.12s;
}
.style-opt input {
  display: none;
}

.style-pip {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 2px solid currentColor;
  flex-shrink: 0;
  transition: background 0.12s;
}

.opt--blue {
  color: #2563eb;
}
.opt--amber {
  color: #d97706;
}
.opt--green {
  color: #16a34a;
}

.style-opt--on.opt--blue {
  background: #eff6ff;
  border-color: #93c5fd;
}
.style-opt--on.opt--amber {
  background: #fffbeb;
  border-color: #fcd34d;
}
.style-opt--on.opt--green {
  background: #f0fdf4;
  border-color: #86efac;
}
.style-opt--on .style-pip {
  background: currentColor;
}

/* ── Toggle ──────────────────────────────────── */
.toggle {
  position: relative;
  display: inline-flex;
  cursor: pointer;
  flex-shrink: 0;
}
.toggle input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.track {
  display: block;
  width: 40px;
  height: 22px;
  background: #d4d4d8;
  border-radius: 999px;
  position: relative;
  transition: background 0.18s;
}

.thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  background: #fff;
  border-radius: 50%;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.15);
  transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}

.toggle input:checked ~ .track {
  background: #18181b;
}
.toggle input:checked ~ .track .thumb {
  transform: translateX(18px);
}
.toggle:hover .track {
  background: #a1a1aa;
}
.toggle input:checked:hover ~ .track {
  background: #27272a;
}

/* ── Error ───────────────────────────────────── */
.error-bar {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  background: #fff1f2;
  border: 1px solid #fecdd3;
  color: #be123c;
  font-size: 0.8rem;
  font-weight: 500;
  padding: 0.65rem 0.875rem;
  border-radius: 8px;
  margin-bottom: 1rem;
}

/* ── Spinner ─────────────────────────────────── */
.spin {
  animation: spin 0.75s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

/* ── Transitions ─────────────────────────────── */
.fade-enter-active,
.fade-leave-active {
  transition:
    opacity 0.13s,
    transform 0.13s;
}
.fade-enter-from {
  opacity: 0;
  transform: translateY(4px);
}
.fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
.slide-down-enter-active {
  transition:
    opacity 0.2s,
    transform 0.2s;
}
.slide-down-enter-from {
  opacity: 0;
  transform: translateY(-6px);
}

/* ── Responsive ──────────────────────────────── */
@media (max-width: 640px) {
  .layout {
    flex-direction: column;
    padding: 1rem;
    gap: 1.25rem;
  }
  .sidebar {
    width: 100%;
    position: static;
    border-right: none;
    border-bottom: 1px solid #e4e4e7;
    padding: 0 0 1rem 0;
  }
  .content {
    padding: 0;
  }
  .style-grid {
    flex-direction: column;
  }
}
</style>
