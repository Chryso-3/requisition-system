<script setup>
import { ref, onMounted } from 'vue'
import { getCounters, setCounter } from '@/services/adminService'
import { Hash, RotateCcw, AlertTriangle, Info, CheckCircle2 } from 'lucide-vue-next'

const counters = ref({
  rf: 0,
  canvass: 0,
  po: 0,
  year: new Date().getFullYear(),
})
const editValues = ref({
  rf: '',
  canvass: '',
  po: '',
})
const loading = ref(true)
const saving = ref(null)
const successMsg = ref('')

async function fetchCounters() {
  loading.value = true
  try {
    counters.value = await getCounters()
    // Sync edit values with current counters
    editValues.value = {
      rf: counters.value.rf.toString(),
      canvass: counters.value.canvass.toString(),
      po: counters.value.po.toString(),
    }
  } catch (err) {
    console.error('Error fetching counters:', err)
  } finally {
    loading.value = false
  }
}

async function handleUpdate(type) {
  const newValue = editValues.value[type]
  if (!newValue || isNaN(newValue) || parseInt(newValue) < 0) {
    alert('Please enter a valid non-negative number.')
    return
  }

  const label = type === 'rf' ? 'RF Control' : type === 'canvass' ? 'Canvass' : 'PO'
  const confirmed = confirm(
    `Are you sure you want to set the next ${label} number to ${parseInt(newValue) + 1}? (Current internal counter will be ${newValue})`,
  )

  if (!confirmed) return

  saving.value = type
  successMsg.value = ''
  try {
    await setCounter(type, newValue)
    counters.value[type] = parseInt(newValue)
    successMsg.value = `${label} counter updated successfully.`
    setTimeout(() => {
      successMsg.value = ''
    }, 3000)
  } catch (err) {
    console.error(`Error updating ${type} counter:`, err)
    alert('Failed to update counter.')
  } finally {
    saving.value = null
  }
}

onMounted(fetchCounters)
</script>

<template>
  <div class="admin-page">
    <header class="page-header">
      <div class="header-content">
        <h1 class="page-title">Control Number Manager</h1>
      </div>
      <div class="header-actions">
        <button @click="fetchCounters" class="btn-refresh" :disabled="loading">
          <RotateCcw :size="18" :class="{ spin: loading }" />
          Refresh
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
          <span class="elite-label">Last Used Number:</span>
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
          <span class="elite-label">Yearly Reset Counter ({{ counters.year }}):</span>
          <span class="elite-value">{{ String(counters.canvass).padStart(3, '0') }}</span>
        </div>
        <div class="elite-next-preview">
          Next expected:
          <strong
            >CO-{{ counters.year }}-{{ String(counters.canvass + 1).padStart(3, '0') }}</strong
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
          <span class="elite-label">Yearly Reset Counter ({{ counters.year }}):</span>
          <span class="elite-value">{{ String(counters.po).padStart(3, '0') }}</span>
        </div>
        <div class="elite-next-preview">
          Next expected:
          <strong>PO-{{ counters.year }}-{{ String(counters.po + 1).padStart(3, '0') }}</strong>
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
    </div>

    
  </div>
</template>

<style scoped>
.admin-page {
  padding: 0.5rem 2rem 2rem; /* Balanced horizontal padding */
  max-width: 1200px; /* Better breadth for Compact Elite */
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 1rem;
}

.page-title {
  font-size: 1.5rem;
  font-weight: 800;
  color: #1e293b;
  margin: 0;
  letter-spacing: -0.02em;
}

.page-subtitle {
  color: #64748b;
  margin: 0.25rem 0 0;
}

.btn-refresh {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.625rem 1rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  font-weight: 600;
  color: #475569;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-refresh:hover {
  background: #f8fafc;
  border-color: #cbd5e1;
}

.spin {
  animation: spin 1s linear infinite;
}
@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.alert {
  padding: 1rem;
  border-radius: 12px;
  margin-bottom: 1.5rem;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-weight: 600;
}

.success-alert {
  background: #f0fdf4;
  color: #16a34a;
  border: 1px solid #bbfcce;
}

.info-banner {
  background: #eff6ff;
  color: #1e40af;
  padding: 1.25rem;
  border-radius: 12px;
  border: 1px solid #bfdbfe;
  display: flex;
  gap: 1rem;
  margin-bottom: 1.5rem;
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
  gap: 1rem;
  margin-bottom: 1.5rem;
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
