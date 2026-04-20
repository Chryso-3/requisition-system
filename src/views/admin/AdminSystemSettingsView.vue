<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useSystemStore } from '@/stores/system'
import { updateSystemConfig, getCounters, setCounter } from '@/services/adminService'
import {
  Save,
  AlertCircle,
  ShieldCheck,
  Megaphone,
  Loader2,
  CheckCircle2,
  Settings,
  Hash,
  ChevronLeft,
  ChevronRight,
  Info,
  Sliders,
} from 'lucide-vue-next'

const systemStore = useSystemStore()
const loading = ref(false)
const saved = ref(false)
const error = ref(null)
const activeSection = ref('access')

// General Config Form
const form = ref({
  registrationEnabled: true,
  maintenanceMode: false,
  googleSignInEnabled: true,
  announcement: {
    active: false,
    text: '',
    type: 'info',
  },
})

// Control Center specific state
const selectedYear = ref(new Date().getFullYear())
const counters = ref({ rf: 0 })
const editValues = ref({ rf: '' })
const loadingCounters = ref(true)
const savingCounter = ref(null)

onMounted(async () => {
  if (!systemStore.initialized) await systemStore.fetchConfig()
  form.value = JSON.parse(JSON.stringify(systemStore.config))
  fetchCounters()
})

async function fetchCounters() {
  loadingCounters.value = true
  try {
    const data = await getCounters(selectedYear.value)
    if (data) {
      counters.value = data
      editValues.value.rf = (data.rf || 0).toString()
    }
  } catch (err) {
    console.error('Error fetching counters:', err)
  } finally {
    loadingCounters.value = false
  }
}

async function handleUpdateCounter(type) {
  const value = editValues.value[type]
  if (!value && value !== 0) return

  savingCounter.value = type
  try {
    await setCounter(type, value, selectedYear.value)
    await fetchCounters()
    showSaved()
  } catch (err) {
    error.value = 'Failed to update counter: ' + err.message
  } finally {
    savingCounter.value = null
  }
}

function adjustYear(delta) {
  selectedYear.value += delta
}

watch(selectedYear, () => {
  fetchCounters()
})

// Navigation
const navItems = [
  { id: 'access', label: 'Access Control', icon: ShieldCheck },
  { id: 'comms', label: 'Communications', icon: Megaphone },
  { id: 'control', label: 'Control Center', icon: Sliders },
]

async function handleSave() {
  loading.value = true
  saved.value = false
  error.value = null
  try {
    await updateSystemConfig(form.value)
    await systemStore.fetchConfig()
    showSaved()
  } catch (err) {
    error.value = 'Failed to update settings: ' + err.message
  } finally {
    loading.value = false
  }
}

function showSaved() {
  saved.value = true
  setTimeout(() => {
    saved.value = false
  }, 3000)
}
</script>

