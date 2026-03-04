<script setup>
import { ref, onMounted, computed } from 'vue'
import {
  getDepartments,
  addDepartment,
  updateDepartment,
  getSuppliers,
  addSupplier,
  updateSupplier,
} from '@/services/adminService'
import {
  Building2,
  Truck,
  Plus,
  Pencil,
  Check,
  X,
  Search,
  Phone,
  User,
  ExternalLink,
  Ban,
  RotateCcw,
} from 'lucide-vue-next'

const activeTab = ref('departments') // 'departments' or 'suppliers'
const departments = ref([])
const suppliers = ref([])
const loading = ref(true)
const searchQuery = ref('')
const saving = ref(false)

// Inline Editing / Adding state
const isAddingDepartment = ref(false)
const newDeptName = ref('')
const editingDeptId = ref(null)
const editingDeptName = ref('')

const isAddingSupplier = ref(false)
const newSupplier = ref({ name: '', contactPerson: '', contactNumber: '', address: '' })
const editingSupplierId = ref(null)
const editingSupplier = ref(null)

const filteredItems = computed(() => {
  const list = activeTab.value === 'departments' ? departments.value : suppliers.value
  if (!searchQuery.value) return list
  const q = searchQuery.value.toLowerCase()
  return list.filter(
    (item) =>
      item.name?.toLowerCase().includes(q) ||
      item.contactPerson?.toLowerCase().includes(q) ||
      item.contactNumber?.toLowerCase().includes(q),
  )
})

async function fetchData() {
  loading.value = true
  try {
    if (activeTab.value === 'departments') {
      departments.value = await getDepartments()
    } else {
      suppliers.value = await getSuppliers()
    }
  } catch (err) {
    console.error('Error fetching data:', err)
  } finally {
    loading.value = false
  }
}

// Departments Actions
async function handleAddDept() {
  if (!newDeptName.value.trim()) return
  saving.value = true
  try {
    await addDepartment(newDeptName.value.trim())
    newDeptName.value = ''
    isAddingDepartment.value = false
    await fetchData()
  } catch (err) {
    alert('Failed to add department')
  } finally {
    saving.value = false
  }
}

async function handleUpdateDept(dept) {
  if (!editingDeptName.value.trim()) return
  saving.value = true
  try {
    await updateDepartment(dept.id, { name: editingDeptName.value.trim() })
    editingDeptId.value = null
    await fetchData()
  } catch (err) {
    alert('Failed to update department')
  } finally {
    saving.value = false
  }
}

async function toggleDeptStatus(dept) {
  saving.value = true
  try {
    await updateDepartment(dept.id, { isActive: !dept.isActive })
    await fetchData()
  } catch (err) {
    alert('Failed to toggle status')
  } finally {
    saving.value = false
  }
}

// Suppliers Actions
async function handleAddSupplier() {
  if (!newSupplier.value.name.trim()) return
  saving.value = true
  try {
    await addSupplier(newSupplier.value)
    newSupplier.value = { name: '', contactPerson: '', contactNumber: '', address: '' }
    isAddingSupplier.value = false
    await fetchData()
  } catch (err) {
    alert('Failed to add supplier')
  } finally {
    saving.value = false
  }
}

async function handleUpdateSupplier() {
  if (!editingSupplier.value.name.trim()) return
  saving.value = true
  try {
    await updateSupplier(editingSupplierId.value, editingSupplier.value)
    editingSupplierId.value = null
    editingSupplier.value = null
    await fetchData()
  } catch (err) {
    alert('Failed to update supplier')
  } finally {
    saving.value = false
  }
}

async function toggleSupplierStatus(supplier) {
  saving.value = true
  try {
    await updateSupplier(supplier.id, { isActive: !supplier.isActive })
    await fetchData()
  } catch (err) {
    alert('Failed to toggle status')
  } finally {
    saving.value = false
  }
}

