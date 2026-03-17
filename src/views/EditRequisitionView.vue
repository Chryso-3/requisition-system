<template>
  <div class="edit-requisition">
    <div class="container-fluid">
      <div class="row">
        <div class="col-12">
          <div class="card" :class="{ 'bg-dark text-white': isDarkMode }">
            <div class="card-header d-flex justify-content-between align-items-center">
              <h4 class="card-title">Edit Requisition #{{ rfControlNo }}</h4>
              <button class="btn btn-sm btn-outline-secondary" @click="$router.back()">
                <i class="feather icon-arrow-left"></i> Back
              </button>
            </div>
            <div class="card-body">
              <div v-if="loading" class="text-center py-5">
                <div class="spinner-border text-primary" role="status"></div>
                <p class="mt-2">Loading requisition data...</p>
              </div>
              <div v-else-if="error" class="alert alert-danger">{{ error }}</div>
              <form v-else @submit.prevent="handleUpdate">
                <div class="row">
                  <div class="col-md-12 mb-3">
                    <label class="form-label">Title / Brief Description</label>
                    <input v-model="form.title" type="text" class="form-control" :class="{ 'bg-dark text-white border-secondary': isDarkMode }" required>
                  </div>
                  <div class="col-md-6 mb-3">
                    <label class="form-label">Department</label>
                    <input v-model="form.department" type="text" class="form-control" :class="{ 'bg-dark text-white border-secondary': isDarkMode }" required>
                  </div>
                  <div class="col-md-6 mb-3">
                    <label class="form-label">Location</label>
                    <input v-model="form.location" type="text" class="form-control" :class="{ 'bg-dark text-white border-secondary': isDarkMode }" required>
                  </div>
                  <div class="col-md-12 mb-3">
                    <label class="form-label">Description of Work/Service/Supply</label>
                    <textarea v-model="form.description" class="form-control" :class="{ 'bg-dark text-white border-secondary': isDarkMode }" rows="3" required></textarea>
                  </div>
                  <div class="col-md-12 mb-3">
                    <label class="form-label">Purpose / Reason</label>
                    <textarea v-model="form.reason" class="form-control" :class="{ 'bg-dark text-white border-secondary': isDarkMode }" rows="2" required></textarea>
                  </div>
                  <div class="col-md-6 mb-3">
                    <label class="form-label">Priority</label>
                    <select v-model="form.priority" class="form-select" :class="{ 'bg-dark text-white border-secondary': isDarkMode }">
                      <option value="Normal">Normal</option>
                      <option value="Urgent">Urgent</option>
                      <option value="Emergency">Emergency</option>
                    </select>
                  </div>
                  <div class="col-md-6 mb-3">
                    <label class="form-label">Date Needed</label>
                    <input v-model="form.dateNeeded" type="date" class="form-control" :class="{ 'bg-dark text-white border-secondary': isDarkMode }">
                  </div>
                </div>

                <hr class="my-4">
                <div class="d-flex justify-content-between align-items-center mb-3">
                  <h5>Items</h5>
                  <button type="button" class="btn btn-sm btn-outline-primary" @click="addItem">
                    <i class="feather icon-plus"></i> Add Item
                  </button>
                </div>

                <div class="table-responsive">
                  <table class="table" :class="{ 'table-dark': isDarkMode }">
                    <thead>
                      <tr>
                        <th>Description</th>
                        <th style="width: 100px">Qty</th>
                        <th style="width: 120px">Unit</th>
                        <th style="width: 50px"></th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr v-for="(item, idx) in form.items" :key="idx">
                        <td><input v-model="item.description" type="text" class="form-control form-control-sm" :class="{ 'bg-dark text-white border-secondary': isDarkMode }" required></td>
                        <td><input v-model="item.quantity" type="number" class="form-control form-control-sm" :class="{ 'bg-dark text-white border-secondary': isDarkMode }" required></td>
                        <td><input v-model="item.unit" type="text" class="form-control form-control-sm" :class="{ 'bg-dark text-white border-secondary': isDarkMode }" required></td>
                        <td>
                          <button type="button" class="btn btn-link text-danger p-0" @click="removeItem(idx)" :disabled="form.items.length <= 1">
                            <i class="feather icon-trash-2"></i>
                          </button>
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                <div class="mt-4 text-end">
                  <button type="submit" class="btn btn-primary" :disabled="submitting">
                    {{ submitting ? 'Updating...' : 'Update & Save Draft' }}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { getRequisition, updateRequisition } from '@/services/requisitionService'

const route = useRoute()
const router = useRouter()
const id = route.params.id
const rfControlNo = ref('')
const loading = ref(true)
const submitting = ref(false)
const error = ref(null)
const isDarkMode = ref(document.body.classList.contains('dark-layout'))

const form = ref({
  title: '',
  department: '',
  location: '',
  description: '',
  reason: '',
  priority: 'Normal',
  dateNeeded: '',
  items: []
})

onMounted(async () => {
  try {
    const data = await getRequisition(id)
    if (!data) throw new Error('Requisition not found')
    
    rfControlNo.value = data.rfControlNo
    form.value = {
      title: data.title || '',
      department: data.department || '',
      location: data.location || '',
      description: data.description || '',
      reason: data.reason || '',
      priority: data.priority || 'Normal',
      dateNeeded: data.dateNeeded || '',
      items: data.items || [{ description: '', quantity: 1, unit: 'pcs' }]
    }
  } catch (err) {
    error.value = err.message
  } finally {
    loading.value = false
  }
})

const addItem = () => {
  form.value.items.push({ description: '', quantity: 1, unit: 'pcs' })
}

const removeItem = (idx) => {
  form.value.items.splice(idx, 1)
}

const handleUpdate = async () => {
  submitting.value = true
  try {
    await updateRequisition(id, { ...form.value, updatedAt: new Date().toISOString() })
    router.push('/requisitions')
  } catch (err) {
    alert('Failed to update: ' + err.message)
  } finally {
    submitting.value = false
  }
}
</script>
