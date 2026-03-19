<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { getCounters, setCounter } from '@/services/adminService'
import { Hash, RotateCcw, AlertTriangle, Info, CheckCircle2, Calendar, ChevronLeft, ChevronRight } from 'lucide-vue-next'

const counters = ref({
  rf: 0,
  canvass: 0,
  po: 0,
  pbac: 0,
  year: new Date().getFullYear(),
})
const editValues = ref({
  rf: '',
  canvass: '',
  po: '',
  pbac: '',
})
const loading = ref(true)
const saving = ref(null)
const successMsg = ref('')

const selectedYear = ref(new Date().getFullYear())
const showYearPicker = ref(false)
const yearSelectorRef = ref(null)

const yearOptions = computed(() => {
  const current = new Date().getFullYear()
  const years = []
  // Show a wider range: 5 years back and 5 years forward from current selected
  for (let y = selectedYear.value - 6; y <= selectedYear.value + 5; y++) {
    years.push(y)
  }
  return years
})

function selectYear(y) {
  selectedYear.value = y
  showYearPicker.value = false
}

function adjustYear(delta) {
  selectedYear.value += delta
}

async function fetchCounters() {
  loading.value = true
  try {
    counters.value = await getCounters(selectedYear.value)
    // Sync edit values with current counters
    if (counters.value) {
      editValues.value = {
        rf: (counters.value.rf || 0).toString(),
        canvass: (counters.value.canvass || 0).toString(),
        po: (counters.value.po || 0).toString(),
        pbac: (counters.value.pbac || 0).toString(),
      }
    }
  } catch (error) {
    console.error('Error fetching counters:', error)
  } finally {
    loading.value = false
  }
}

async function handleUpdate(type) {
  const value = editValues.value[type]
  if (!value && value !== 0) return

  saving.value = type
  successMsg.value = ''
  try {
    await setCounter(type, value, selectedYear.value)
    await fetchCounters()
    successMsg.value = `${type.toUpperCase()} counter updated successfully!`
    setTimeout(() => {
      successMsg.value = ''
    }, 3000)
  } catch (error) {
    console.error('Error updating counter:', error)
    alert('Failed to update counter.')
  } finally {
    saving.value = null
  }
}

watch(selectedYear, () => {
  fetchCounters()
})

function handleClickOutside(event) {
  if (yearSelectorRef.value && !yearSelectorRef.value.contains(event.target)) {
    showYearPicker.value = false
  }
}

