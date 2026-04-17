<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import {
  addDepartment,
  updateDepartment,
} from '@/services/adminService'
import { useReferenceStore } from '@/stores/reference'
import {
  Building2,
  Plus,
  Search,
  CheckCircle2,
  XCircle,
  Loader2,
} from 'lucide-vue-next'

const activeTab = ref('departments')
const referenceStore = useReferenceStore()
const departments = computed(() => referenceStore.departments)
const loading = computed(() => referenceStore.loading)
const searchKey = ref('')
const isAdding = ref(false)
const editingId = ref(null)

const deptForm = ref({ name: '' })

const filteredDepartments = computed(() => {
  if (!searchKey.value) return departments.value
  const k = searchKey.value.toLowerCase()
  return departments.value.filter((d) => d.name.toLowerCase().includes(k))
})

async function fetchData() {
  await referenceStore.fetchDepartments()
}

async function handleAddDept() {
  const name = deptForm.value.name.trim()
  if (!name) return
  
  const tempId = referenceStore.optimisticallyAddDept(name)
  deptForm.value.name = ''
  isAdding.value = false
  
  try {
    await addDepartment(name)
    await referenceStore.fetchDepartments(true)
  } catch (err) {
    referenceStore.rollbackDept(tempId)
    alert('Error adding department: ' + err.message)
  }
}

function openAddModal() {
  editingId.value = null
  deptForm.value.name = ''
  isAdding.value = true
}

async function toggleDeptStatus(dept) {
  try {
    await updateDepartment(dept.id, { isActive: !dept.isActive })
    await referenceStore.fetchDepartments(true)
  } catch (err) {
    alert('Error updating status: ' + err.message)
  }
}

watch(searchKey, () => {
  // Reset pagination or search relevant state if needed
})

onMounted(() => {
  fetchData()
})
</script>

<template>
  <div class="admin-page jinja">
    <header class="page-header">
      <div class="header-left">
        <h1 class="page-title">Reference Data</h1>
        <p class="page-subtitle">Manage organization departments and units</p>
      </div>
      <div class="header-right">
        <div class="search-box">
          <Search :size="18" class="search-icon" />
          <input
            v-model="searchKey"
            type="text"
            placeholder="Search departments..."
            class="search-input"
          />
        </div>
        <button class="btn-primary glint" @click="openAddModal">
          <Plus :size="18" />
          <span>Add New</span>
        </button>
      </div>
    </header>

    <div class="tabs-container">
      <div class="tab-btn active">
        <Building2 :size="18" />
        <span>Departments</span>
        <span class="count-chip">{{ departments.length }}</span>
      </div>
    </div>

    <div class="main-content">
      <div v-if="loading" class="loading-state">
        <Loader2 class="spinner" :size="32" />
        <p>Syncing metadata...</p>
      </div>

      <template v-else>
        <!-- DEPARTMENTS VIEW -->
        <div class="grid-layout">
          <div v-for="dept in filteredDepartments" :key="dept.id" class="data-card">
            <div class="card-body">
              <div class="card-icon"><Building2 :size="24" /></div>
              <div class="card-info">
                <h3 class="card-name">{{ dept.name }}</h3>
                <span :class="['status-pill', dept.isActive ? 'active' : 'inactive']">
                  {{ dept.isActive ? 'Active' : 'Disabled' }}
                </span>
              </div>
            </div>
            <div class="card-actions">
              <button class="action-btn" @click="toggleDeptStatus(dept)">
                <XCircle v-if="dept.isActive" :size="16" />
                <CheckCircle2 v-else :size="16" />
                <span>{{ dept.isActive ? 'Disable' : 'Enable' }}</span>
              </button>
            </div>
          </div>
        </div>

        <!-- EMPTY STATE -->
        <div v-if="filteredDepartments.length === 0" class="empty-state">
          <Search :size="48" class="text-slate-300" />
          <h3>No records found</h3>
          <p>Try adjusting your search or add a new entry.</p>
        </div>
      </template>
    </div>

    <!-- ADD MODAL -->
    <Transition name="modal">
      <div v-if="isAdding" class="modal-overlay" @click.self="isAdding = false">
        <div class="modal-box glass-container">
          <div class="modal-header">
            <h3>{{ editingId ? 'Edit' : 'Add New' }} Department</h3>
            <button class="close-btn" @click="isAdding = false">✕</button>
          </div>
          <div class="modal-body">
            <div class="form-group">
              <label>Department Name</label>
              <input
                v-model="deptForm.name"
                placeholder="e.g. TECHNICAL SERVICES DEPARTMENT"
                class="premium-input"
                autofocus
                @keyup.enter="handleAddDept"
              />
              <button class="btn-primary w-full mt-4" @click="handleAddDept">
                {{ editingId ? 'Update' : 'Create' }} Department
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.jinja {
  --p-primary: #0ea5e9;
  --p-border: #e2e8f0;
  --p-text: #1e293b;
  --p-muted: #64748b;
}

