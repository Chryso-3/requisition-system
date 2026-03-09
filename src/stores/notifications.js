import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { db } from '@/firebase'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { useAuthStore } from './auth'
import { COLLECTIONS, REQUISITION_STATUS } from '@/firebase/collections'

export const useNotificationStore = defineStore('notifications', () => {
  const authStore = useAuthStore()
  const notifications = ref([])
  const loading = ref(false)
  let unsubscribe = null

  const unreadCount = computed(() => notifications.value.length)

  function initNotificationListener() {
    if (unsubscribe) unsubscribe()

    const role = authStore.role
    if (!role) return

    loading.value = true

    // Define which status each role is responsible for
    let targetStatus = null
    if (role === 'section_head') targetStatus = REQUISITION_STATUS.PENDING_RECOMMENDATION
    if (role === 'warehouse_head') targetStatus = REQUISITION_STATUS.PENDING_INVENTORY
    if (role === 'budget_officer') targetStatus = REQUISITION_STATUS.PENDING_BUDGET
    if (role === 'internal_auditor') targetStatus = REQUISITION_STATUS.PENDING_AUDIT
    if (role === 'general_manager') targetStatus = REQUISITION_STATUS.PENDING_APPROVAL

    if (!targetStatus) {
      notifications.value = []
      loading.value = false
      return
    }

    const q = query(collection(db, COLLECTIONS.REQUISITIONS), where('status', '==', targetStatus))

    unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        notifications.value = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }))
        loading.value = false
      },
      (error) => {
        console.error('Notification Listener Error:', error)
        loading.value = false
      },
    )
  }

  function stopListener() {
    if (unsubscribe) {
      unsubscribe()
      unsubscribe = null
    }
    notifications.value = []
  }

  return {
    notifications,
    unreadCount,
    loading,
    initNotificationListener,
    stopListener,
  }
})
