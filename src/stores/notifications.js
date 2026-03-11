import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { db } from '@/firebase'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { useAuthStore } from './auth'
import { COLLECTIONS, REQUISITION_STATUS, USER_ROLES } from '@/firebase/collections'

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
    const managerRoles = [
      USER_ROLES.SECTION_HEAD,
      USER_ROLES.DIVISION_HEAD,
      USER_ROLES.DEPARTMENT_HEAD,
    ]
    const isManager = managerRoles.includes(role)

    if (isManager) {
      targetStatus = REQUISITION_STATUS.PENDING_RECOMMENDATION
    } else if (role === USER_ROLES.WAREHOUSE_HEAD) {
      targetStatus = REQUISITION_STATUS.PENDING_INVENTORY
    } else if (role === USER_ROLES.BUDGET_OFFICER) {
      targetStatus = REQUISITION_STATUS.PENDING_BUDGET
    } else if (role === USER_ROLES.INTERNAL_AUDITOR) {
      targetStatus = REQUISITION_STATUS.PENDING_AUDIT
    } else if (role === USER_ROLES.GENERAL_MANAGER) {
      targetStatus = REQUISITION_STATUS.PENDING_APPROVAL
    }

    if (!targetStatus) {
      notifications.value = []
      loading.value = false
      return
    }

    const q = query(collection(db, COLLECTIONS.REQUISITIONS), where('status', '==', targetStatus))

    unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        let docs = snapshot.docs.map((doc) => ({
          id: doc.id,
          ...doc.data(),
        }))

        // Tighten the logic for managers: must match department AND assigned person
        if (isManager) {
          const userDept = authStore.department?.trim().toUpperCase()
          const userId = authStore.user?.uid
          docs = docs.filter((r) => {
            const deptMatch = r.department?.trim().toUpperCase() === userDept
            const personMatch = r.assignedApproverId === userId
            return deptMatch && personMatch
          })
        }

        notifications.value = docs
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