.admin-page {
  padding: 1.5rem 2.5rem;
  flex: 1; min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: #f8fafc;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  margin-bottom: 2rem;
  flex-shrink: 0;
}

.page-title {
  font-size: 1.75rem;
  font-weight: 800;
  color: var(--p-text);
  margin: 0;
  letter-spacing: -0.025em;
}

.page-subtitle {
  color: var(--p-muted);
  margin: 0.25rem 0 0;
  font-size: 0.875rem;
}

.header-right {
  display: flex;
  gap: 1rem;
  align-items: center;
}

.search-box {
  position: relative;
  width: 280px;
}

.search-icon {
  position: absolute;
  left: 0.875rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--p-muted);
}

.search-input {
  width: 100%;
  padding: 0.625rem 1rem 0.625rem 2.5rem;
  background: white;
  border: 1px solid var(--p-border);
  border-radius: 10px;
  font-size: 0.875rem;
  transition: all 0.2s;
}

.search-input:focus {
  outline: none;
  border-color: var(--p-primary);
  box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.1);
}

.tabs-container {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1.5rem;
  border-bottom: 1px solid var(--p-border);
  padding-bottom: 0.5rem;
  flex-shrink: 0;
}

.tab-btn {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  padding: 0.625rem 1.25rem;
  border-radius: 8px;
  background: transparent;
  color: var(--p-muted);
  font-weight: 600;
}

.tab-btn.active {
  background: white;
  color: var(--p-primary);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.count-chip {
  font-size: 0.7rem;
  background: #f1f5f9;
  color: #64748b;
  padding: 0.1rem 0.4rem;
  border-radius: 999px;
}

.main-content {
  flex: 1;
  overflow-y: auto;
}

.grid-layout {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
  gap: 1rem;
}

.data-card {
  background: var(--p-card-bg);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: 12px;
  padding: 1.25rem;
  display: flex;
  flex-direction: column;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.03);
  transition: all 0.2s;
}

.data-card:hover {
  transform: translateY(-2px);
  background: white;
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.05);
}

.data-card.wide {
  grid-column: span 1;
}

.card-body {
  display: flex;
  gap: 1rem;
  margin-bottom: 1rem;
  position: relative;
}

.card-icon {
  width: 48px;
  height: 48px;
  background: white;
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--p-primary);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.02);
}

.card-info {
  flex: 1;
}

.card-name {
  margin: 0 0 0.25rem;
  font-size: 1rem;
  font-weight: 700;
  color: var(--p-text);
}

.card-desc {
  font-size: 0.8125rem;
  color: var(--p-muted);
  margin: 0;
}

.card-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  margin-top: 0.5rem;
}

.meta-item {
  font-size: 0.75rem;
  color: var(--p-muted);
  background: #f1f5f9;
  padding: 0.125rem 0.5rem;
  border-radius: 4px;
}

.status-pill {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0.125rem 0.5rem;
  border-radius: 999px;
}

.status-pill.active {
  background: #ecfdf5;
  color: #10b981;
}

.status-pill.inactive {
  background: #fef2f2;
  color: #ef4444;
}

.badge-new {
  font-size: 0.7rem;
  font-weight: 800;
  background: #fef9c3;
  color: #854d0e;
  padding: 0.2rem 0.6rem;
  border-radius: 6px;
  border: 1px solid #fde68a;
  box-shadow: 0 1px 3px rgba(0,0,0,0.1);
  animation: pulse-gold 2s infinite;
  text-transform: uppercase;
}

@keyframes pulse-gold {
  0% { box-shadow: 0 0 0 0 rgba(253, 230, 138, 0.7); }
  70% { box-shadow: 0 0 0 6px rgba(253, 230, 138, 0); }
  100% { box-shadow: 0 0 0 0 rgba(253, 230, 138, 0); }
}

.btn-legend-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  background: white;
  border: 1px solid #e2e8f0;
  padding: 0.625rem 1rem;
  border-radius: 12px;
  font-size: 0.875rem;
  font-weight: 700;
  color: #64748b;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-legend-toggle:hover,
.btn-legend-toggle.active {
  background: #f1f5f9;
  color: #0ea5e9;
  border-color: #0ea5e9;
  transform: translateY(-1px);
}

