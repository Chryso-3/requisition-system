<script setup>
import { ref, onMounted } from 'vue'
import { listRequisitionsSimple } from '@/services/requisitionService'
import { REQUISITION_STATUS } from '@/firebase/collections'

const requisitions = ref([])
const loading = ref(true)
const error = ref(null)
const filterStatus = ref('')

const statusLabel = {
  [REQUISITION_STATUS.DRAFT]: 'Draft',
  [REQUISITION_STATUS.PENDING_RECOMMENDATION]: 'Pending Recommendation',
  [REQUISITION_STATUS.PENDING_INVENTORY]: 'Pending Inventory',
  [REQUISITION_STATUS.PENDING_BUDGET]: 'Pending Budget',
  [REQUISITION_STATUS.PENDING_AUDIT]: 'Pending Audit',
  [REQUISITION_STATUS.PENDING_APPROVAL]: 'Pending Approval',
  [REQUISITION_STATUS.APPROVED]: 'Approved',
  [REQUISITION_STATUS.REJECTED]: 'Rejected'
}

async function load() {
  loading.value = true
  error.value = null
  try {
    const filters = filterStatus.value ? { status: filterStatus.value } : {}
    requisitions.value = await listRequisitionsSimple(filters)
  } catch (e) {
    error.value = e.message || 'Failed to load requisitions.'
  } finally {
    loading.value = false
  }
}

function formatDate(val) {
  if (!val) return '—'
  const d = val?.toDate ? val.toDate() : new Date(val)
  return d.toLocaleDateString()
}

onMounted(load)

defineExpose({ refresh: load })
</script>

<template>
  <div class="requisition-list">
    <div class="list-header">
      <h2>Requisitions</h2>
      <div class="filter">
        <label>Status</label>
        <select v-model="filterStatus" @change="load">
          <option value="">All</option>
          <option v-for="(label, key) in statusLabel" :key="key" :value="key">{{ label }}</option>
        </select>
      </div>
    </div>

    <div v-if="error" class="error">{{ error }}</div>
    <div v-else-if="loading" class="loading">Loading requisitions…</div>
    <div v-else-if="requisitions.length === 0" class="empty">No requisitions found.</div>

    <div v-else class="table-wrap">
      <table class="list-table">
        <thead>
          <tr>
            <th>RF Control No.</th>
            <th>Date</th>
            <th>Department</th>
            <th>Purpose</th>
            <th>Status</th>
            <th>Items</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in requisitions" :key="r.id" @click="$router.push(`/requisitions/${r.id}`)" class="row-clickable">
            <td>{{ r.rfControlNo || '—' }}</td>
            <td>{{ formatDate(r.date) }}</td>
            <td>{{ r.department || '—' }}</td>
            <td>{{ (r.purpose || '').slice(0, 40) }}{{ (r.purpose || '').length > 40 ? '…' : '' }}</td>
            <td>
              <span :class="['status-badge', r.status]">{{ statusLabel[r.status] || r.status }}</span>
            </td>
            <td>{{ (r.items || []).length }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.requisition-list {
  max-width: 1000px;
  margin: 0 auto;
  padding: 1.5rem;
}

.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1rem;
}

.list-header h2 { margin: 0; font-size: 1.25rem; }

.filter {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}
.filter label { font-size: 0.875rem; }
.filter select {
  padding: 0.35rem 0.75rem;
  border: 1px solid #ccc;
  border-radius: 6px;
}

.error {
  background: #fee;
  color: #c00;
  padding: 0.75rem;
  border-radius: 6px;
  margin-bottom: 1rem;
}

.loading, .empty {
  padding: 2rem;
  text-align: center;
  color: #6b7280;
}

.table-wrap { overflow-x: auto; }

.list-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}

.list-table th,
.list-table td { border: 1px solid #ddd; padding: 0.6rem; text-align: left; }
.list-table th { background: #f4f4f4; }

.row-clickable { cursor: pointer; }
.row-clickable:hover { background: #f9fafb; }

.status-badge {
  display: inline-block;
  padding: 0.2rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
}

.status-badge.draft { background: #e5e7eb; color: #374151; }
.status-badge.pending_recommendation,
.status-badge.pending_inventory,
.status-badge.pending_budget,
.status-badge.pending_audit,
.status-badge.pending_approval { background: #fef3c7; color: #92400e; }
.status-badge.approved { background: #d1fae5; color: #065f46; }
.status-badge.rejected { background: #fee2e2; color: #991b1b; }
</style>
