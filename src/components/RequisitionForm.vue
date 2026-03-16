<script setup>
import { ref, reactive, watch, computed, onMounted } from 'vue'
import { createRequisitionDocument, updateRequisition, getDepartments } from '@/services/requisitionService'
import { getDepartmentManagers } from '@/services/adminService'
import { REQUISITION_STATUS, USER_ROLE_LABELS } from '@/firebase/collections'
import { useAuthStore } from '@/stores/auth'

const props = defineProps({
  requisition: {
    type: Object,
    default: null,
  },
})

const emit = defineEmits(['created', 'updated', 'cancel'])

const authStore = useAuthStore()
const loading = ref(false)
const error = ref(null)
const showSaveConfirm = ref(false)
const isEditing = computed(() => !!props.requisition)

const form = reactive({
  date: new Date().toISOString().slice(0, 10),
  department: '',
  assignedApproverId: '', // Direct Assignment
  purpose: '',
  items: [{ quantity: 1, unit: 'pcs', description: '', remarks: '' }],
})

const availableManagers = ref([])
const fetchingManagers = ref(false)

// Load existing requisition data if editing
watch(
  () => props.requisition,
  (req) => {
    if (req) {
      form.date = req.date?.toDate
        ? req.date.toDate().toISOString().slice(0, 10)
        : req.date
          ? new Date(req.date).toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10)
      form.department = req.department || ''
      form.assignedApproverId = req.assignedApproverId || ''
      form.purpose = req.purpose || ''
      form.items =
        req.items && req.items.length > 0
          ? req.items.map((i) => ({
              quantity: i.quantity || 1,
              unit: i.unit || 'pcs',
              description: i.description || '',
              remarks: i.remarks || '',
            }))
          : [{ quantity: 1, unit: 'pcs', description: '', remarks: '' }]
    }
  },
  { immediate: true },
)

const units = ['pcs', 'dz.', 'set', 'box', 'unit', 'pair', 'roll', 'meter', 'liter', 'kg']

const departments = ref([])

onMounted(async () => {
  departments.value = await getDepartments()
})

function addItem() {
  form.items.push({ quantity: 1, unit: 'pcs', description: '', remarks: '' })
}

function removeItem(index) {
  if (form.items.length > 1) form.items.splice(index, 1)
}

function openSaveConfirm() {
  const items = form.items
    .filter((i) => i.description?.trim())
    .map((i) => ({
      quantity: Number(i.quantity) || 0,
      unit: i.unit || 'pcs',
      description: (i.description || '').trim(),
      remarks: (i.remarks || '').trim() || '',
    }))
  if (items.length === 0) {
    error.value = 'Add at least one item with a description.'
    return
  }
  error.value = null
  showSaveConfirm.value = true
}

function closeSaveConfirm() {
  showSaveConfirm.value = false
}

// Watch department to fetch specific managers
watch(
  () => form.department,
  async (newDept) => {
    // Immediately clear stale data to avoid showing managers/positions from the previous department
    availableManagers.value = []

    // In creation mode, always reset. In edit mode, only reset if the department actually changed
    // (to prevent clearing on initial load of existing requisition)
    const isInitialLoad = isEditing.value && props.requisition?.department === newDept
    if (!isInitialLoad) {
      form.assignedApproverId = ''
    }

    if (newDept) {
      fetchingManagers.value = true
      try {
        const managers = await getDepartmentManagers(newDept)
        availableManagers.value = managers

        // Final safety check: if the newly loaded list doesn't contain the current ID, clear it
        if (form.assignedApproverId && !managers.find((m) => m.uid === form.assignedApproverId)) {
          form.assignedApproverId = ''
        }
      } catch (e) {
        console.error('Failed to fetch department managers:', e)
      } finally {
        fetchingManagers.value = false
      }
    }
  },
)