.registry-legend-popover {
  position: absolute;
  top: 90px; /* Elevated slightly */
  right: 1.5rem;
  width: 440px;
  background: #fff;
  border: 1px solid rgba(0,0,0,0.06);
  border-radius: 16px;
  padding: 1.5rem;
  box-shadow: 0 10px 30px rgba(0,0,0,0.1);
  z-index: 150;
  animation: slideInDown 0.3s ease;
}

.legend-popover-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.25rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid rgba(0,0,0,0.04);
}

.legend-header-main {
  display: flex;
  align-items: center;
  gap: 1rem;
}

.btn-close-legend {
  background: transparent;
  border: none;
  color: #94a3b8;
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
  display: flex;
  transition: all 0.2s;
}

.btn-close-legend:hover {
  background: #f1f5f9;
  color: #ef4444;
}

.legend-popover-title {
  font-family: 'Inter', sans-serif;
  font-size: 0.725rem;
  font-weight: 900;
  color: #1e293b;
  letter-spacing: 0.075em;
  margin: 0;
  white-space: nowrap;
  flex-shrink: 0;
}

.pending-popover-badge {
  background: #fef2f2;
  color: #ef4444;
  font-size: 0.625rem;
  font-weight: 800;
  padding: 0.2rem 0.625rem;
  border-radius: 99px;
  border: 1px solid #fee2e2;
  text-transform: uppercase;
  white-space: nowrap;
  letter-spacing: 0.025em;
}

.legend-popover-section {
  margin-bottom: 1.25rem;
}

.legend-popover-sub {
  font-size: 0.7rem;
  font-weight: 700;
  color: #94a3b8;
  text-transform: uppercase;
  letter-spacing: 0.025em;
  margin: 0 0 0.75rem 0;
}

.legend-popover-item {
  display: flex;
  gap: 0.875rem;
  margin-bottom: 1rem;
}

.popover-marker-wrap {
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.popover-item-info .popover-label {
  display: block;
  font-size: 0.75rem;
  font-weight: 700;
  color: #1e293b;
  margin-bottom: 0.15rem;
}

.popover-item-info .popover-desc {
  margin: 0;
  font-size: 0.7rem;
  color: #64748b;
  line-height: 1.4;
}

/* Animations */
.legend-fade-enter-active,
.legend-fade-leave-active {
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.legend-fade-enter-from,
.legend-fade-leave-to {
  opacity: 0;
  transform: translateY(-10px);
}

.name-with-badge {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.table-row-elite.is-pinned {
  background: #fffcf0;
}

.table-row-elite.is-pinned:hover {
  background: #fef9c3;
}

.icon-btn.mark-reviewed {
  color: #10b981;
}
.icon-btn.mark-reviewed:hover {
  background: #ecfdf5;
}

.card-actions {
  display: flex;
  justify-content: flex-end;
  border-top: 1px solid rgba(0, 0, 0, 0.05);
  padding-top: 0.75rem;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.8rem;
  border: none;
  background: transparent;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--p-muted);
  cursor: pointer;
  border-radius: 6px;
}

.action-btn:hover {
  background: #f1f5f9;
  color: var(--p-text);
}

/* Modals */
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  backdrop-filter: blur(4px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1.5rem;
}

.modal-box {
  max-width: 500px;
  width: 100%;
  background: white;
  border-radius: 1.25rem;
  padding: 2rem;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.15);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}

.modal-header h3 {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 800;
  color: var(--p-text);
}

.close-btn {
  background: #f1f5f9;
  border: none;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--p-muted);
}

.form-group {
  margin-bottom: 1.25rem;
}

.form-group label {
  display: block;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  color: var(--p-muted);
  margin-bottom: 0.5rem;
}

.premium-input {
  width: 100%;
  padding: 0.75rem 1rem;
  border: 1px solid var(--p-border);
  border-radius: 10px;
  font-size: 0.9375rem;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 1rem;
}

.span-2 { grid-column: span 2; }
.w-full { width: 100%; }
.mt-4 { margin-top: 1rem; }

.btn-primary {
  padding: 0.75rem 1.25rem;
  background: var(--p-primary);
  color: white;
  border: none;
  border-radius: 10px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
}

.loading-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 4rem;
  color: var(--p-muted);
}

