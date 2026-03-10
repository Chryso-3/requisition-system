import { db, auth } from '@/firebase'
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
 * Get current counters for RF, Canvass, and PO
 */
export async function getCounters() {
  const year = new Date().getFullYear()
  const refs = {
    rf: doc(db, 'counters', 'requisitionRf'),
    canvass: doc(db, 'counters', `canvassNo_${year}`),
    po: doc(db, 'counters', `poNo_${year}`),
  }

  const [rfSnap, canvassSnap, poSnap] = await Promise.all([
    getDoc(refs.rf),
    getDoc(refs.canvass),
    getDoc(refs.po),
  ])

  return {
    rf: rfSnap.exists() ? rfSnap.data().lastNo || 0 : 0,
    canvass: canvassSnap.exists() ? canvassSnap.data().lastNo || 0 : 0,
    po: poSnap.exists() ? poSnap.data().lastNo || 0 : 0,
    year,
  }
}

/**
 * Manually override a counter value
 */
export async function setCounter(type, value) {
  const year = new Date().getFullYear()
  let ref
  if (type === 'rf') {
    ref = doc(db, 'counters', 'requisitionRf')
  } else if (type === 'canvass') {
    ref = doc(db, 'counters', `canvassNo_${year}`)
  } else if (type === 'po') {
    ref = doc(db, 'counters', `poNo_${year}`)
  } else {
    throw new Error('Invalid counter type')
  }

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
 * SUPPLIERS MANAGEMENT
 */

export async function getSuppliers() {
  const q = query(collection(db, COLLECTIONS.SUPPLIERS), orderBy('name', 'asc'))
  const snap = await getDocs(q)
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }))
}

export async function addSupplier(data) {
  const ref = collection(db, COLLECTIONS.SUPPLIERS)
  await addDoc(ref, {
    ...data,
    isActive: true,
    createdAt: serverTimestamp(),
  })
}

export async function updateSupplier(id, updates) {
  const ref = doc(db, COLLECTIONS.SUPPLIERS, id)
  await updateDoc(ref, {
    ...updates,
    updatedAt: serverTimestamp(),
  })
}
/**
 * API for Fetching Managers by Department (For Direct Assignment)
 * Fetches all users in the department PLUS OGM (Office of General Manager) users
 * since they act as global approvers. Filters in JS for robustness.
 */
export async function getDepartmentManagers(dept) {
  if (!dept) return []
  const managerRoles = [
    USER_ROLES.SECTION_HEAD,
    USER_ROLES.DIVISION_HEAD,
    USER_ROLES.DEPARTMENT_HEAD,
    USER_ROLES.GENERAL_MANAGER,
  ]

  const OGM = 'OFFICE OF GENERAL MANAGER'

  // Fetch from the target department OR OGM
  const q = query(
    collection(db, COLLECTIONS.USERS),
    where('department', 'in', [dept, OGM]),
    where('role', 'in', managerRoles),
  )

  const snap = await getDocs(q)

  return snap.docs
    .map((d) => ({
      uid: d.id,
      ...d.data(),
    }))
    .filter((u) => u.isActive !== false)
}