function startEditSupplier(supplier) {
  editingSupplierId.value = supplier.id
  editingSupplier.value = { ...supplier }
}

function startEditDept(dept) {
  editingDeptId.value = dept.id
  editingDeptName.value = dept.name
}

function cancelEditDept() {
  editingDeptId.value = null
}

function cancelEditSupplier() {
  editingSupplierId.value = null
  editingSupplier.value = null
}

function switchTab(tab) {
  activeTab.value = tab
  fetchData()
}

onMounted(fetchData)
</script>

<template>
  <div class="admin-page">
    <header class="page-header">
      <div class="header-content">
        <h1 class="page-title">Reference Data</h1>
        <p class="page-subtitle">Manage Departments and Supplier master lists</p>
      </div>
      <div class="header-actions">
        <div class="search-box">
          <Search :size="18" class="search-icon" />
          <input
            v-model="searchQuery"
            type="text"
            placeholder="Search by name..."
            class="search-input"
          />
        </div>
      </div>
    </header>

    <div class="tab-navigation animate-slide-up">
      <button
        @click="switchTab('departments')"
        class="elite-tab-btn"
        :class="{ active: activeTab === 'departments' }"
      >
        <Building2 :size="18" />
        Departments
      </button>
      <button
        @click="switchTab('suppliers')"
        class="elite-tab-btn"
        :class="{ active: activeTab === 'suppliers' }"
      >
        <Truck :size="18" />
        Suppliers
      </button>
    </div>

    <div class="glass-container elite-card animate-slide-up" style="animation-delay: 0.1s">
      <!-- Departments View -->
      <div v-if="activeTab === 'departments'" class="list-container">
        <div class="list-header">
          <h3>Organizational Departments</h3>
          <button @click="isAddingDepartment = true" class="btn-add" v-if="!isAddingDepartment">
            <Plus :size="18" /> Add Department
          </button>
        </div>

        <div v-if="isAddingDepartment" class="inline-form add-dept-form">
          <input
            v-model="newDeptName"
            placeholder="Department Name (e.g. Accounting, Engineering)"
            class="glass-input"
            @keyup.enter="handleAddDept"
          />
          <div class="form-actions">
            <button @click="handleAddDept" class="btn-save" :disabled="saving">
              <Check :size="18" />
            </button>
            <button @click="isAddingDepartment = false" class="btn-cancel">
              <X :size="18" />
            </button>
          </div>
        </div>

        <div v-if="loading" class="loading-state">
          <div class="glass-loader"></div>
        </div>

        <div v-else class="item-list scrollable-area custom-scrollbar">
          <div
            v-for="(dept, index) in filteredItems"
            :key="dept.id"
            class="data-row animate-staggered"
            :class="{ inactive: !dept.isActive }"
            :style="{ '--order': index }"
          >
            <div class="row-info" v-if="editingDeptId !== dept.id">
              <span class="item-name">{{ dept.name }}</span>
              <span class="status-indicator" :class="dept.isActive ? 'active' : 'inactive'">
                {{ dept.isActive ? 'Active' : 'Disabled' }}
              </span>
            </div>

            <div class="inline-edit" v-else>
              <input
                v-model="editingDeptName"
                class="glass-input"
                @keyup.enter="handleUpdateDept(dept)"
              />
            </div>

            <div class="row-actions">
              <template v-if="editingDeptId !== dept.id">
                <button @click="startEditDept(dept)" class="btn-icon">
                  <Pencil :size="16" />
                </button>
                <button
                  @click="toggleDeptStatus(dept)"
                  class="btn-icon"
                  :class="dept.isActive ? 'btn-deactivate' : 'btn-activate'"
                >
                  <Ban v-if="dept.isActive" :size="16" />
                  <RotateCcw v-else :size="16" />
                </button>
              </template>
              <template v-else>
                <button @click="handleUpdateDept(dept)" class="btn-save" :disabled="saving">
                  <Check :size="16" />
                </button>
                <button @click="cancelEditDept()" class="btn-cancel">
                  <X :size="16" />
                </button>
              </template>
            </div>
          </div>
        </div>
      </div>

      <!-- Suppliers View -->
      <div v-if="activeTab === 'suppliers'" class="list-container">
        <div class="list-header">
          <h3>Authorized Suppliers</h3>
          <button @click="isAddingSupplier = true" class="btn-add" v-if="!isAddingSupplier">
            <Plus :size="18" /> Add Supplier
          </button>
        </div>

        <div v-if="isAddingSupplier" class="inline-form supplier-form">
          <div class="grid-inputs">
            <input v-model="newSupplier.name" placeholder="Supplier Name" class="glass-input" />
            <input
              v-model="newSupplier.contactPerson"
              placeholder="Contact Person"
              class="glass-input"
            />
            <input
              v-model="newSupplier.contactNumber"
              placeholder="Contact Number"
              class="glass-input"
            />
            <input v-model="newSupplier.address" placeholder="Address" class="glass-input" />
          </div>
          <div class="form-actions">
            <button @click="handleAddSupplier" class="btn-save-text" :disabled="saving">
              Save Supplier
            </button>
            <button @click="isAddingSupplier = false" class="btn-cancel-text">Cancel</button>
          </div>
        </div>

        <div v-if="loading" class="loading-state">
          <div class="glass-loader"></div>
        </div>

        <div v-else class="item-list scrollable-area custom-scrollbar">
          <div
            v-for="(supplier, index) in filteredItems"
            :key="supplier.id"
            class="supplier-row animate-staggered"
            :class="{ inactive: !supplier.isActive }"
            :style="{ '--order': index }"
          >
            <div class="supplier-info" v-if="editingSupplierId !== supplier.id">
              <div class="sup-header">
                <span class="item-name">{{ supplier.name }}</span>
                <span class="status-indicator" :class="supplier.isActive ? 'active' : 'inactive'">
                  {{ supplier.isActive ? 'Active' : 'Blacklisted' }}
                </span>
              </div>
              <div class="sup-details">
                <span><User :size="12" /> {{ supplier.contactPerson || 'No contact' }}</span>
                <span><Phone :size="12" /> {{ supplier.contactNumber || 'No number' }}</span>
              </div>
            </div>

            <div v-else class="grid-inputs editing">
              <input v-model="editingSupplier.name" class="glass-input" />
              <input v-model="editingSupplier.contactPerson" class="glass-input" />
              <input v-model="editingSupplier.contactNumber" class="glass-input" />
              <input v-model="editingSupplier.address" class="glass-input" />
              <div class="edit-actions">
                <button @click="handleUpdateSupplier" class="btn-save"><Check :size="16" /></button>
                <button @click="cancelEditSupplier()" class="btn-cancel">
                  <X :size="16" />
                </button>
              </div>
            </div>

            <div class="row-actions" v-if="editingSupplierId !== supplier.id">
              <button @click="startEditSupplier(supplier)" class="btn-icon">
                <Pencil :size="16" />
              </button>
              <button
                @click="toggleSupplierStatus(supplier)"
                class="btn-icon"
                :class="supplier.isActive ? 'btn-deactivate' : 'btn-activate'"
              >
                <Ban v-if="supplier.isActive" :size="16" />
                <RotateCcw v-else :size="16" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.admin-page {
  padding: 0.5rem 2rem 2rem;
  max-width: 1700px;
  margin: 0 auto;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 1.5rem;
}

