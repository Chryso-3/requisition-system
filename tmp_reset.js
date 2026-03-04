/**
 * DANGEROUS: Clears all testing data (Requisitions, Logs, Analytics, Signatures).
 * Reset counters to 0.
 * ONLY for SUPER_ADMIN use during development/testing.
 */
export async function clearAllTestingData(userProfile) {
  if (userProfile?.role !== USER_ROLES.SUPER_ADMIN) {
    throw new Error('Unauthorized: Only Super Administrators can reset the database.')
  }

  const collectionsToClear = [
    COLLECTIONS.REQUISITIONS,
    COLLECTIONS.TRANSACTION_LOG,
    COLLECTIONS.INTERNAL_AUDIT_LOG,
    COLLECTIONS.REQUISITION_SIGNATURES,
    COLLECTIONS.ANALYTICS,
  ]

  let totalDeleted = 0

  for (const collName of collectionsToClear) {
    const snap = await getDocs(collection(db, collName))
    if (snap.empty) continue

    // Delete in batches of 500 (Firestore limit)
    const docs = snap.docs
    for (let i = 0; i < docs.length; i += 500) {
      const batch = writeBatch(db)
      const chunk = docs.slice(i, i + 500)
      chunk.forEach((d) => batch.delete(d.ref))
      await batch.commit()
      totalDeleted += chunk.length
    }
  }

  // Reset basic counters
  const currentYear = new Date().getFullYear()
  const countersToReset = ['requisitionRf', `canvassNo_${currentYear}`, `poNo_${currentYear}`]

  for (const cId of countersToReset) {
    await setDoc(doc(db, 'counters', cId), { lastNo: 0 }, { merge: false })
  }

  // Re-seed analytics summary as empty
  await setDoc(doc(db, COLLECTIONS.ANALYTICS, 'summary'), {
    total: 0,
    byStatus: {},
    byDept: {},
    lastUpdated: serverTimestamp(),
  })

  return totalDeleted
}
