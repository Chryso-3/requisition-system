<script setup>
import { ref, onMounted, computed, watch } from 'vue'
import * as XLSX from 'xlsx'
import {
  getDepartments,
  addDepartment,
  updateDepartment,
  getSuppliers,
  addSupplier,
  updateSupplier,
} from '@/services/adminService'
import PaginationComponent from '@/components/PaginationComponent.vue'
import {
  Building2,
  Truck,
  Plus,
  Search,
  CheckCircle2,
  XCircle,
  Loader2,
  Trash2,
  Check,
  Edit2,
  Upload,
} from 'lucide-vue-next'

const activeTab = ref('departments') // 'departments' or 'suppliers'
const departments = ref([])
const suppliers = ref([])
const loading = ref(true)
const searchKey = ref('')
const isAdding = ref(false)
const editingId = ref(null)
const statusFilter = ref('all')

// Pagination
const currentPage = ref(1)
const pageSize = ref(10)

// Excel import state
const fileInputRef = ref(null)
const importPreview = ref([]) // rows parsed from xlsx
const showImportModal = ref(false)
const importLoading = ref(false)
const importError = ref('')

// Forms
const deptForm = ref({ name: '' })
const supplierForm = ref({
  name: '',
  contactPerson: '',
  email: '',
  phone: '',
  address1: '',
  address2: '',
})

const filteredDepartments = computed(() => {
  if (!searchKey.value) return departments.value
  const k = searchKey.value.toLowerCase()
  return departments.value.filter((d) => d.name.toLowerCase().includes(k))
})

const filteredSuppliers = computed(() => {
  let list = suppliers.value
  
  if (statusFilter.value !== 'all') {
    const isActive = statusFilter.value === 'active'
    list = list.filter(s => !!s.isActive === isActive)
  }

  if (searchKey.value) {
    const k = searchKey.value.toLowerCase()
    list = list.filter(
      (s) =>
        s.name.toLowerCase().includes(k) ||
        (s.contactPerson || '').toLowerCase().includes(k) ||
        (s.email || '').toLowerCase().includes(k) ||
        (s.address1 || '').toLowerCase().includes(k) ||
        (s.address2 || '').toLowerCase().includes(k),
    )
  }
  return list
})

const totalPages = computed(() => Math.ceil(filteredSuppliers.value.length / pageSize.value) || 1)
const paginatedSuppliers = computed(() => {
  const start = (currentPage.value - 1) * pageSize.value
  return filteredSuppliers.value.slice(start, start + pageSize.value)
})

async function fetchData() {
  loading.value = true
  try {
    const [d, s] = await Promise.all([getDepartments(), getSuppliers()])
    departments.value = d
    suppliers.value = s
  } catch (err) {
    console.error('Failed to fetch reference data:', err)
  } finally {
    loading.value = false
  }
}

async function handleAddDept() {
  if (!deptForm.value.name.trim()) return
  loading.value = true
  try {
    await addDepartment(deptForm.value.name.trim())
    deptForm.value.name = ''
    isAdding.value = false
    await fetchData()
  } catch (err) {
    alert('Error adding department: ' + err.message)
  } finally {
    loading.value = false
  }
}

async function handleAddSupplier() {
  if (!supplierForm.value.name.trim()) return
  loading.value = true
  try {
    if (editingId.value) {
      await updateSupplier(editingId.value, { ...supplierForm.value })
    } else {
      await addSupplier({ ...supplierForm.value })
    }
    resetSupplierForm()
    isAdding.value = false
    await fetchData()
  } catch (err) {
    alert('Error saving supplier: ' + err.message)
  } finally {
    loading.value = false
  }
}

function resetSupplierForm() {
  editingId.value = null
  supplierForm.value = {
    name: '',
    contactPerson: '',
    email: '',
    phone: '',
    address1: '',
    address2: '',
  }
}

function openAddModal() {
  resetSupplierForm()
  isAdding.value = true
}

function openEditSupplier(s) {
  editingId.value = s.id
  supplierForm.value = {
    name: s.name || '',
    contactPerson: s.contactPerson || '',
    email: s.email || '',
    phone: s.phone || '',
    address1: s.address1 || '',
    address2: s.address2 || '',
  }
  isAdding.value = true
}