.page-title {
  font-size: 2rem;
  font-weight: 800;
  color: #1e293b;
  margin: 0;
  letter-spacing: -0.02em;
}

.page-subtitle {
  color: #64748b;
  margin: 0.25rem 0 0;
}

.search-box {
  position: relative;
  width: 300px;
}

.search-icon {
  position: absolute;
  left: 1rem;
  top: 50%;
  transform: translateY(-50%);
  color: #94a3b8;
}

.search-input {
  width: 100%;
  padding: 0.625rem 1rem 0.625rem 2.75rem;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  font-size: 0.9rem;
}

.tab-navigation {
  display: flex;
  gap: 0.75rem;
  margin-bottom: 1.5rem;
}

.elite-tab-btn {
  padding: 0.6rem 1.25rem;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.5);
  background: rgba(255, 255, 255, 0.4);
  backdrop-filter: blur(8px);
  color: #64748b;
  font-weight: 700;
  font-size: 0.8125rem;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  display: flex;
  align-items: center;
  gap: 0.625rem;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.02);
}

.elite-tab-btn:hover {
  background: rgba(255, 255, 255, 0.6);
  color: #1e293b;
  transform: translateY(-1px);
}

.elite-tab-btn.active {
  background: white;
  color: #0ea5e9;
  border-color: #0ea5e9;
  box-shadow: 0 8px 20px rgba(14, 165, 233, 0.1);
}

