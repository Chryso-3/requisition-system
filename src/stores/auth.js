import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  updateProfile,
} from 'firebase/auth'
import { doc, setDoc, disableNetwork, enableNetwork } from 'firebase/firestore'
import { auth, db } from '@/firebase'
import { unsubscribeAllSubscriptions } from '@/services/requisitionService'
import { COLLECTIONS, USER_ROLES } from '@/firebase/collections'

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const userProfile = ref(null)
  const loading = ref(true)

  const isAuthenticated = computed(() => !!user.value)
  const displayName = computed(
    () =>
      userProfile.value?.displayName ??
      user.value?.displayName ??
      user.value?.email?.split('@')[0] ??
      'User',
  )
  const role = computed(() => userProfile.value?.role ?? USER_ROLES.REQUESTER)

  function setUser(u) {
    user.value = u
  }

  async function signUp(email, password, displayName, role = USER_ROLES.REQUESTER) {
    const cred = await createUserWithEmailAndPassword(auth, email, password)
    if (displayName) {
      await updateProfile(cred.user, { displayName })
    }
    const userRole = role || USER_ROLES.REQUESTER
    await setDoc(doc(db, COLLECTIONS.USERS, cred.user.uid), {
      email,
      displayName: displayName || email.split('@')[0],
      role: userRole,
      createdAt: new Date().toISOString(),
    })
    userProfile.value = { displayName: displayName || email.split('@')[0], role: userRole }
    user.value = cred.user
    return cred.user
  }

  async function signIn(email, password) {
    const cred = await signInWithEmailAndPassword(auth, email, password)

    // Load profile immediately to check if active
    const { getDoc, doc } = await import('firebase/firestore')
    const snap = await getDoc(doc(db, COLLECTIONS.USERS, cred.user.uid))
    const profile = snap.exists() ? snap.data() : null

    if (profile && profile.isActive === false) {
      await firebaseSignOut(auth)
      const error = new Error(
        'Your account has been deactivated. Please contact your administrator.',
      )
      error.code = 'auth/user-deactivated'
      throw error
    }

    user.value = cred.user
    userProfile.value = profile
    loading.value = false
    return cred.user
  }

  async function signOut() {
    try {
      // unsubscribe live listeners first to avoid any polling callbacks
      unsubscribeAllSubscriptions()
      await firebaseSignOut(auth)
    } catch (e) {
      // ignore signOut network errors
    }
    user.value = null
    userProfile.value = null
  }

  let initPromise = null
  function initAuthListener() {
    if (initPromise) return initPromise
    initPromise = new Promise((resolve) => {
      onAuthStateChanged(auth, async (u) => {
        loading.value = true
        user.value = u
        if (u) {
          try {
            await loadUserProfile(u.uid)
          } catch {
            userProfile.value = null
          }
        } else {
          userProfile.value = null
        }
        loading.value = false
        resolve()
      })
    })
    return initPromise
  }

  /** Wait until profile is loaded (so role is correct) before navigating after login */
  function waitForAuthReady() {
    if (!loading.value) return Promise.resolve()
    return new Promise((resolve) => {
      const stop = watch(
        loading,
        (v) => {
          if (!v) {
            stop()
            resolve()
          }
        },
        { immediate: true },
      )
    })
  }

  async function loadUserProfile(uid) {
    const { getDoc } = await import('firebase/firestore')
    const snap = await getDoc(doc(db, COLLECTIONS.USERS, uid))
    userProfile.value = snap.exists() ? snap.data() : null
  }

  /** Update profile in Firestore (and Auth displayName/photoURL if provided). Merge with existing. */
  async function updateUserProfile(updates) {
    const uid = user.value?.uid
    if (!uid) return
    const authUpdates = {}
    if (updates.displayName != null) authUpdates.displayName = updates.displayName
    if (updates.photoURL != null) authUpdates.photoURL = updates.photoURL
    if (Object.keys(authUpdates).length) {
      await updateProfile(auth.currentUser, authUpdates)
    }
    await setDoc(doc(db, COLLECTIONS.USERS, uid), updates, { merge: true })
    await loadUserProfile(uid)
  }

  return {
    user,
    userProfile,
    loading,
    isAuthenticated,
    displayName,
    role,
    setUser,
    signUp,
    signIn,
    signOut,
    loadUserProfile,
    updateUserProfile,
    initAuthListener,
    waitForAuthReady,
  }
})