function handlePageChange(p) {
  currentPage.value = p
}

function triggerExcelImport() {
  importError.value = ''
  fileInputRef.value?.click()
}

function onFileSelected(event) {
  const file = event.target.files?.[0]
  if (!file) return

  const reader = new FileReader()
  reader.onload = (e) => {
    try {
      importError.value = ''
      const data = new Uint8Array(e.target.result)
      const workbook = XLSX.read(data, { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })

      // Normalize column names (case & whitespace insensitive)
      const mappedRows = rows.map((row) => {
        const lower = Object.fromEntries(
          Object.entries(row).map(([k, v]) => [(k || '').trim().toLowerCase().replace(/\s+/g, ''), String(v || '').trim()])
        )
        // Excel layout from before: 'Nome' = business/company name, 'Supplier name' = contact person
        // Supported generic fallbacks for other Excel formats
        return {
          name: lower['nome'] || lower['businessname'] || lower['company'] || lower['companyname'] || lower['name'] || lower['supplier'] || lower['vendor'] || '',
          contactPerson: lower['suppliername'] || lower['contactperson'] || lower['contactname'] || lower['contact'] || lower['person'] || lower['representative'] || '',
          phone: lower['phone'] || lower['phonenumber'] || lower['mobile'] || lower['number'] || lower['contactnumber'] || '',
          email: lower['email'] || lower['emailaddress'] || '',
          address1: lower['address1'] || lower['addressline1'] || lower['address'] || lower['street'] || '',
          address2: lower['address2'] || lower['addressline2'] || lower['city'] || lower['province'] || '',
        }
      })
      
      // Only keep rows that have at least some data
      importPreview.value = mappedRows.filter(r => r.name || r.contactPerson || r.email || r.phone || r.address1)

      if (importPreview.value.length === 0) {
        importError.value = 'No valid data found. Please ensure your Excel file has proper column headers (e.g. "Name", "Company", "Supplier", "Contact", "Phone").'
      }
      showImportModal.value = true
    } catch (err) {
      importError.value = 'Failed to read file: ' + err.message
      showImportModal.value = true
    } finally {
      // Reset file input so same file can be selected again
      event.target.value = ''
    }
  }
  reader.readAsArrayBuffer(file)
}

async function confirmImport() {
  importLoading.value = true
  importError.value = ''
  let successCount = 0
  let failCount = 0
  try {
    for (const row of importPreview.value) {
      try {
        await addSupplier({ ...row })
        successCount++
      } catch {
        failCount++
      }
    }
    showImportModal.value = false
    importPreview.value = []
    await fetchData()
    if (failCount > 0) {
      alert(`Import done: ${successCount} added, ${failCount} failed.`)
    }
  } catch (err) {
    importError.value = 'Import failed: ' + err.message
  } finally {
    importLoading.value = false
  }
}

async function toggleDeptStatus(dept) {
  try {
    await updateDepartment(dept.id, { isActive: !dept.isActive })
    dept.isActive = !dept.isActive
  } catch (err) {
    alert('Error updating status: ' + err.message)
  }
}

async function toggleSupplierStatus(supplier) {
  try {
    await updateSupplier(supplier.id, { isActive: !supplier.isActive })
    supplier.isActive = !supplier.isActive
  } catch (err) {
    alert('Error updating status: ' + err.message)
  }
}

watch([searchKey, statusFilter, activeTab], () => {
  currentPage.value = 1
})

onMounted(fetchData)
</script>