async function onSubmit() {
  closeSaveConfirm()
  error.value = null

  if (!form.assignedApproverId) {
    error.value = 'Please select a specific approver for this request.'
    return
  }

  loading.value = true
  try {
    const items = form.items
      .filter((i) => i.description.trim())
      .map((i) => ({
        quantity: Number(i.quantity) || 0,
        unit: i.unit || 'pcs',
        description: i.description.trim(),
        remarks: i.remarks?.trim() || '',
      }))

    if (items.length === 0) {
      throw new Error('Add at least one item with a description.')
    }

    const assignedManager = availableManagers.value.find((m) => m.uid === form.assignedApproverId)
    const approverName =
      assignedManager?.displayName || assignedManager?.name || 'Assigned Approver'

    if (isEditing.value) {
      const requestedBy = authStore.user
        ? {
            userId: authStore.user.uid,
            name: authStore.displayName,
            signedAt: new Date().toISOString(),
          }
        : props.requisition.requestedBy
      const doc = await updateRequisition(props.requisition.id, {
        department: form.department,
        assignedApproverId: form.assignedApproverId,
        assignedApproverName: approverName,
        assignedApproverRole: assignedManager?.role || 'Section/Division Head',
        purpose: form.purpose,
        date: form.date
          ? new Date(form.date + 'T12:00:00').toISOString()
          : new Date().toISOString(),
        items,
        requestedBy,
      })
      emit('updated', doc)
    } else {
      const doc = await createRequisitionDocument({
        department: form.department,
        assignedApproverId: form.assignedApproverId,
        assignedApproverName: approverName,
        assignedApproverRole: assignedManager?.role || 'Section/Division Head',
        purpose: form.purpose,
        date: form.date
          ? new Date(form.date + 'T12:00:00').toISOString()
          : new Date().toISOString(),
        items,
        status: REQUISITION_STATUS.DRAFT,
        requestedBy: authStore.user
          ? {
              userId: authStore.user.uid,
              name: authStore.displayName,
              signedAt: new Date().toISOString(),
            }
          : null,
      })
      emit('created', doc)
    }
  } catch (e) {
    error.value =
      e.message ||
      (isEditing.value ? 'Failed to update requisition.' : 'Failed to create requisition.')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <form class="requisition-form" @submit.prevent="openSaveConfirm">
    <div v-if="error" class="error">{{ error }}</div>

    <div v-if="requisition?.purchaseStatus === 'received'" class="received-stamp-overlay">
      <div class="received-stamp">RECEIVED</div>
    </div>

    <div class="field-row">
      <div class="field">
        <label>Date</label>
        <input v-model="form.date" type="date" required />
      </div>
      <div class="field field-readonly">
        <label>RF Control No.</label>
        <input type="text" value="Auto-assigned on create" disabled class="readonly" />
      </div>
    </div>

    <div class="field-row">
      <div class="field">
        <label>Department</label>
        <select v-model="form.department" required>
          <option value="" disabled>Select Department</option>
          <option v-for="dept in departments" :key="dept" :value="dept">{{ dept }}</option>
        </select>
      </div>

      <!-- Direct Approver Assignment -->
      <div class="field" :class="{ 'field-disabled': !form.department || fetchingManagers }">
        <label>Confirm Name of Approver (Section / Div. Head)</label>
        <div v-if="fetchingManagers" class="fetching-indicator">
          <span class="spinner-tiny"></span> Loading authorized personnel...
        </div>
        <select v-else v-model="form.assignedApproverId" :disabled="!form.department" required>
          <option value="" disabled>
            {{ form.department ? 'Choose specific name...' : 'Please select department first' }}
          </option>
          <option v-for="m in availableManagers" :key="m.uid" :value="m.uid">
            {{ m.displayName || m.name }} — {{ USER_ROLE_LABELS[m.role] }}
          </option>
        </select>
        <small
          v-if="form.department && !fetchingManagers && availableManagers.length === 0"
          class="error-text"
        >
          No active managers found for this department. Please contact Admin.
        </small>
      </div>
    </div>

    <div class="field">
      <label>Purpose of Request</label>
      <textarea
        v-model="form.purpose"
        rows="2"
        placeholder="e.g. FOR LEYECO III IT AND CORPLAN MANAGER"
        required
      ></textarea>
    </div>

    <div class="items-section">
      <div class="items-header">
        <h3>Requested Items</h3>
        <button type="button" class="btn-add" @click="addItem">+ Add Item</button>
      </div>

      <div class="table-scroll-wrap">
        <table class="items-table">
          <thead>
            <tr>
              <th>QTY</th>
              <th>Unit</th>
              <th>Description / Specifications</th>
              <th>Remarks</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(item, idx) in form.items" :key="idx">
              <td>
                <input v-model.number="item.quantity" type="number" min="1" class="qty-input" />
              </td>
              <td>
                <select v-model="item.unit">
                  <option v-for="u in units" :key="u" :value="u">{{ u }}</option>
                </select>
              </td>
              <td>
                <input v-model="item.description" type="text" placeholder="e.g. WIRELESS MOUSE" />
              </td>
              <td><input v-model="item.remarks" type="text" placeholder="—" /></td>
              <td>
                <button type="button" class="btn-remove" @click="removeItem(idx)">Remove</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="actions">
      <button type="button" class="btn-secondary" :disabled="loading" @click="emit('cancel')">
        Cancel
      </button>
      <button type="submit" class="btn-primary" :disabled="loading">
        {{ isEditing ? 'Save Draft' : 'Save as Draft' }}
      </button>
    </div>

    <!-- Loading: spinner + label only, no white box -->
    <div v-if="loading" class="form-loading-overlay" aria-live="polite" aria-busy="true">
      <div class="form-loading-content">
        <div class="form-loading-spinner"></div>
        <span class="form-loading-text">Saving…</span>
      </div>
    </div>

    <!-- Confirm: Save draft -->
    <div v-if="showSaveConfirm" class="form-confirm-overlay" @click.self="closeSaveConfirm">
      <div class="form-confirm-modal">
        <h3 class="form-confirm-title">{{ isEditing ? 'Update draft' : 'Save draft' }}</h3>
        <p class="form-confirm-message">
          {{
            isEditing
              ? 'Your changes will be saved. The requisition will remain in draft until you submit it for approval.'
              : 'This requisition will be saved as a draft. You can complete and submit it for approval when ready.'
          }}
        </p>
        <div class="form-confirm-actions">
          <button type="button" class="btn-secondary" @click="closeSaveConfirm">Cancel</button>
          <button type="button" class="btn-primary" @click="onSubmit">
            {{ isEditing ? 'Update' : 'Save draft' }}
          </button>
        </div>
      </div>
    </div>
  </form>
</template>

<style scoped>
/* System primary (match nav/buttons across app) */
.requisition-form {
  --form-primary: #0ea5e9;
  --form-primary-hover: #0284c7;
  width: 100%;
  padding: 1.75rem 2rem;
}

.error {
  background: #fef2f2;
  color: #b91c1c;
  padding: 0.75rem 1rem;
  border-radius: 8px;
  margin-bottom: 1.25rem;
  border: 1px solid #fecaca;
  font-size: 0.875rem;
}

.field-row {
  display: flex;
  gap: 1.25rem;
  margin-bottom: 1.25rem;
}
.field-row .field {
  flex: 1;
  margin-bottom: 0;
}
.field-readonly .readonly {
  background: #f8fafc;
  color: #64748b;
  cursor: not-allowed;
  border-color: #e2e8f0;
}

.field {
  margin-bottom: 1.5rem;
}
.field label {
  display: block;
  font-weight: 600;
  margin-bottom: 0.5rem;
  font-size: 0.875rem;
  color: #1e293b;
  letter-spacing: 0.01em;
  text-transform: uppercase;
  font-size: 0.8125rem;
}
.field input,
.field textarea {
  width: 100%;
  padding: 0.6rem 0.75rem;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  font-size: 0.9375rem;
  background: #fff;
}
.field input:focus,
.field textarea:focus,
.field select:focus {
  outline: none;
  border-color: var(--form-primary);
  box-shadow:
    0 0 0 3px rgba(14, 165, 233, 0.15),
    0 2px 8px rgba(0, 0, 0, 0.08);
  transform: translateY(-1px);
}

.field select {
  appearance: none;
  background: linear-gradient(135deg, #ffffff 0%, #f8fafc 100%)
    url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMTIiIHZpZXdCb3g9IjAgMCAyMCAxMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTUgMkwxMCA3TDE1IDIiIHN0cm9rZT0iIzY0NzQ4YiIgc3Ryb2tlLXdpZHRoPSIyLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPgo8L3N2Zz4=')
    no-repeat right 1rem center;
  background-size: 16px;
  padding: 0.75rem 3rem 0.75rem 0.75rem;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  font-weight: 500;
  color: #334155;
  border: 2px solid #e2e8f0;
  border-radius: 12px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
  font-size: 0.9375rem;
  line-height: 1.5;
  min-height: 48px;
}
.field select:hover {
  border-color: #cbd5e1;
  background:
    linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%),
    url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTIiIGhlaWdodD0iOCIgdmlld0JveD0iMCAwIDEyIDgiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxwYXRoIGQ9Ik0xIDFMNiA2TDExIDEiIHN0cm9rZT0iIzY0NzQ4YiIgc3Ryb2tlLXdpZHRoPSIyIiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz4KPC9zdmc+')
      no-repeat right 1rem center;
  transform: translateY(-2px);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}
.field select:focus {
  background:
    linear-gradient(135deg, #ffffff 0%, #f8fafc 100%),
    url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMTIiIHZpZXdCb3g9IjAgMCAyMCAxMiIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTUgMkwxMCA3TDE1IDIiIHN0cm9rZT0iIzBlYTVlOSIgc3Ryb2tlLXdpZHRoPSIyLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPgo8L3N2Zz4=')
      no-repeat right 1rem center;
  transform: translateY(-3px);
  box-shadow:
    0 0 0 3px rgba(14, 165, 233, 0.15),
    0 4px 16px rgba(0, 0, 0, 0.1);
}

.items-section {
  margin-top: 1.75rem;
  padding-top: 1.5rem;
  border-top: 1px solid #e2e8f0;
}

.table-scroll-wrap {
  overflow-x: auto;
  overflow-y: auto;
  -webkit-overflow-scrolling: touch;
  margin: 0 -0.25rem;
  padding: 0 0.25rem;
  max-height: 420px;
  scrollbar-gutter: stable;
}
.items-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 0.75rem;
}
.items-header h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
  color: #0f172a;
}

.btn-add {
  padding: 0.45rem 0.9rem;
  background: var(--form-primary);
  color: #fff;
  border: 1px solid var(--form-primary);
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.875rem;
  font-weight: 600;
  transition:
    background 0.15s,
    border-color 0.15s;
}
.btn-add:hover {
  background: var(--form-primary-hover);
  border-color: var(--form-primary-hover);
}

.items-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.875rem;
}
.items-table th,
.items-table td {
  border: 1px solid #e2e8f0;
  padding: 0.5rem 0.6rem;
  text-align: left;
}
.items-table th {
  background: #f8fafc;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #64748b;
  position: sticky;
  top: 0;
  z-index: 5;
}
.items-table input,
.items-table select {
  width: 100%;
  padding: 0.4rem 0.5rem;
  border: 1px solid #e2e8f0;
  border-radius: 6px;
  font-size: 0.875rem;
}
.qty-input {
  width: 4.5rem;
}

