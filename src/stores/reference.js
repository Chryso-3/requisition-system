import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { getDepartments } from '@/services/adminService'

export const useReferenceStore = defineStore('reference', () => {
  const departments = ref([])
  const loading = ref(false)
  const error = ref(null)
  
  const deptsInitialized = ref(false)

  const departmentNames = computed(() => departments.value.map((d) => d.name))

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

  // Pre-fetch everything
  async function ensureAll() {
    await fetchDepartments()
  }

  // Optimistic Mutations
  function optimisticallyAddDept(name) {
    const tempId = 'temp-' + Date.now()
    const newDept = { id: tempId, name, isActive: true, isOptimistic: true }
    departments.value.push(newDept)
    return tempId
  }

  function rollbackDept(tempId) {
    departments.value = departments.value.filter(d => d.id !== tempId)
  }

  return {
    departments,
    departmentNames,
    loading,
    error,
    deptsInitialized,
    fetchDepartments,
    ensureAll,
    optimisticallyAddDept,
    rollbackDept
  }
})