.spinner {
  animation: spin 1s linear infinite;
  margin-bottom: 1rem;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.empty-state {
  padding: 4rem;
  text-align: center;
  color: var(--p-muted);
}

.empty-state h3 {
  margin: 1.5rem 0 0.5rem;
  color: var(--p-text);
}

.glass-select {
  padding: 0.625rem 2.5rem 0.625rem 1rem;
  background: white url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") no-repeat right 0.75rem center;
  border: 1px solid var(--p-border);
  border-radius: 10px;
  font-size: 0.875rem;
  color: var(--p-text);
  cursor: pointer;
  appearance: none;
  transition: all 0.2s;
  min-width: 160px;
}

.glass-select:focus {
  outline: none;
  border-color: var(--p-primary);
  box-shadow: 0 0 0 3px rgba(14, 165, 233, 0.1);
}

.table-section {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: white;
  border-radius: 16px;
  border: 1px solid var(--p-border);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  overflow: hidden;
}

.table-container {
  flex: 1;
  min-height: 0;
  overflow: auto;
  position: relative;
}

.elite-table {
  width: 100%;
  border-collapse: collapse;
  text-align: left;
  font-size: 0.875rem;
}

.elite-table th {
  position: sticky;
  top: 0;
  background: #f8fafc;
  padding: 1rem 1.25rem;
  font-weight: 700;
  color: var(--p-muted);
  text-transform: uppercase;
  font-size: 0.75rem;
  letter-spacing: 0.05em;
  border-bottom: 2px solid var(--p-border);
  z-index: 10;
}

.table-row-elite {
  border-bottom: 1px solid #f1f5f9;
  transition: background 0.2s;
}

.table-row-elite:hover {
  background: #f8fafc;
}

.table-row-elite td {
  padding: 1rem 1.25rem;
  vertical-align: middle;
  color: var(--p-text);
}

.font-bold { font-weight: 700; }
.text-right { text-align: right; }
.text-muted { color: var(--p-muted); font-size: 0.8rem; }

.meta-stack {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.meta-tag {
  font-size: 0.75rem;
  color: var(--p-primary);
  font-weight: 500;
}

.compact-addr p {
  margin: 0;
  font-size: 0.8125rem;
  line-height: 1.4;
  max-width: 250px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.row-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.icon-btn {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
  background: #f1f5f9;
  color: var(--p-muted);
}

.icon-btn:hover {
  background: #e2e8f0;
  color: var(--p-text);
}

.icon-btn.edit:hover {
  background: #eff6ff;
  color: var(--p-primary);
}

.icon-btn.status:hover {
  background: #fef2f2;
  color: #ef4444;
}

/* Pagination container spacing */
:deep(.pagination-container) {
  padding: 1rem 1.25rem;
  border-top: 1px solid var(--p-border);
  background: #f8fafc;
  border-radius: 0 0 16px 16px;
}

.col-name { width: 25%; }
.col-contact { width: 15%; }
.col-info { width: 20%; }
.col-addr { width: 25%; }
.col-stat { width: 10%; }

/* Import Excel Button */
.btn-import {
  padding: 0.625rem 1.125rem;
  background: #f0fdf4;
  color: #15803d;
  border: 1px solid #bbf7d0;
  border-radius: 10px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.875rem;
  transition: all 0.2s;
}

.btn-import:hover {
  background: #dcfce7;
  border-color: #86efac;
}

/* Import Modal */
.import-modal {
  max-width: 900px !important;
  width: 95vw !important;
}

.import-subtitle {
  margin: 0.25rem 0 0;
  font-size: 0.8rem;
  color: var(--p-muted);
}

.import-table-wrap {
  max-height: 400px;
  overflow: auto;
  border: 1px solid var(--p-border);
  border-radius: 10px;
  margin-bottom: 1.5rem;
}

.import-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.import-table th {
  position: sticky;
  top: 0;
  background: #f8fafc;
  padding: 0.625rem 0.875rem;
  font-weight: 700;
  color: var(--p-muted);
  text-transform: uppercase;
  font-size: 0.7rem;
  letter-spacing: 0.04em;
  border-bottom: 1px solid var(--p-border);
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.import-table td {
  padding: 0.625rem 0.875rem;
  border-bottom: 1px solid #f1f5f9;
  color: var(--p-text);
}

.cell-clip {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.import-table tr:last-child td {
  border-bottom: none;
}

.row-num {
  color: var(--p-muted);
  font-size: 0.75rem;
  text-align: center;
}

.fw-bold { font-weight: 700; }

.row-warning td {
  background: #fef9c3;
  color: #92400e;
}

.import-error {
  background: #fef2f2;
  color: #991b1b;
  border: 1px solid #fecaca;
  border-radius: 8px;
  padding: 0.75rem 1rem;
  font-size: 0.875rem;
  margin-bottom: 1rem;
}

.import-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
}

.btn-cancel {
  padding: 0.75rem 1.25rem;
  background: #f1f5f9;
  color: var(--p-text);
  border: none;
  border-radius: 10px;
  font-weight: 600;
  cursor: pointer;
  font-size: 0.9375rem;
  transition: background 0.2s;
}

.btn-cancel:hover {
  background: #e2e8f0;
}
</style>