.btn-remove {
  padding: 0.25rem 0.5rem;
  background: #fef2f2;
  color: #b91c1c;
  border: 1px solid #fecaca;
  border-radius: 6px;
  cursor: pointer;
  font-size: 0.75rem;
  font-weight: 500;
}
.btn-remove:hover {
  background: #fee2e2;
}

.actions {
  display: flex;
  gap: 1rem;
  margin-top: 1.75rem;
  padding-top: 1.5rem;
  border-top: 1px solid #e2e8f0;
  justify-content: flex-end;
}
.btn-primary {
  padding: 0.6rem 1.25rem;
  background: var(--form-primary);
  color: #fff;
  border: 1px solid var(--form-primary);
  border-radius: 8px;
  cursor: pointer;
  font-weight: 600;
  font-size: 0.9375rem;
  transition:
    background 0.15s,
    border-color 0.15s;
}
.btn-primary:hover:not(:disabled) {
  background: var(--form-primary-hover);
  border-color: var(--form-primary-hover);
}
.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-secondary {
  padding: 0.55rem 1.25rem;
  background: #fff;
  color: #334155;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  cursor: pointer;
  font-size: 0.9375rem;
}
.btn-secondary:hover {
  background: #f8fafc;
  border-color: #cbd5e1;
}

/* Loading: spinner + text only, no white box */
.form-loading-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.2);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.form-loading-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.875rem;
}
.form-loading-spinner {
  width: 40px;
  height: 40px;
  border: 3px solid rgba(14, 165, 233, 0.22);
  border-top-color: var(--form-primary);
  border-radius: 50%;
  animation: form-spin 0.65s linear infinite;
}
.form-loading-text {
  font-size: 0.875rem;
  font-weight: 500;
  color: #475569;
}
@keyframes form-spin {
  to {
    transform: rotate(360deg);
  }
}

