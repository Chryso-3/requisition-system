import { initializeApp, getApp, getApps } from 'firebase/app'
import { initializeFirestore, getFirestore, persistentLocalCache } from 'firebase/firestore'
import { getAuth } from 'firebase/auth'
import { getStorage } from 'firebase/storage'
import { getFunctions } from 'firebase/functions'
import { getAnalytics, isSupported } from 'firebase/analytics'

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
}

// Singleton Firebase App
const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp()

// Singleton Firestore instance with specific settings
let dbInstance
try {
  dbInstance = getFirestore(app)
} catch (e) {
  // If not initialized, do it once with custom settings
  dbInstance = initializeFirestore(app, {
    localCache: persistentLocalCache(),
    experimentalForceLongPolling: true,
  })
}

export const db = dbInstance

export const auth = getAuth(app)
export const storage = getStorage(app)
export const functions = getFunctions(app, 'us-central1')

// Analytics (browser only)
let analytics = null
isSupported().then((yes) => {
  if (yes) analytics = getAnalytics(app)
})
export { analytics }

// Auth Providers
import { GoogleAuthProvider } from 'firebase/auth'
export const googleProvider = new GoogleAuthProvider()

export default app
