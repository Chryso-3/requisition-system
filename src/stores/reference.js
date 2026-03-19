import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getDepartments, getSuppliers } from '@/services/adminService'

export const useReferenceStore = defineStore('reference', () => {
  const departments = ref([])
  const suppliers = ref([])
  const loading = ref(false)
  const error = ref(null)
  
  const deptsInitialized = ref(false)
  const suppliersInitialized = ref(false)

  const departmentNames = computed(() => departments.value.map((d) => d.name))
  const supplierNames = computed(() => suppliers.value.map((s) => s.name))

  async function fetchDepartments(force = false) {
    if (deptsInitialized.value && !force) return
    
    loading.value = true
    error.value = null
    try {
      departments.value = await getDepartments()
      deptsInitialized.value = true
    } catch (err) {
      console.error('Failed to fetch departments:', err)
      error.value = err.message
    } finally {
      loading.value = false
    }
  }

  async function fetchSuppliers(force = false) {
    if (suppliersInitialized.value && !force) return
    
    loading.value = true
    error.value = null
    try {
      suppliers.value = await getSuppliers()
      suppliersInitialized.value = true
    } catch (err) {
      console.error('Failed to fetch suppliers:', err)
      error.value = err.message
    } finally {
      loading.value = false
    }
  }

  // Pre-fetch everything
  async function ensureAll() {
    await Promise.all([
      fetchDepartments(),
      fetchSuppliers()
    ])
  }

  // Optimistic Mutations
  function optimisticallyAddDept(name) {
    const tempId = 'temp-' + Date.now()
    const newDept = { id: tempId, name, isActive: true, isOptimistic: true }
    departments.value.push(newDept)
    return tempId
  }

  function optimisticallyAddSupplier(supplierData) {
    const tempId = 'temp-' + Date.now()
    const newSupplier = { ...supplierData, id: tempId, isActive: true, isNew: true, isOptimistic: true }
    suppliers.value.push(newSupplier)
    return tempId
  }

  function rollbackDept(tempId) {
    departments.value = departments.value.filter(d => d.id !== tempId)
  }

  function rollbackSupplier(tempId) {
    suppliers.value = suppliers.value.filter(s => s.id !== tempId)
  }

  return {
    departments,
    suppliers,
    departmentNames,
    supplierNames,
    loading,
    error,
    deptsInitialized,
    suppliersInitialized,
    fetchDepartments,
    fetchSuppliers,
    ensureAll,
    optimisticallyAddDept,
    optimisticallyAddSupplier,
    rollbackDept,
    rollbackSupplier
  }
})