onMounted(() => {
  fetchCounters()
  document.addEventListener('mousedown', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('mousedown', handleClickOutside)
})
</script>

<template>
  <div class="admin-page">
    <header class="page-header">
      <div class="header-content">
        <h1 class="page-title">Control Number Manager</h1>
      </div>
      <div class="header-right">
        <div class="year-selector-elite" ref="yearSelectorRef">
          <button @click="adjustYear(-1)" class="year-nav-btn" title="Previous Year">
            <ChevronLeft :size="16" />
          </button>
          <button @click="showYearPicker = !showYearPicker" class="year-display-btn">
            <Calendar :size="18" />
            <span>{{ selectedYear }}</span>
          </button>
          <button @click="adjustYear(1)" class="year-nav-btn" title="Next Year">
            <ChevronRight :size="16" />
          </button>
          
          <transition name="fade-in-up">
            <div v-if="showYearPicker" class="year-dropdown-elite glass-card">
              <div class="year-grid">
                <button 
                  v-for="y in yearOptions" 
                   :key="y" 
                  @click="selectYear(y)"
                  class="year-option"
                  :class="{ active: y === selectedYear }"
                >
                  {{ y }}
                </button>
              </div>
            </div>
          </transition>
        </div>

        <button @click="fetchCounters" class="btn-refresh" :disabled="loading">
          <RotateCcw :size="18" :class="{ spin: loading }" />
          <span>Refresh</span>
        </button>
      </div>
    </header>

    <div v-if="successMsg" class="alert success-alert">
      <CheckCircle2 :size="18" />
      {{ successMsg }}
    </div>

    <div class="info-banner">
      <Info :size="20" />
      <div class="info-content">
        <strong>How numbering works:</strong>
        <p>
          The system uses atomic counters to generate sequential numbers. Overriding a counter sets
          the "last used number". The next document created will use the next sequential number.
        </p>
      </div>
    </div>

    <div v-if="loading && !counters.rf" class="loading-state">
      <div class="glass-loader"></div>
      <p>Loading current sequences...</p>
    </div>

    <div v-else class="counter-grid">
      <!-- RF Counter -->
      <div class="glass-card elite-card animate-staggered" style="--order: 0">
        <div class="card-header">
          <div class="icon-orb rf-orb"><Hash :size="20" /></div>
          <h3 class="elite-h3">RF Control No.</h3>
        </div>
        <div class="current-value">
          <span class="elite-label">Yearly Reset Counter ({{ selectedYear }}):</span>
          <span class="elite-value">{{ String(counters.rf).padStart(6, '0') }}</span>
        </div>
        <div class="elite-next-preview">
          Next expected: <strong>{{ String(counters.rf + 1).padStart(6, '0') }}</strong>
        </div>
        <div class="card-footer-elite">
          <div class="elite-input-group">
            <input
              v-model="editValues.rf"
              type="number"
              placeholder="Set last no."
              class="elite-input"
            />
            <button
              @click="handleUpdate('rf')"
              class="btn-elite-update"
              :disabled="saving === 'rf'"
            >
              {{ saving === 'rf' ? '...' : 'Override' }}
            </button>
          </div>
        </div>
      </div>

      <!-- Canvass Counter -->
      <div class="glass-card elite-card animate-staggered" style="--order: 1">
        <div class="card-header">
          <div class="icon-orb canvass-orb"><Hash :size="20" /></div>
          <h3 class="elite-h3">Canvass No.</h3>
        </div>
        <div class="current-value">
          <span class="elite-label">Yearly Reset Counter ({{ selectedYear }}):</span>
          <span class="elite-value">{{ String(counters.canvass).padStart(3, '0') }}</span>
        </div>
        <div class="elite-next-preview">
          Next expected:
          <strong
            >CO-{{ selectedYear }}-{{ String(counters.canvass + 1).padStart(3, '0') }}</strong
          >
        </div>
        <div class="card-footer-elite">
          <div class="elite-input-group">
            <input
              v-model="editValues.canvass"
              type="number"
              placeholder="Set last no."
              class="elite-input"
            />
            <button
              @click="handleUpdate('canvass')"
              class="btn-elite-update"
              :disabled="saving === 'canvass'"
            >
              {{ saving === 'canvass' ? '...' : 'Override' }}
            </button>
          </div>
        </div>
      </div>

      <!-- PO Counter -->
      <div class="glass-card elite-card animate-staggered" style="--order: 2">
        <div class="card-header">
          <div class="icon-orb po-orb"><Hash :size="20" /></div>
          <h3 class="elite-h3">Purchase Order No.</h3>
        </div>
        <div class="current-value">
          <span class="elite-label">Yearly Reset Counter ({{ selectedYear }}):</span>
          <span class="elite-value">{{ String(counters.po).padStart(3, '0') }}</span>
        </div>
        <div class="elite-next-preview">
          Next expected:
          <strong>PO-{{ selectedYear }}-{{ String(counters.po + 1).padStart(3, '0') }}</strong>
        </div>
        <div class="card-footer-elite">
          <div class="elite-input-group">
            <input
              v-model="editValues.po"
              type="number"
              placeholder="Set last no."
              class="elite-input"
            />
            <button
              @click="handleUpdate('po')"
              class="btn-elite-update"
              :disabled="saving === 'po'"
            >
              {{ saving === 'po' ? '...' : 'Override' }}
            </button>
          </div>
        </div>
      </div>

      <!-- PBAC Counter -->
      <div class="glass-card elite-card animate-staggered" style="--order: 3">
        <div class="card-header">
          <div class="icon-orb pbac-orb"><Hash :size="20" /></div>
          <h3 class="elite-h3">PBAC Form 01 Serial</h3>
        </div>
        <div class="current-value">
          <span class="elite-label">Yearly Reset Counter ({{ selectedYear }}):</span>
          <span class="elite-value">{{ String(counters.pbac).padStart(4, '0') }}</span>
        </div>
        <div class="elite-next-preview">
          Next expected:
          <strong
            >PBAC-{{ String(new Date().getMonth() + 1).padStart(2, '0') }}-{{ selectedYear }}-{{
              String(counters.pbac + 1).padStart(4, '0')
            }}</strong
          >
        </div>
        <div class="card-footer-elite">
          <div class="elite-input-group">
            <input
              v-model="editValues.pbac"
              type="number"
              placeholder="Set last no."
              class="elite-input"
            />
            <button
              @click="handleUpdate('pbac')"
              class="btn-elite-update"
              :disabled="saving === 'pbac'"
            >
              {{ saving === 'pbac' ? '...' : 'Override' }}
            </button>
          </div>
        </div>
      </div>
    </div>

    
  </div>
</template>

<style scoped>
.admin-page {
  padding: 0 2rem 5rem; /* Removed top padding to allow header to sit flush */
  max-width: 1200px;
  margin: 0 auto;
  min-height: 100%;
}

.page-header {
  position: sticky;
  top: 0;
  background: #f1f5f9; /* Match main layout background */
  padding: 1rem 0;
  margin: 0;
  z-index: 100;
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem 0;
  border-bottom: 1px solid rgba(0, 0, 0, 0.05);
}

.page-title {
  font-size: 1.75rem;
  font-weight: 900;
  color: #0f172a;
  margin: 0;
  letter-spacing: -0.03em;
}

.btn-refresh {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.6rem;
  padding: 0.75rem 1.25rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  font-weight: 700;
  color: #475569;
  cursor: pointer;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
  box-shadow: 0 1px 2px rgba(0,0,0,0.05);
  height: 46px;
}

.btn-refresh:hover:not(:disabled) {
  background: #f8fafc;
  border-color: #cbd5e1;
  color: #0f172a;
  transform: translateY(-1px);
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}

.btn-refresh:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.spin {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.info-banner {
  position: sticky;
  top: 4rem; /* Offset for sticky header */
  background: #eff6ff;
  color: #1e40af;
  padding: 1.25rem;
  border-radius: 12px;
  border: 1px solid #bfdbfe;
  display: flex;
  gap: 1rem;
  margin-bottom: 2rem;
  z-index: 90;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05); /* Subtle shadow when floating */
}

.info-content strong {
  display: block;
  margin-bottom: 0.25rem;
}
.info-content p {
  margin: 0;
  font-size: 0.9rem;
  opacity: 0.9;
}

.counter-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 1.5rem; /* Increased for better separation */
  margin-bottom: 2.5rem; /* Increased bottom spacing */
}