.glass-container.elite-card {
  background: rgba(255, 255, 255, 0.4);
  backdrop-filter: blur(25px) saturate(180%);
  -webkit-backdrop-filter: blur(25px) saturate(180%);
  border-radius: 24px;
  border: 1px solid rgba(255, 255, 255, 0.4);
  padding: 2.5rem;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.04),
    inset 0 0 0 1px rgba(255, 255, 255, 0.2);
}

.item-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.data-row,
.supplier-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1.25rem;
  border-radius: 12px;
  border: 1px solid transparent;
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
  background: rgba(255, 255, 255, 0.3);
}

.data-row:hover,
.supplier-row:hover {
  background: rgba(255, 255, 255, 0.8);
  border-color: rgba(14, 165, 233, 0.2);
  transform: translateX(6px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.03);
}

.item-name {
  font-weight: 700;
  color: #0f172a;
  font-size: 0.95rem;
}

.status-indicator {
  font-size: 0.65rem;
  font-weight: 800;
  padding: 0.2rem 0.6rem;
  border-radius: 6px;
  margin-left: 1rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.status-indicator.active {
  background: rgba(16, 185, 129, 0.1);
  color: #059669;
}
.status-indicator.inactive {
  background: rgba(239, 68, 68, 0.1);
  color: #dc2626;
}

.sup-details {
  display: flex;
  gap: 1.5rem;
  font-size: 0.75rem;
  color: #64748b;
  margin-top: 0.35rem;
}

.sup-details span {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.btn-primary {
  padding: 0.6rem 1.25rem;
  background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
  color: white;
  border: none;
  border-radius: 12px;
  font-size: 0.8125rem;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 0.625rem;
  box-shadow: 0 8px 20px rgba(14, 165, 233, 0.25);
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}

.btn-primary:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 24px rgba(14, 165, 233, 0.35);
}

.btn-icon {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  border: 1px solid rgba(226, 232, 240, 0.8);
  background: white;
  color: #64748b;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.btn-icon:hover {
  background: #1e293b;
  color: white;
  border-color: #1e293b;
  transform: scale(1.05);
}

.scrollable-area {
  max-height: 62vh;
  overflow-y: auto;
  padding-right: 0.75rem;
  margin-top: 1rem;
}

.custom-scrollbar::-webkit-scrollbar {
  width: 6px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: rgba(0, 0, 0, 0.1);
  border-radius: 10px;
}

.animate-staggered {
  opacity: 0;
  animation: slideUpElite 0.5s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  animation-delay: calc(var(--order) * 0.05s);
}

@keyframes slideUpElite {
  from {
    opacity: 0;
    transform: translateY(15px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.loading-state {
  display: flex;
  justify-content: center;
  padding: 6rem;
}

.glass-loader {
  width: 36px;
  height: 36px;
  border: 3px solid rgba(14, 165, 233, 0.1);
  border-top-color: #0f172a;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
