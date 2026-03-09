const { onDocumentWritten } = require('firebase-functions/v2/firestore')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')

admin.initializeApp()

const db = admin.firestore()
const COLLECTIONS = {
  REQUISITIONS: 'requisitions',
  ANALYTICS: 'analytics',
  VERIFY_OTPS: 'verify_otps',
}
const SUMMARY_DOC_ID = 'summary'

const sgMail = require('@sendgrid/mail')
// NOTE: Set the SENDGRID_API_KEY using: firebase functions:config:set sendgrid.key="YOUR_KEY"
// or use process.env if using newer V2 secret management.
const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY || ''
if (SENDGRID_API_KEY) {
  sgMail.setApiKey(SENDGRID_API_KEY)
}

/**
 * Incremental analytics aggregator.
 * Triggered on any write (create, update, delete) to a requisition.
 */
exports.aggregateAnalytics = onDocumentWritten('requisitions/{reqId}', async (event) => {
  const before = event.data.before ? event.data.before.data() : null
  const after = event.data.after ? event.data.after.data() : null

  const updates = {
    lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
  }

  // Helper to safely increment nested fields
  const increment = (field, value = 1) => {
    updates[field] = admin.firestore.FieldValue.increment(value)
  }

  // 1. Handle Creation
  if (!before && after) {
    increment('total')
    if (after.status) increment(`byStatus.${after.status}`)
    if (after.department) increment(`byDepartment.${after.department}`)

    const monthKey = getMonthKey(after.createdAt || after.date)
    if (monthKey) {
      increment(`byMonth.${monthKey}.count`)
      if (isSpendRelevant(after.status)) {
        increment(`byMonth.${monthKey}.value`, calculateTotal(after.items))
      }
    }
  }

  // 2. Handle Deletion
  else if (before && !after) {
    increment('total', -1)
    if (before.status) increment(`byStatus.${before.status}`, -1)
    if (before.department) increment(`byDepartment.${before.department}`, -1)

    const monthKey = getMonthKey(before.createdAt || before.date)
    if (monthKey) {
      increment(`byMonth.${monthKey}.count`, -1)
      if (isSpendRelevant(before.status)) {
        increment(`byMonth.${monthKey}.value`, -calculateTotal(before.items))
      }
    }
  }

  // 3. Handle Update
  else if (before && after) {
    // Status Change
    if (before.status !== after.status) {
      if (before.status) increment(`byStatus.${before.status}`, -1)
      if (after.status) increment(`byStatus.${after.status}`, 1)
    }

    // Department Change
    if (before.department !== after.department) {
      if (before.department) increment(`byDepartment.${before.department}`, -1)
      if (after.department) increment(`byDepartment.${after.department}`, 1)
    }

    // Monthly Trend Update
    const oldMonth = getMonthKey(before.createdAt || before.date)
    const newMonth = getMonthKey(after.createdAt || after.date)
    const oldVal = calculateTotal(before.items)
    const newVal = calculateTotal(after.items)
    const wasRel = isSpendRelevant(before.status)
    const isRel = isSpendRelevant(after.status)

    if (oldMonth === newMonth) {
      if (wasRel && !isRel) {
        increment(`byMonth.${oldMonth}.value`, -oldVal)
      } else if (!wasRel && isRel) {
        increment(`byMonth.${oldMonth}.value`, newVal)
      } else if (wasRel && isRel && oldVal !== newVal) {
        increment(`byMonth.${oldMonth}.value`, newVal - oldVal)
      }
    } else {
      if (oldMonth) {
        increment(`byMonth.${oldMonth}.count`, -1)
        if (wasRel) increment(`byMonth.${oldMonth}.value`, -oldVal)
      }
      if (newMonth) {
        increment(`byMonth.${newMonth}.count`, 1)
        if (isRel) increment(`byMonth.${newMonth}.value`, newVal)
      }
    }

    // Purchase Status Change (for Requisition fulfillment tracking)
    const oldPS = before.purchaseStatus || 'pending'
    const newPS = after.purchaseStatus || 'pending'
    if (after.status === 'approved' || before.status === 'approved') {
      const wasApproved = before.status === 'approved'
      const isApproved = after.status === 'approved'

      if (!wasApproved && isApproved) {
        increment(`purchaseBreakdown.${newPS}`, 1)
      } else if (wasApproved && !isApproved) {
        increment(`purchaseBreakdown.${oldPS}`, -1)
      } else if (wasApproved && isApproved && oldPS !== newPS) {
        increment(`purchaseBreakdown.${oldPS}`, -1)
        increment(`purchaseBreakdown.${newPS}`, 1)
      }
    }

    // PO Status Change (for PO Approval Pipeline)
    const oldPOStatus = before.poStatus || null
    const newPOStatus = after.poStatus || null
    if (oldPOStatus !== newPOStatus) {
      if (oldPOStatus) increment(`poByStatus.${oldPOStatus}`, -1)
      if (newPOStatus) increment(`poByStatus.${newPOStatus}`, 1)
    }

    // Financial Spend (Departmental)
    if (isRel && !wasRel) {
      increment('totalApprovedValue', newVal)
      increment(`departmentalSpend.${after.department || 'Unknown'}`, newVal)
    } else if (!isRel && wasRel) {
      increment('totalApprovedValue', -oldVal)
      increment(`departmentalSpend.${before.department || 'Unknown'}`, -oldVal)
    } else if (isRel && wasRel) {
      const deptChanged = before.department !== after.department
      if (deptChanged) {
        increment(`departmentalSpend.${before.department || 'Unknown'}`, -oldVal)
        increment(`departmentalSpend.${after.department || 'Unknown'}`, newVal)
      } else if (oldVal !== newVal) {
        increment(`departmentalSpend.${after.department || 'Unknown'}`, newVal - oldVal)
      }
      if (oldVal !== newVal) {
        increment('totalApprovedValue', newVal - oldVal)
      }
    }

    // Velocity / Durations (Incremental Averages)
    updateDurations(before, after, increment)
  }

  if (Object.keys(updates).length > 1) {
    const summaryRef = db.collection(COLLECTIONS.ANALYTICS).doc(SUMMARY_DOC_ID)
    return summaryRef.set(updates, { merge: true })
  }
  return null
})