.elite-card {
  background: rgba(255, 255, 255, 0.4);
  backdrop-filter: blur(25px) saturate(180%);
  -webkit-backdrop-filter: blur(25px) saturate(180%);
  border-radius: 24px;
  border: 1px solid rgba(255, 255, 255, 0.4);
  padding: 1.25rem;
  box-shadow:
    0 4px 20px rgba(0, 0, 0, 0.03),
    inset 0 0 0 1px rgba(255, 255, 255, 0.2);
  display: flex;
  flex-direction: column;
  transition: all 0.4s cubic-bezier(0.16, 1, 0.3, 1);
}

.elite-card:hover {
  transform: translateY(-8px) scale(1.02);
  background: rgba(255, 255, 255, 0.6);
  border-color: rgba(14, 165, 233, 0.3);
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.08);
}

.card-header {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1.25rem;
}

.elite-h3 {
  margin: 0;
  font-size: 0.95rem;
  color: #0f172a;
  font-weight: 800;
  letter-spacing: -0.01em;
}

.icon-orb {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  box-shadow: 0 8px 16px -4px rgba(0, 0, 0, 0.1);
}

.rf-orb {
  background: linear-gradient(135deg, #0ea5e9, #0284c7);
}
.canvass-orb {
  background: linear-gradient(135deg, #f59e0b, #d97706);
}
.po-orb {
  background: linear-gradient(135deg, #ef4444, #b91c1c);
}
.pbac-orb {
  background: linear-gradient(135deg, #8b5cf6, #6d28d9);
}

.elite-label {
  font-size: 0.8rem;
  font-weight: 700;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  display: block;
  margin-bottom: 0.5rem;
}

.elite-value {
  font-size: 1.75rem;
  font-weight: 900;
  color: #0f172a;
  font-family: 'JetBrains Mono', monospace;
  line-height: 1;
  letter-spacing: -0.05em;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.year-selector-elite {
  position: relative;
  display: flex;
  align-items: center;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  box-shadow: 0 1px 2px rgba(0,0,0,0.05);
  height: 46px;
  padding: 0 0.25rem;
}

.year-selector-elite:focus-within {
  border-color: #0ea5e9;
  ring: 2px solid rgba(14, 165, 233, 0.1);
}

.year-display-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0 1rem;
  border: none;
  background: transparent;
  font-weight: 800;
  color: #1e293b;
  cursor: pointer;
  font-size: 1.05rem;
  transition: all 0.2s;
  height: 100%;
}

.year-display-btn:hover {
  background: #f8fafc;
}

.year-nav-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0.5rem;
  border: none;
  background: transparent;
  color: #64748b;
  cursor: pointer;
  transition: all 0.2s;
}

.year-nav-btn:hover {
  background: #f1f5f9;
  color: #0ea5e9;
}

.year-dropdown-elite {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 0.75rem;
  width: 240px;
  max-height: 200px;
  overflow-y: auto;
  z-index: 1000;
  padding: 0.75rem;
  border: 1px solid rgba(255, 255, 255, 0.4);
}

.year-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
}

.year-option {
  padding: 0.5rem;
  border-radius: 8px;
  border: 1px solid transparent;
  background: transparent;
  font-weight: 700;
  color: #475569;
  cursor: pointer;
  transition: all 0.2s;
  text-align: center;
}

.year-option:hover {
  background: #f1f5f9;
  color: #0ea5e9;
}

.year-option.active {
  background: #0ea5e9;
  color: white;
}

/* Scrollbar for year dropdown */
.year-dropdown-elite::-webkit-scrollbar {
  width: 4px;
}
.year-dropdown-elite::-webkit-scrollbar-thumb {
  background: #cbd5e1;
  border-radius: 10px;
}

.fade-in-up-enter-active, .fade-in-up-leave-active {
  transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
.fade-in-up-enter-from, .fade-in-up-leave-to {
  opacity: 0;
  transform: translateY(10px);
}

.elite-next-preview {
  font-size: 0.8rem;
  color: #475569;
  padding: 0.5rem 0.75rem;
  background: rgba(0, 0, 0, 0.03);
  border-radius: 8px;
  margin: 0.75rem 0 1.5rem;
  border: 1px solid rgba(0, 0, 0, 0.02);
}

.card-footer-elite {
  margin-top: auto;
}

.elite-input-group {
  display: flex;
  gap: 0.5rem;
  flex-wrap: nowrap;
}

.elite-input {
  flex: 1;
  padding: 0.5rem 0.75rem;
  background: white;
  border: 1px solid rgba(226, 232, 240, 0.8);
  border-radius: 8px;
  font-size: 0.95rem;
  font-weight: 600;
  transition: all 0.2s;
}

.elite-input:focus {
  outline: none;
  border-color: #0ea5e9;
  box-shadow: 0 0 0 4px rgba(14, 165, 233, 0.1);
}

.btn-elite-update {
  padding: 0.5rem 1rem;
  background: #0f172a;
  color: white;
  border: none;
  border-radius: 8px;
  font-weight: 700;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-elite-update:hover {
  background: #1e293b;
  transform: translateY(-1px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.btn-elite-update:active {
  transform: translateY(0);
}

.warning-box {
  background: rgba(255, 247, 237, 0.6);
  backdrop-filter: blur(10px);
  color: #9a3412;
  padding: 1.5rem;
  border-radius: 16px;
  border: 1px solid rgba(255, 237, 213, 0.8);
  display: flex;
  gap: 1.25rem;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 8rem 0;
  color: #64748b;
}

.glass-loader {
  width: 40px;
  height: 40px;
  border: 4px solid rgba(14, 165, 233, 0.1);
  border-top-color: #0f172a;
  border-radius: 50%;
  animation: spin 1s linear infinite;
  margin-bottom: 1.5rem;
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
</style>