<template>
  <div class="page-root">
    <div class="topbar">
      <div class="topbar-left">
        <Settings :size="15" class="topbar-icon" />
        <span class="topbar-crumb">System</span>
        <span class="topbar-sep">/</span>
        <span class="topbar-title">Configuration</span>
      </div>
      <div class="topbar-right">
        <transition name="fade">
          <span v-if="saved" class="badge-saved"> <CheckCircle2 :size="13" /> Saved </span>
        </transition>
        <button @click="handleSave" :disabled="loading" class="btn-primary">
          <Loader2 v-if="loading" :size="14" class="spin" />
          <Save v-else :size="14" />
          {{ loading ? 'Saving...' : 'Save changes' }}
        </button>
      </div>
    </div>

    <div class="layout">
      <nav class="sidebar">
        <p class="sidebar-label">Navigation</p>
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
          <!-- Access Control -->
          <div v-if="activeSection === 'access'" key="access">
            <div class="section-head">
              <h1 class="section-title">Access Control</h1>
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

          <!-- Communications -->
          <div v-else-if="activeSection === 'comms'" key="comms">
            <div class="section-head">
              <h1 class="section-title">System Communications</h1>
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
                <div class="field-label-group">
                  <label class="field-label">Banner message</label>
                  <span class="field-badge" v-if="form.announcement.text.length > 0">
                    {{ form.announcement.text.length }} chars
                  </span>
                </div>
                <div class="textarea-wrapper" :class="{ 'textarea-wrapper--disabled': !form.announcement.active }">
                  <Megaphone class="input-icon" :size="16" />
                  <textarea
                    v-model="form.announcement.text"
                    class="field-textarea"
                    :disabled="!form.announcement.active"
                    placeholder="Type your system-wide announcement here..."
                    rows="3"
                  />
                  <div class="input-focus-border" />
                </div>
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

          <!-- Control Center -->
          <div v-else-if="activeSection === 'control'" key="control">
            <div class="section-head">
              <h1 class="section-title">Control Center</h1>
              <p class="section-desc">
                Manage authentication protocols and document sequence configuration.
              </p>
            </div>

            <div class="section-label-inner"><ShieldCheck :size="14" /> Access & security</div>
            <div class="card">
              <div class="setting-row">
                <div class="setting-info">
                  <div class="setting-name-group">
                    <div class="setting-name">Google Authentication</div>
                    <span class="status-badge" :class="form.googleSignInEnabled ? 'status-badge--on' : 'status-badge--off'">
                      {{ form.googleSignInEnabled ? 'Enabled' : 'Disabled' }}
                    </span>
                  </div>
                  <div class="setting-help">
                    Allow users to authenticate using their corporate Google account.
                  </div>
                </div>
                <label class="toggle">
                  <input type="checkbox" v-model="form.googleSignInEnabled" />
                  <span class="track"><span class="thumb" /></span>
                </label>
              </div>
            </div>

            <div class="section-label-inner" style="margin-top: 2rem">
              <Hash :size="14" /> Sequence control
            </div>
            <div class="card">
              <div class="card-inner">
                <div class="stats-strip">
                  <div class="stat">
                    <span class="stat-label">Current index</span>
                    <span class="stat-val">{{ String(counters.rf).padStart(6, '0') }}</span>
                  </div>
                  <span class="stat-arrow">→</span>
                  <div class="stat">
                    <span class="stat-label">Next</span>
                    <span class="stat-val stat-val--blue">{{
                      String(counters.rf + 1).padStart(6, '0')
                    }}</span>
                  </div>
                  <div class="stat stat--right">
                    <span class="stat-label">Year scope</span>
                    <div class="year-picker">
                      <button @click="adjustYear(-1)" class="year-nav">
                        <ChevronLeft :size="14" />
                      </button>
                      <span class="year-val">{{ selectedYear }}</span>
                      <button @click="adjustYear(1)" class="year-nav">
                        <ChevronRight :size="14" />
                      </button>
                    </div>
                  </div>
                </div>

                <div class="override-box">
                  <div class="setting-info">
                    <div class="setting-name">Manual counter override</div>
                    <div class="setting-help">
                      Set a new starting value for the RF sequence. Only affects documents generated
                      after this update.
                    </div>
                  </div>
                  <div class="override-form">
                    <input
                      v-model="editValues.rf"
                      type="number"
                      placeholder="000000"
                      class="num-input"
                    />
                    <button
                      class="sync-btn"
                      @click="handleUpdateCounter('rf')"
                      :disabled="savingCounter === 'rf'"
                    >
                      <Loader2 v-if="savingCounter === 'rf'" :size="14" class="spin" />
                      {{ savingCounter === 'rf' ? 'Saving...' : 'Sync' }}
                    </button>
                  </div>
                </div>

                <p class="hint">
                  <Info :size="14" />
                  Override affects subsequent document generation only. Existing records are not
                  modified.
                </p>
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
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@600;700&display=swap');

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
.topbar-crumb {
  color: #71717a;
  font-size: 0.8125rem;
}
.topbar-sep {
  color: #d4d4d8;
  font-size: 0.75rem;
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

/* ── Buttons ────────────────────────────── */
.btn-primary {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.45rem 0.875rem;
  background: #18181b;
  color: #fff;
  border: none;
  border-radius: 7px;
  font-size: 0.8125rem;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.1s;
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

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
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
  padding: 2.5rem 2rem;
  gap: 0;
  align-items: flex-start;
}

/* ── Sidebar ─────────────────────────────────── */
.sidebar {
  width: 220px;
  flex-shrink: 0;
  position: sticky;
  top: 76px;
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
  padding: 0 0 0 3rem;
}

.section-head {
  margin-bottom: 1.5rem;
}

.section-title {
  font-size: 1.125rem;
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

.section-label-inner {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  font-weight: 600;
  color: #a1a1aa;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 0.75rem;
}

/* ── Card ───────────────────────────────────── */
.card {
  background: #fff;
  border: 1px solid #e4e4e7;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
}
.card-inner {
  padding: 1.5rem;
}

.setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 2rem;
  padding: 1.1rem 1.25rem;
}

.setting-name-group {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.2rem;
}

.setting-name {
  font-size: 0.875rem;
  font-weight: 500;
  color: #18181b;
}

.status-badge {
  font-size: 0.625rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0.15rem 0.5rem;
  border-radius: 99px;
  border: 1px solid transparent;
}

.status-badge--on {
  color: #059669;
  background: #ecfdf5;
  border-color: #d1fae5;
}

.status-badge--off {
  color: #dc2626;
  background: #fef2f2;
  border-color: #fee2e2;
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
  font-size: 0.7rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #a1a1aa;
}

.field-label-group {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.65rem;
}

.field-badge {
  font-size: 0.65rem;
  font-weight: 600;
  color: #71717a;
  background: #f4f4f5;
  padding: 0.15rem 0.45rem;
  border-radius: 4px;
}

.textarea-wrapper {
  position: relative;
  background: #fff;
  border: 1.5px solid #e4e4e7;
  border-radius: 10px;
  padding: 0.875rem;
  transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  align-items: flex-start;
  gap: 0.75rem;
}

.textarea-wrapper:focus-within {
  border-color: #18181b;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);
  transform: translateY(-1px);
}

.input-icon {
  color: #a1a1aa;
  margin-top: 0.25rem;
  transition: color 0.2s;
}

.textarea-wrapper:focus-within .input-icon {
  color: #18181b;
}

.field-textarea {
  width: 100%;
  border: none;
  background: transparent;
  font-family: inherit;
  font-size: 0.9rem;
  font-weight: 500;
  color: #18181b;
  resize: vertical;
  min-height: 80px;
  line-height: 1.5;
  padding: 0;
}

.field-textarea:focus {
  outline: none;
}

.field-textarea::placeholder {
  color: #d4d4d8;
  font-weight: 400;
}

.textarea-wrapper--disabled {
  background: #f9f9fb;
  border-color: #f1f1f4;
  cursor: not-allowed;
}

.textarea-wrapper--disabled .input-icon,
.textarea-wrapper--disabled .field-textarea {
  opacity: 0.4;
  pointer-events: none;
}

.input-focus-border {
  position: absolute;
  inset: -1.5px;
  border-radius: 10px;
  border: 2px solid #18181b;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.2s;
}

.textarea-wrapper:focus-within .input-focus-border {
  opacity: 1;
}


/* ── Control Center Specifics ────────────────── */
.stats-strip {
  display: flex;
  align-items: center;
  gap: 1.5rem;
  background: #f9f9fb;
  padding: 1rem 1.25rem;
  border-radius: 10px;
  border: 1px solid #f1f1f4;
  margin-bottom: 1.5rem;
}

/* ── Banner Style Picker ────────────────────── */
.style-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.75rem;
  margin-top: 0.5rem;
}