/* Confirm: clean minimal dialog */
.form-confirm-overlay {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.35);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 999;
  padding: 1rem;
}
.form-confirm-modal {
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 10px 40px rgba(0, 0, 0, 0.12);
  padding: 1.5rem 1.75rem;
  min-width: 320px;
  max-width: 400px;
  border: 1px solid #e2e8f0;
}
.form-confirm-title {
  margin: 0 0 0.5rem;
  font-size: 1.0625rem;
  font-weight: 600;
  color: #0f172a;
  letter-spacing: -0.01em;
}
.form-confirm-message {
  margin: 0 0 1.5rem;
  font-size: 0.875rem;
  color: #475569;
  line-height: 1.55;
}
.form-confirm-actions {
  display: flex;
  gap: 0.5rem;
  justify-content: flex-end;
  flex-wrap: wrap;
}
.form-confirm-modal .btn-primary {
  min-width: 6rem;
}
/* Received Stamp */
.received-stamp-overlay {
  position: absolute;
  top: 15rem;
  right: 5rem;
  pointer-events: none;
  z-index: 100;
  display: flex;
  justify-content: center;
  align-items: center;
}

.received-stamp {
  font-family: 'Inter', sans-serif;
  font-weight: 900;
  font-size: 4rem;
  color: #ef4444; /* Bright Red */
  border: 8px double #ef4444;
  padding: 0.5rem 1.5rem;
  text-transform: uppercase;
  transform: rotate(-15deg);
  opacity: 0.8;
  letter-spacing: 4px;
  user-select: none;
}

@media print {
  .received-stamp-overlay {
    position: fixed;
    top: 50mm;
    right: 30mm;
  }
}

.fetching-indicator {
  font-size: 0.8rem;
  color: #64748b;
  margin-top: 0.25rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.spinner-tiny {
  width: 14px;
  height: 14px;
  border: 2px solid #e2e8f0;
  border-top-color: #3b82f6;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

.error-text {
  color: #ef4444;
  font-size: 0.8rem;
  margin-top: 0.25rem;
}

.field-disabled select {
  background-color: #f8fafc !important;
  cursor: not-allowed;
  opacity: 0.7;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
