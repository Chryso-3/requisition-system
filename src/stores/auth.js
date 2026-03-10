import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  updateProfile,
  signInWithPopup,
} from 'firebase/auth'
import { doc, setDoc, disableNetwork, enableNetwork } from 'firebase/firestore'
import { auth, db, googleProvider } from '@/firebase'
import { unsubscribeAllSubscriptions } from '@/services/requisitionService'
import { COLLECTIONS, USER_ROLES } from '@/firebase/collections'
import { httpsCallable } from 'firebase/functions'
import { functions } from '@/firebase'

export const useAuthStore = defineStore('auth', () => {
  const user = ref(null)
  const userProfile = ref(null)
  const loading = ref(true)

  const isAuthenticated = computed(() => !!user.value)
  const isSocialOnly = computed(() => {
    return user.value?.providerData.every((p) => p.providerId !== 'password') ?? false
  })
  const hasPassword = computed(() => {
    return user.value?.providerData.some((p) => p.providerId === 'password') ?? false
  })
  const displayName = computed(
    () =>
      userProfile.value?.displayName ??
      user.value?.displayName ??
      user.value?.email?.split('@')[0] ??
      'User',
  )
  const role = computed(() => userProfile.value?.role ?? USER_ROLES.REQUESTER)
  const department = computed(() => userProfile.value?.department ?? null)

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

    // REQUIRE OTP for email/password if configured (Placeholder logic for now)
    // In a real scenario, we might trigger the OTP send here and NOT set the user yet
    // or set a flag that they are "partially authenticated".
    // For this implementation, we will assume signIn completes the FIRST step.

    user.value = cred.user
    userProfile.value = profile
    loading.value = false
    return cred.user
  }

  async function signInWithGoogle() {
    const cred = await signInWithPopup(auth, googleProvider)

    // Check if user profile exists, if not create it
    const { getDoc, doc, setDoc } = await import('firebase/firestore')
    const snap = await getDoc(doc(db, COLLECTIONS.USERS, cred.user.uid))

    if (!snap.exists()) {
      const email = cred.user.email
      const displayName = cred.user.displayName || email.split('@')[0]
      const userRole = USER_ROLES.REQUESTER

      await setDoc(doc(db, COLLECTIONS.USERS, cred.user.uid), {
        email,
        displayName,
        role: userRole,
        createdAt: new Date().toISOString(),
        isActive: true,
      })
      userProfile.value = { displayName, role: userRole }
    } else {
      userProfile.value = snap.data()
    }

    user.value = cred.user
    loading.value = false
    return cred.user
  }

  async function sendOTP(email) {
    const sendOTPFunction = httpsCallable(functions, 'sendOTP')
    return await sendOTPFunction({ email })
  }

  async function verifyOTP(email, code) {
    const verifyOTPFunction = httpsCallable(functions, 'verifyOTP')
    const result = await verifyOTPFunction({ email, code })
    if (result.data?.success) {
      otpVerified.value = true
    }
    return result.data
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

  async function linkEmailPassword(email, password) {
    const { linkWithCredential, EmailAuthProvider } = await import('firebase/auth')
    const credential = EmailAuthProvider.credential(email, password)
    const result = await linkWithCredential(auth.currentUser, credential)
    user.value = result.user
    return result.user
  }

  return {
    user,
    userProfile,
    loading,
    isAuthenticated,
    isSocialOnly,
    hasPassword,
    displayName,
    role,
    department,
    setUser,
    signUp,
    signIn,
    signInWithGoogle,
    sendOTP,
    verifyOTP,
    signOut,
    loadUserProfile,
    updateUserProfile,
    linkEmailPassword,
    initAuthListener,
    waitForAuthReady,
  }
})