.style-opt {
  position: relative;
  display: flex;
  align-items: center;
  gap: 0.65rem;
  padding: 0.75rem 1rem;
  background: #fff;
  border: 1.5px solid #e4e4e7;
  border-radius: 9px;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  font-size: 0.8125rem;
  font-weight: 600;
  color: #52525b;
}

.style-opt input {
  position: absolute;
  opacity: 0;
  width: 0;
  height: 0;
}

.style-pip {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #d4d4d8;
  transition: all 0.2s;
}

.style-opt:hover {
  border-color: #d4d4d8;
  background: #fafafa;
}

/* Selected states */
.style-opt--on {
  border-color: currentColor;
  box-shadow: 0 0 0 1px currentColor;
  background: #fff;
  color: #18181b;
}

.style-opt--on .style-pip {
  transform: scale(1.4);
}

.opt--blue.style-opt--on { color: #2563eb; background: #eff6ff; border-color: #bfdbfe; }
.opt--blue .style-pip { background: #3b82f6; }

.opt--amber.style-opt--on { color: #d97706; background: #fffbeb; border-color: #fde68a; }
.opt--amber .style-pip { background: #f59e0b; }

.opt--green.style-opt--on { color: #16a34a; background: #f0fdf4; border-color: #bbf7d0; }
.opt--green .style-pip { background: #10b981; }

.style-opt:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}


.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.stat--right {
  margin-left: auto;
}
.stat-label {
  font-size: 0.65rem;
  font-weight: 700;
  color: #a1a1aa;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
.stat-val {
  font-family: 'JetBrains Mono', monospace;
  font-size: 1.5rem;
  font-weight: 700;
  color: #18181b;
  line-height: 1;
}
.stat-val--blue {
  color: #2563eb;
}
.stat-arrow {
  color: #e4e4e7;
}

.year-picker {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.year-nav {
  width: 24px;
  height: 24px;
  border: 1px solid #e4e4e7;
  background: white;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #71717a;
  cursor: pointer;
  transition: all 0.1s;
}
.year-nav:hover {
  background: #f4f4f5;
  color: #18181b;
}
.year-val {
  font-size: 0.875rem;
  font-weight: 600;
  color: #18181b;
  min-width: 40px;
  text-align: center;
}

.override-box {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 2rem;
  margin-top: 1rem;
}

.override-form {
  display: flex;
  gap: 0.5rem;
}
.num-input {
  width: 110px;
  height: 36px;
  border: 1.5px solid #e4e4e7;
  border-radius: 7px;
  padding: 0 0.75rem;
  font-family: 'JetBrains Mono', monospace;
  font-size: 0.9rem;
  font-weight: 600;
  color: #18181b;
  transition: border-color 0.1s;
}
.num-input:focus {
  outline: none;
  border-color: #18181b;
}

.sync-btn {
  height: 36px;
  padding: 0 1rem;
  background: #18181b;
  color: #fff;
  border: none;
  border-radius: 7px;
  font-size: 0.8125rem;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.sync-btn:hover {
  background: #27272a;
}
.sync-btn:disabled {
  opacity: 0.6;
}

.hint {
  display: flex;
  align-items: flex-start;
  gap: 0.45rem;
  margin-top: 1.25rem;
  font-size: 0.75rem;
  color: #a1a1aa;
  line-height: 1.5;
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
  width: 36px;
  height: 20px;
  background: #e4e4e7;
  border-radius: 99px;
  position: relative;
  transition: background 0.15s;
}
.thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  background: #fff;
  border-radius: 50%;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  transition: transform 0.15s cubic-bezier(0.4, 0, 0.2, 1);
}
.toggle input:checked ~ .track {
  background: #18181b;
}
.toggle input:checked ~ .track .thumb {
  transform: translateX(16px);
}

/* ── Transitions ─────────────────────────────── */
.fade-enter-active,
.fade-leave-active {
  transition:
    opacity 0.15s,
    transform 0.15s;
}
.fade-enter-from {
  opacity: 0;
  transform: translateY(5px);
}
.fade-leave-to {
  opacity: 0;
  transform: translateY(-5px);
}

/* ── Responsive ──────────────────────────────── */
@media (max-width: 800px) {
  .layout {
    flex-direction: column;
    padding: 1.5rem;
  }
  .sidebar {
    width: 100%;
    position: static;
    border-right: none;
    border-bottom: 1px solid #e4e4e7;
    padding-bottom: 1.5rem;
    margin-bottom: 1.5rem;
  }
  .content {
    padding-left: 0;
  }
  .stats-strip {
    flex-wrap: wrap;
  }
  .override-box {
    flex-direction: column;
    gap: 1rem;
  }
  .override-form {
    width: 100%;
  }
  .num-input {
    flex: 1;
  }
}
</style>
