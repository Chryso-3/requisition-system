import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { db } from '@/firebase'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { useAuthStore } from './auth'
import {
  COLLECTIONS,
  REQUISITION_STATUS,
  USER_ROLES,
} from '@/firebase/collections'

export const useNotificationStore = defineStore('notifications', () => {
  const authStore = useAuthStore()
  const notifications = ref([])
  const loading = ref(false)
  const unreadCount = computed(() => notifications.value.length)
  let unsubscribeRF = null

  function initNotificationListener() {
    // Tear down any existing listener
    if (unsubscribeRF) { unsubscribeRF(); unsubscribeRF = null }

    const role = authStore.role
    if (!role) {
      notifications.value = []
      return
    }

    loading.value = true

    // ── RF (Requisition Form) Listener ─────────────────────────────────────────
    const managerRoles = [
      USER_ROLES.SECTION_HEAD,
      USER_ROLES.DIVISION_HEAD,
      USER_ROLES.DEPARTMENT_HEAD,
    ]
    const isManager = managerRoles.includes(role)

    let rfStatus = null
    if (isManager) {
      rfStatus = REQUISITION_STATUS.PENDING_RECOMMENDATION
    } else if (role === USER_ROLES.WAREHOUSE_HEAD) {
      rfStatus = REQUISITION_STATUS.PENDING_INVENTORY
    } else if (role === USER_ROLES.BUDGET_OFFICER) {
      rfStatus = REQUISITION_STATUS.PENDING_BUDGET
    } else if (role === USER_ROLES.INTERNAL_AUDITOR) {
      rfStatus = REQUISITION_STATUS.PENDING_AUDIT
    } else if (role === USER_ROLES.GENERAL_MANAGER) {
      rfStatus = REQUISITION_STATUS.PENDING_APPROVAL
    }

    if (rfStatus) {
      const rfQuery = query(
        collection(db, COLLECTIONS.REQUISITIONS),
        where('status', '==', rfStatus),
      )
      unsubscribeRF = onSnapshot(
        rfQuery,
        (snapshot) => {
          let docs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
          if (isManager) {
            const userDept = authStore.department?.trim().toUpperCase()
            const userId = authStore.user?.uid
            docs = docs.filter((r) => {
              return (
                r.department?.trim().toUpperCase() === userDept && r.assignedApproverId === userId
              )
            })
          }
          notifications.value = docs
          loading.value = false
        },
        (error) => {
          console.error('[Notifications] RF Listener Error:', error)
          loading.value = false
        },
      )
    } else {
      notifications.value = []
      loading.value = false
    }
  }

  function stopListener() {
    if (unsubscribeRF) { unsubscribeRF(); unsubscribeRF = null }
    notifications.value = []
    loading.value = false
  }

  return {
    notifications,
    unreadCount,
    loading,
    initNotificationListener,
    stopListener,
  }
})
