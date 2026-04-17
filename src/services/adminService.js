import { db } from '@/firebase'
import {
  collection,
  getDocs,
  getDoc,
  setDoc,
  updateDoc,
  doc,
  query,
  orderBy,
  where,
  onSnapshot,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore'
import { COLLECTIONS, USER_ROLES } from '@/firebase/collections'

/**
 * Super Admin Service
 */

/**
 * Subscribe to system configuration updates
 */
export function subscribeSystemConfig(onData, onError) {
  const configRef = doc(db, COLLECTIONS.SYSTEM_CONFIG, 'settings')
  return onSnapshot(
    configRef,
    (snap) => {
      if (snap.exists()) {
        onData(snap.data())
      }
    },
    (err) => {
      console.error('System config subscription error:', err)
      if (onError) onError(err)
    },
  )
}

/**
 * Get all users from the users collection
 */
export async function getAllUsers() {
  const q = query(collection(db, COLLECTIONS.USERS), orderBy('createdAt', 'desc'))
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({
    uid: d.id,
    ...d.data(),
  }))
}

/**
 * Update a user's role
 */
export async function updateUserRole(uid, newRole) {
  const userRef = doc(db, COLLECTIONS.USERS, uid)
  await updateDoc(userRef, {
    role: newRole,
    updatedAt: new Date().toISOString(),
  })
}

/**
 * Update a user's department
 */
export async function updateUserDepartment(uid, dept) {
  const userRef = doc(db, COLLECTIONS.USERS, uid)
  await updateDoc(userRef, {
    department: dept,
    updatedAt: new Date().toISOString(),
  })
}

/**
 * Set user active status (soft deactivate)
 */
export async function setUserActive(uid, isActive) {
  const userRef = doc(db, COLLECTIONS.USERS, uid)
  await updateDoc(userRef, {
    isActive: isActive,
    updatedAt: new Date().toISOString(),
  })
}

/**
 * Get system configuration
 */
export async function getSystemConfig() {
  const configRef = doc(db, COLLECTIONS.SYSTEM_CONFIG, 'settings')
  const snap = await getDoc(configRef)
  if (snap.exists()) {
    return snap.data()
  }
  // Default config if none exists
  return {
    registrationEnabled: true,
    maintenanceMode: false,
    announcement: {
      active: false,
      text: '',
      type: 'info', // info, warning, success
    },
  }
}

/**
 * Update system configuration
 */
export async function updateSystemConfig(updates) {
  const configRef = doc(db, COLLECTIONS.SYSTEM_CONFIG, 'settings')
  await setDoc(configRef, updates, { merge: true })
}

/**
 * Get current counters (RF) for a specific year
 */
export async function getCounters(yearInput) {
  const year = yearInput || new Date().getFullYear()
  const refers = {
    rf: doc(db, 'counters', 'requisitionRf'),
  }

  const rfSnap = await getDoc(refers.rf)

  return {
    rf: rfSnap.exists() ? rfSnap.data().lastNo || 0 : 0,
    year,
  }
}

/**
 * Manually override a counter value for a specific year
 */
export async function setCounter(type, value) {
  if (type !== 'rf') {
    throw new Error('Invalid counter type')
  }
  const ref = doc(db, 'counters', 'requisitionRf')
  await setDoc(ref, { lastNo: parseInt(value) }, { merge: true })
}

/**
 * DEPARTMENTS MANAGEMENT
 */

export async function getDepartments() {
  const q = query(collection(db, COLLECTIONS.DEPARTMENTS), orderBy('name', 'asc'))
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function addDepartment(name) {
  const ref = collection(db, COLLECTIONS.DEPARTMENTS)
  await addDoc(ref, {
    name,
    isActive: true,
    createdAt: serverTimestamp(),
  })
}

export async function updateDepartment(id, updates) {
  const ref = doc(db, COLLECTIONS.DEPARTMENTS, id)
  await updateDoc(ref, {
    ...updates,
    updatedAt: serverTimestamp(),
  })
}

/**
 * API for Fetching Managers by Department (For Direct Assignment)
 * Fetches all users in the department. OGM (Office of General Manager) users
 * are typically handled via status-based broadcasts, so for DIRECT assignment
 * we focus on Section/Division/Department heads.
 *
 * NOTE: Using a query for roles first, then filtering by department in memory
 * to handle case-insensitivity and whitespace issues robustly.
 */
export async function getDepartmentManagers(dept, includeGM = false) {
  if (!dept) return []

  const managerRoles = [
    USER_ROLES.SECTION_HEAD,
    USER_ROLES.DIVISION_HEAD,
    USER_ROLES.DEPARTMENT_HEAD,
  ]
  if (includeGM) managerRoles.push(USER_ROLES.GENERAL_MANAGER)

  try {
    // Query all users with manager roles first (usually a smaller set than all users)
    const q = query(collection(db, COLLECTIONS.USERS), where('role', 'in', managerRoles))

    const snap = await getDocs(q)
    const targetDept = dept.trim().toUpperCase()

    const managers = snap.docs
      .map((d) => ({
        uid: d.id,
        ...d.data(),
      }))
      .filter((u) => {
        if (!u.department) return false
        const userDept = u.department.trim().toUpperCase()
        const isDeptMatch = userDept === targetDept
        const isActive = u.isActive !== false
        return isDeptMatch && isActive
      })

    console.log(`[AdminService] Found ${managers.length} managers for department: ${targetDept}`)
    return managers
  } catch (error) {
    console.error('[AdminService] Error in getDepartmentManagers:', error)
    throw error
  }
}
