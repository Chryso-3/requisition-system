import { db } from './src/firebase/index.js'
import { collection, getDocs } from 'firebase/firestore'
import { COLLECTIONS } from './src/firebase/collections.js'

async function debugUsers() {
  console.log('Fetching users...')
  const snap = await getDocs(collection(db, COLLECTIONS.USERS))
  snap.forEach((doc) => {
    const data = doc.data()
    console.log(
      `User: ${data.displayName} (${data.email}) | Role: ${data.role} | Active: ${data.isActive}`,
    )
  })
}

debugUsers().catch(console.error)