<template>
  <div class="admin-page jinja">
    <header class="page-header">
      <div class="header-left">
        <h1 class="page-title">Reference Data</h1>
      </div>
      <div class="header-right">
        <div class="search-box">
          <Search :size="18" class="search-icon" />
          <input
            v-model="searchKey"
            type="text"
            :placeholder="`Search ${activeTab}...`"
            class="search-input"
          />
        </div>
        <div v-if="activeTab === 'suppliers'" class="filter-box">
          <select v-model="statusFilter" class="glass-select">
            <option value="all">All Status</option>
            <option value="active">Active Only</option>
            <option value="inactive">Disabled Only</option>
          </select>
        </div>
        <!-- Hidden file input for xlsx -->
        <input
          ref="fileInputRef"
          type="file"
          accept=".xlsx,.xls,.csv"
          style="display: none"
          @change="onFileSelected"
        />
        <button
          v-if="activeTab === 'suppliers'"
          class="btn-import glint"
          @click="triggerExcelImport"
        >
          <Upload :size="18" />
          <span>Import Excel</span>
        </button>
        <button class="btn-primary glint" @click="openAddModal">
          <Plus :size="18" />
          <span>Add New</span>
        </button>
      </div>
    </header>

    <div class="tabs-container">
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'departments' }"
        @click="activeTab = 'departments'"
      >
        <Building2 :size="18" />
        <span>Departments</span>
        <span class="count-chip">{{ departments.length }}</span>
      </button>
      <button
        class="tab-btn"
        :class="{ active: activeTab === 'suppliers' }"
        @click="activeTab = 'suppliers'"
      >
        <Truck :size="18" />
        <span>Suppliers</span>
        <span class="count-chip">{{ suppliers.length }}</span>
      </button>
    </div>

    <div class="main-content">
      <div v-if="loading" class="loading-state">
        <Loader2 class="spinner" :size="32" />
        <p>Syncing metadata...</p>
      </div>

      <template v-else>
        <!-- DEPARTMENTS VIEW -->
        <div v-if="activeTab === 'departments'" class="grid-layout">
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

        <!-- SUPPLIERS VIEW (Elite Table) -->
        <div v-if="activeTab === 'suppliers'" class="table-section">
          <div class="table-container custom-scrollbar">
            <table class="elite-table">
              <thead>
                <tr>
                  <th class="col-name">Supplier Name</th>
                  <th class="col-contact">Contact Person</th>
                  <th class="col-info">Email & Phone</th>
                  <th class="col-addr">Address</th>
                  <th class="col-stat">Status</th>
                  <th class="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="s in paginatedSuppliers" :key="s.id" class="table-row-elite">
                  <td class="col-name font-bold">{{ s.name }}</td>
                  <td class="col-contact">{{ s.contactPerson || '—' }}</td>
                  <td class="col-info">
                    <div class="meta-stack">
                      <span v-if="s.email" class="meta-tag">{{ s.email }}</span>
                      <span v-if="s.phone" class="meta-tag">{{ s.phone }}</span>
                    </div>
                  </td>
                  <td class="col-addr">
                    <div class="compact-addr" :title="`${s.address1 || ''} ${s.address2 || ''}`">
                      <p v-if="s.address1">{{ s.address1 }}</p>
                      <p v-if="s.address2" class="text-muted">{{ s.address2 }}</p>
                      <span v-if="!s.address1 && !s.address2">—</span>
                    </div>
                  </td>
                  <td class="col-stat">
                    <span :class="['status-pill', s.isActive ? 'active' : 'inactive']">
                      {{ s.isActive ? 'Active' : 'Disabled' }}
                    </span>
                  </td>
                  <td class="text-right">
                    <div class="row-actions">
                      <button class="icon-btn edit" title="Edit" @click="openEditSupplier(s)">
                        <Edit2 :size="16" />
                      </button>
                      <button
                        class="icon-btn status"
                        :title="s.isActive ? 'Disable' : 'Enable'"
                        @click="toggleSupplierStatus(s)"
                      >
                        <XCircle v-if="s.isActive" :size="16" />
                        <CheckCircle2 v-else :size="16" />
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          
          <PaginationComponent
            :current-page="currentPage"
            :total-pages="totalPages"
            :page-size="pageSize"
            :total-items="filteredSuppliers.length"
            :loading="loading"
            @page-change="handlePageChange"
          />
        </div>

        <!-- EMPTY STATE -->
        <div v-if="(activeTab === 'departments' && filteredDepartments.length === 0) || (activeTab === 'suppliers' && filteredSuppliers.length === 0)" class="empty-state">
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
            <h3>{{ editingId ? 'Edit' : 'Add New' }} {{ activeTab === 'departments' ? 'Department' : 'Supplier' }}</h3>
            <button class="close-btn" @click="isAdding = false">✕</button>
          </div>
          <div class="modal-body">
            <!-- Dept form -->
            <div v-if="activeTab === 'departments'" class="form-group">
              <label>Department Name</label>
              <input
                v-model="deptForm.name"
                placeholder="e.g. TECHNICAL SERVICES DEPARTMENT"
                class="premium-input"
                autofocus
              />
              <button class="btn-primary w-full mt-4" @click="handleAddDept">
                {{ editingId ? 'Update' : 'Create' }} Department
              </button>
            </div>

            <!-- Supplier form -->
            <div v-if="activeTab === 'suppliers'" class="form-grid">
              <div class="form-group span-2">
                <label>Supplier/Business Name</label>
                <input v-model="supplierForm.name" placeholder="Company Name" class="premium-input" />
              </div>
              <div class="form-group">
                <label>Contact Person</label>
                <input v-model="supplierForm.contactPerson" placeholder="Full Name" class="premium-input" />
              </div>
              <div class="form-group">
                <label>Phone Number</label>
                <input v-model="supplierForm.phone" placeholder="+63 9xx..." class="premium-input" />
              </div>
              <div class="form-group span-2">
                <label>Email Address</label>
                <input v-model="supplierForm.email" placeholder="email@example.com" class="premium-input" />
              </div>
              <div class="form-group span-2">
                <label>Address Line 1</label>
                <input v-model="supplierForm.address1" placeholder="Street, Barangay" class="premium-input" />
              </div>
              <div class="form-group span-2">
                <label>Address Line 2 (Optional)</label>
                <input v-model="supplierForm.address2" placeholder="City, Province, ZIP" class="premium-input" />
              </div>
              <button class="btn-primary span-2 mt-4" @click="handleAddSupplier">
                {{ editingId ? 'Update' : 'Register' }} Supplier
              </button>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- EXCEL IMPORT PREVIEW MODAL -->
    <Transition name="modal">
      <div v-if="showImportModal" class="modal-overlay" @click.self="showImportModal = false">
        <div class="modal-box import-modal glass-container">
          <div class="modal-header">
            <div>
              <h3>📊 Import Preview</h3>
              <p class="import-subtitle">{{ importPreview.length }} suppliers found — review before importing</p>
            </div>
            <button class="close-btn" @click="showImportModal = false">✕</button>
          </div>
          <div v-if="importError" class="import-error">{{ importError }}</div>
          <div class="import-table-wrap">
            <table class="import-table">
              <colgroup>
                <col style="width: 40px" />
                <col style="width: 18%" />
                <col style="width: 13%" />
                <col style="width: 16%" />
                <col style="width: 18%" />
                <col style="width: 18%" />
                <col style="width: 17%" />
              </colgroup>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Supplier Name</th>
                  <th>Contact Person</th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th>Address 1</th>
                  <th>Address 2</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="(row, i) in importPreview" :key="i" :class="{ 'row-warning': !row.name }">
                  <td class="row-num">{{ i + 1 }}</td>
                  <td class="fw-bold cell-clip">{{ row.name || '⚠ Missing' }}</td>
                  <td class="cell-clip">{{ row.contactPerson || '—' }}</td>
                  <td class="cell-clip">{{ row.phone || '—' }}</td>
                  <td class="cell-clip">{{ row.email || '—' }}</td>
                  <td class="cell-clip">{{ row.address1 || '—' }}</td>
                  <td class="cell-clip">{{ row.address2 || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="import-footer">
            <button class="btn-cancel" @click="showImportModal = false">Cancel</button>
            <button class="btn-primary" :disabled="importLoading" @click="confirmImport">
              {{ importLoading ? 'Importing...' : `✓ Import ${importPreview.length} Suppliers` }}
            </button>
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
  --p-card-bg: rgba(255, 255, 255, 0.6);
  --p-text: #1e293b;
  --p-muted: #64748b;
}

.admin-page {
  padding: 1.5rem 2.5rem;
  height: calc(100vh - 64px);
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

/* Tabs */
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
  border: none;
  cursor: pointer;
  color: var(--p-muted);
  font-weight: 600;
  transition: all 0.2s;
}

.tab-btn:hover {
  background: rgba(14, 165, 233, 0.05);
  color: var(--p-primary);
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

/* Content Area */
.main-content {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
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
