import { defineStore } from 'pinia'
import { ref } from 'vue'
import { getSystemConfig, subscribeSystemConfig } from '@/services/adminService'

export const useSystemStore = defineStore('system', () => {
  const config = ref({
    registrationEnabled: true,
    maintenanceMode: false,
    announcement: {
      active: false,
      text: '',
      type: 'info',
    },
  })
  const loading = ref(false)
  const initialized = ref(false)
  let unsubscribe = null

  async function fetchConfig() {
    if (initialized.value) return
    loading.value = true
    try {
      // One-time fetch
      const data = await getSystemConfig()
      config.value = { ...config.value, ...data }
      initialized.value = true

      // Start real-time listener
      if (!unsubscribe) {
        unsubscribe = subscribeSystemConfig((data) => {
          config.value = { ...config.value, ...data }
        })
      }
    } catch (err) {
      console.error('Failed to fetch system config:', err)
    } finally {
      loading.value = false
    }
  }

  return {
    config,
    loading,
    initialized,
    fetchConfig,
  }
})