function updateDurations(before, after, increment) {
  const stages = [
    {
      key: 'submission_to_recommend',
      start: 'requestedBy.signedAt',
      end: 'recommendingApproval.signedAt',
    },
    {
      key: 'recommend_to_inventory',
      start: 'recommendingApproval.signedAt',
      end: 'inventoryChecked.signedAt',
    },
    {
      key: 'inventory_to_budget',
      start: 'inventoryChecked.signedAt',
      end: 'budgetApproved.signedAt',
    },
    { key: 'budget_to_audit', start: 'budgetApproved.signedAt', end: 'checkedBy.signedAt' },
    { key: 'audit_to_gm', start: 'checkedBy.signedAt', end: 'approvedBy.signedAt' },
    { key: 'gm_to_fulfillment', start: 'approvedBy.signedAt', end: ['receivedAt', 'archivedAt'] },

    // PO Approval Workflow Durations
    { key: 'req_appr_to_po_issue', start: 'approvedBy.signedAt', end: 'orderedAt' },
    { key: 'po_issue_to_po_budget', start: 'orderedAt', end: 'poBudgetApproved.signedAt' },
    {
      key: 'po_budget_to_po_audit',
      start: 'poBudgetApproved.signedAt',
      end: 'poAuditApproved.signedAt',
    },
    { key: 'po_audit_to_po_gm', start: 'poAuditApproved.signedAt', end: 'poGMApproved.signedAt' },
  ]

  stages.forEach((stage) => {
    const oldDur = getDuration(before, stage.start, stage.end)
    const newDur = getDuration(after, stage.start, stage.end)

    if (newDur !== null && oldDur === null) {
      increment(`durations.${stage.key}.totalMs`, newDur)
      increment(`durations.${stage.key}.count`, 1)
    } else if (newDur === null && oldDur !== null) {
      increment(`durations.${stage.key}.totalMs`, -oldDur)
      increment(`durations.${stage.key}.count`, -1)
    } else if (newDur !== null && oldDur !== null && newDur !== oldDur) {
      increment(`durations.${stage.key}.totalMs`, newDur - oldDur)
    }
  })
}

function getDuration(doc, startField, endField) {
  const startVal = getVal(doc, startField)
  const endVal = getVal(doc, endField)
  if (!startVal || !endVal) return null
  const start = toDate(startVal)
  const end = toDate(endVal)
  if (!start || !end) return null
  return end - start
}

function getVal(obj, path) {
  if (Array.isArray(path)) {
    for (const p of path) {
      const v = getVal(obj, p)
      if (v) return v
    }
    return null
  }
  return path.split('.').reduce((acc, part) => acc && acc[part], obj)
}

function toDate(val) {
  if (!val) return null
  const d = val.toDate ? val.toDate() : new Date(val)
  return isNaN(d.getTime()) ? null : d
}

function getMonthKey(dateInput) {
  if (!dateInput) return null
  const date = toDate(dateInput)
  if (!date) return null
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function calculateTotal(items = []) {
  return items.reduce((sum, item) => {
    const qty = parseFloat(item.quantity) || 0
    const price = parseFloat(item.unitPrice) || 0
    return sum + qty * price
  }, 0)
}

function isSpendRelevant(status) {
  return status === 'approved' || status === 'received'
}
/**
 * Securely generates the next Requisition Control Number (RF-YYYY-000000).
 * Uses a transaction to prevent duplicates in high-concurrency scenarios.
 */
exports.generateRFNumber = onCall({ cors: true, maxInstances: 10 }, async (request) => {
  console.log('[generateRFNumber] Request received')

  // Check auth
  if (!request.auth) {
    console.error('[generateRFNumber] Unauthenticated request')
    throw new HttpsError('unauthenticated', 'The function must be called while authenticated.')
  }

  const counterRef = db.collection('counters').doc('requisitionRf')

  try {
    const result = await db.runTransaction(async (transaction) => {
      const counterDoc = await transaction.get(counterRef)
      let nextNo = 1
      if (counterDoc.exists) {
        nextNo = (counterDoc.data().lastNo || 0) + 1
      }

      transaction.set(counterRef, { lastNo: nextNo }, { merge: true })

      const year = new Date().getFullYear()
      const formattedNo = String(nextNo).padStart(6, '0')
      const rfNumber = `RF-${year}-${formattedNo}`
      console.log(`[generateRFNumber] Generated ${rfNumber}`)
      return rfNumber
    })

    return { rfNumber: result }
  } catch (error) {
    console.error('[generateRFNumber] Transaction Error:', error)
    // Specifically catch and rethrow as HttpsError so it's not just "internal"
    throw new HttpsError('internal', error.message || 'Transactional error occurred')
  }
})
