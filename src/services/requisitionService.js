import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  writeBatch,
  increment,
  getCountFromServer,
} from 'firebase/firestore'
import { db } from '../firebase'
import * as notificationService from './notificationService'

/** Default page size for list views (keeps reads and UI responsive with many users/requests). */
export const REQUISITION_PAGE_SIZE = 50
/** Max requisitions in a single query (cap for admin/export). */
export const REQUISITION_LIST_LIMIT = 5000
import {
  COLLECTIONS,
  REQUISITION_STATUS,
  PURCHASE_STATUS,
  CANVASS_STATUS,
  PO_STATUS,
  USER_ROLES,
} from '../firebase/collections'

let cachedDepartments = []

/** Fetches departments from Firestore and caches them. */
export async function getDepartments() {
  if (cachedDepartments.length > 0) return cachedDepartments
  try {
    const q = query(collection(db, COLLECTIONS.DEPARTMENTS), orderBy('name', 'asc'))
    const snap = await getDocs(q)
    cachedDepartments = snap.docs.map((d) => d.data().name)
    return cachedDepartments
  } catch (error) {
    console.error('[requisitionService] Error fetching departments:', error)
    return []
  }
}

/** Synchronous version of department normalization. Requires pre-fetched departments array. */
export function normalizeDepartmentSync(val, departments = []) {
  if (!val) return '—'
  const t = String(val).trim()
  if (!t) return '—'

  // Match canonical department names case-insensitively
  const match = departments.find((d) => d.toLowerCase() === t.toLowerCase())
  if (match) return match

  const collapsed = t.replace(/\s+/g, ' ').toUpperCase()
  const match2 = departments.find((d) => d.toUpperCase() === collapsed)
  if (match2) return match2
  return t
}

async function normalizeDepartment(val) {
  const departments = await getDepartments()
  return normalizeDepartmentSync(val, departments)
}

/**
 * Resilient subscription helper: tries onSnapshot and falls back to polling when Listen fails.
 * refOrQuery: DocumentReference or Query
 * isQuery: true for Query (getDocs), false for DocumentReference (getDoc)
 * onData: callback receiving a Snapshot (QuerySnapshot or DocumentSnapshot)
 * onError: optional error handler
 * opts: { pollInterval }
 * Returns unsubscribe function
 */
function subscribeWithFallback(refOrQuery, isQuery, onData, onError, opts = {}) {
  const pollInterval = opts.pollInterval ?? 15000
  let pollTimer = null
  let stopped = false

  const startPolling = () => {
    if (pollTimer) return
    const poll = async () => {
      try {
        if (isQuery) {
          const snap = await getDocs(refOrQuery)
          onData(snap)
        } else {
          const snap = await getDoc(refOrQuery)
          onData(snap)
        }
      } catch (e) {
        // ignore polling errors; call onError once
        if (onError && !stopped) onError(e)
      }
    }
    // run immediately, then interval
    poll()
    pollTimer = setInterval(poll, pollInterval)
  }

  try {
    const unsub = onSnapshot(
      refOrQuery,
      (snap) => {
        if (!stopped) onData(snap)
      },
      (err) => {
        if (onError) onError(err)
        // fallback to polling
        startPolling()
      },
    )

    // wrap unsub so we can track active subscriptions
    const wrapped = () => {
      stopped = true
      if (pollTimer) clearInterval(pollTimer)
      try {
        unsub()
      } catch (_) {}
      try {
        activeUnsubscribers.delete(wrapped)
      } catch (_) {}
    }
    try {
      activeUnsubscribers.add(wrapped)
    } catch (_) {}
    return wrapped
  } catch (e) {
    if (onError) onError(e)
    // start polling immediately
    startPolling()
    const wrappedPollOnly = () => {
      stopped = true
      if (pollTimer) clearInterval(pollTimer)
      try {
        activeUnsubscribers.delete(wrappedPollOnly)
      } catch (_) {}
    }
    try {
      activeUnsubscribers.add(wrappedPollOnly)
    } catch (_) {}
    return wrappedPollOnly
  }
}

// Registry of active subscription cleanup functions registered by subscribeWithFallback
const activeUnsubscribers = new Set()

/** Call to unsubscribe all active subscriptions (useful before sign-out). */
export function unsubscribeAllSubscriptions() {
  for (const u of Array.from(activeUnsubscribers)) {
    try {
      u()
    } catch (_) {}
  }
  activeUnsubscribers.clear()
}

/**
 * Finds users with multiple roles. Returns full user data objects to allow department filtering.
 */
export async function getEmailsByRoles(roles) {
  try {
    const q = query(collection(db, COLLECTIONS.USERS), where('role', 'in', roles))
    const snap = await getDocs(q)

    return snap.docs.map((d) => d.data()).filter((data) => data.isActive !== false)
  } catch (error) {
    console.error(`[getEmailsByRoles] Error fetching for roles ${roles}:`, error)
    return []
  }
}

/**
 * Finds users with a specific role and returns their email addresses.
 * Used for routing notifications.
 */
export async function getEmailsByRole(role) {
  try {
    const q = query(collection(db, COLLECTIONS.USERS), where('role', '==', role))
    const snap = await getDocs(q)
    return snap.docs
      .map((d) => d.data())
      .filter((u) => u.isActive !== false && u.email)
      .map((u) => u.email)
  } catch (error) {
    console.error('[requisitionService] Error fetching emails by role:', error)
    return []
  }
}

export { REQUISITION_STATUS }

// ---------------------------------------------------------------------------
// Analytics Summary Helpers
// ---------------------------------------------------------------------------

const ANALYTICS_SUMMARY_ID = 'summary'

/**
 * Subscribe to the analytics/summary document for realtime KPI updates.
 */
export function subscribeAnalyticsSummary(onData, onError) {
  const ref = doc(db, COLLECTIONS.ANALYTICS, ANALYTICS_SUMMARY_ID)
  return subscribeWithFallback(
    ref,
    false,
    (snap) => {
      if (snap.exists()) {
        onData(snap.data())
      } else {
        onData(null)
      }
    },
    onError,
  )
}

/**
 * One-time seed: scans all existing requisitions and builds the analytics/summary document.
 * Safe to call multiple times — it OVERWRITES the summary from scratch.
 * Should be called by an admin from the Analytics page after major data migrations.
 */
export async function seedAnalyticsSummary() {
  const base = collection(db, COLLECTIONS.REQUISITIONS)
  // Use getDocs without orderBy to ensure we don't skip docs missing the 'createdAt' field
  const snap = await getDocs(query(base, limit(REQUISITION_LIST_LIMIT)))
  const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  console.log(`[Seeding] Found ${docs.length} requisitions to process.`)

  const departments = await getDepartments()
  const now = new Date()
  const thisMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const summary = {
    total: docs.length,
    byStatus: {},
    byDepartment: {},
    byMonth: {},
    purchaseBreakdown: { pending: 0, ordered: 0, received: 0 },
    poByStatus: {},
    totalApprovedValue: 0,
    departmentalSpend: {},
    durations: {},
    summary: {
      pendingApproval: 0,
      approvedThisMonth: 0,
      rejectedThisMonth: 0,
      approvedPct: 0,
      rejectedPct: 0,
      avgLeadTimeDays: '—',
      totalApprovedValue: 0,
      avgOrderValue: 0,
    },
    lastUpdated: serverTimestamp(),
  }

  let totalLeadTimeMs = 0
  let leadTimeCount = 0
  let totalApprovedCount = 0
  let totalRejectedCount = 0

  docs.forEach((r) => {
    // Status counts
    const s = r.status || 'draft'
    summary.byStatus[s] = (summary.byStatus[s] || 0) + 1

    // Department counts
    const dept = normalizeDepartmentSync(r.department, departments)
    summary.byDepartment[dept] = (summary.byDepartment[dept] || 0) + 1

    // Monthly counts (createdAt)
    const rawDate = r.createdAt?.toDate
      ? r.createdAt.toDate()
      : r.createdAt
        ? new Date(r.createdAt)
        : null
    const monthKey =
      rawDate && !Number.isNaN(rawDate.getTime())
        ? `${rawDate.getFullYear()}-${String(rawDate.getMonth() + 1).padStart(2, '0')}`
        : null

    if (monthKey) {
      if (!summary.byMonth[monthKey]) {
        summary.byMonth[monthKey] = {
          count: 0,
          value: 0,
          approved: 0,
          rejected: 0,
          leadTimeMs: 0,
          leadTimeCount: 0,
          byStatus: {},
          byDepartment: {},
          poByStatus: {},
          durations: {},
          purchaseBreakdown: { pending: 0, ordered: 0, received: 0 },
          departmentalSpend: {},
        }
      }
      summary.byMonth[monthKey].count++
      summary.byMonth[monthKey].byStatus[s] = (summary.byMonth[monthKey].byStatus[s] || 0) + 1
      summary.byMonth[monthKey].byDepartment[dept] =
        (summary.byMonth[monthKey].byDepartment[dept] || 0) + 1
    }

    const archDate = toDate(r.archivedAt || r.approvedAt)
    const archMonthKey =
      archDate && !Number.isNaN(archDate.getTime())
        ? `${archDate.getFullYear()}-${String(archDate.getMonth() + 1).padStart(2, '0')}`
        : null

    // Financials & Purchase
    const isRel = s === REQUISITION_STATUS.APPROVED || r.purchaseStatus === PURCHASE_STATUS.RECEIVED
    if (isRel) {
      const val = (r.items || []).reduce(
        (sum, i) => sum + (parseFloat(i.quantity) || 0) * (parseFloat(i.unitPrice) || 0),
        0,
      )
      summary.totalApprovedValue += val
      summary.departmentalSpend[dept] = (summary.departmentalSpend[dept] || 0) + val
      // Burn (value) should be mapped to the ARCHIVE month (when it was approved/spent)
      if (archMonthKey) {
        if (!summary.byMonth[archMonthKey]) {
          summary.byMonth[archMonthKey] = {
            count: 0,
            value: 0,
            approved: 0,
            rejected: 0,
            leadTimeMs: 0,
            leadTimeCount: 0,
            byStatus: {},
            byDepartment: {},
            poByStatus: {},
            durations: {},
            purchaseBreakdown: { pending: 0, ordered: 0, received: 0 },
            departmentalSpend: {},
          }
        }
        summary.byMonth[archMonthKey].value += val
        summary.byMonth[archMonthKey].departmentalSpend[dept] =
          (summary.byMonth[archMonthKey].departmentalSpend[dept] || 0) + val
      }
    }

    // Global status buckets
    if (s === REQUISITION_STATUS.APPROVED) {
      totalApprovedCount++
      // Use archMonthKey for summary approved this month
      if (archMonthKey === thisMonthKey) summary.summary.approvedThisMonth++
      if (archMonthKey) {
        if (!summary.byMonth[archMonthKey]) {
          summary.byMonth[archMonthKey] = {
            count: 0,
            value: 0,
            approved: 0,
            rejected: 0,
            leadTimeMs: 0,
            leadTimeCount: 0,
          }
        }
        summary.byMonth[archMonthKey].approved++
      }

      const ps = r.purchaseStatus || PURCHASE_STATUS.PENDING
      summary.purchaseBreakdown[ps] = (summary.purchaseBreakdown[ps] || 0) + 1
      if (archMonthKey) {
        if (!summary.byMonth[archMonthKey].purchaseBreakdown) {
          summary.byMonth[archMonthKey].purchaseBreakdown = { pending: 0, ordered: 0, received: 0 }
        }
        summary.byMonth[archMonthKey].purchaseBreakdown[ps] =
          (summary.byMonth[archMonthKey].purchaseBreakdown[ps] || 0) + 1
      }

      const pos = r.poStatus || null
      if (pos) {
        summary.poByStatus[pos] = (summary.poByStatus[pos] || 0) + 1
        if (archMonthKey) {
          if (!summary.byMonth[archMonthKey].poByStatus)
            summary.byMonth[archMonthKey].poByStatus = {}
          summary.byMonth[archMonthKey].poByStatus[pos] =
            (summary.byMonth[archMonthKey].poByStatus[pos] || 0) + 1
        }
      }
    } else if (s === REQUISITION_STATUS.REJECTED) {
      totalRejectedCount++
      // Use archMonthKey for summary rejected this month
      if (archMonthKey === thisMonthKey) summary.summary.rejectedThisMonth++
      if (archMonthKey) {
        if (!summary.byMonth[archMonthKey]) {
          summary.byMonth[archMonthKey] = {
            count: 0,
            value: 0,
            approved: 0,
            rejected: 0,
            leadTimeMs: 0,
            leadTimeCount: 0,
          }
        }
        summary.byMonth[archMonthKey].rejected++
      }
    } else if (s !== REQUISITION_STATUS.DRAFT) {
      summary.summary.pendingApproval++
    }

    // Lead Time calculation (Submission to Archive/End)
    const createdRaw = r.createdAt?.toDate
      ? r.createdAt.toDate()
      : r.createdAt
        ? new Date(r.createdAt)
        : null
    const created = toDate(r.createdAt || r.date)
    const fallbackStart = createdRaw || created || new Date()

    const endAt = archDate
    if (created) {
      if (endAt && (s === REQUISITION_STATUS.APPROVED || s === REQUISITION_STATUS.REJECTED)) {
        const diff = Math.max(0, endAt - created)
        totalLeadTimeMs += diff
        leadTimeCount++
        if (archMonthKey) {
          if (!summary.byMonth[archMonthKey]) {
            summary.byMonth[archMonthKey] = {
              count: 0,
              value: 0,
              approved: 0,
              rejected: 0,
              leadTimeMs: 0,
              leadTimeCount: 0,
            }
          }
          summary.byMonth[archMonthKey].leadTimeMs += diff
          summary.byMonth[archMonthKey].leadTimeCount++
        }
      } else if (s !== REQUISITION_STATUS.DRAFT) {
        // Real-time aging for active items
        const diff = Math.max(0, now - created)
        totalLeadTimeMs += diff
        leadTimeCount++
        if (monthKey) {
          summary.byMonth[monthKey].leadTimeMs += diff
          summary.byMonth[monthKey].leadTimeCount++
        }
      }
    }

    // Durations (Simple seeding for velocity)
    const stages = [
      {
        key: 'submission_to_recommend',
        start: r.requestedBy?.signedAt || fallbackStart,
        end: r.recommendingApproval?.signedAt,
      },
      {
        key: 'recommend_to_inventory',
        start: r.recommendingApproval?.signedAt || r.requestedBy?.signedAt || fallbackStart,
        end: r.inventoryChecked?.signedAt,
      },
      {
        key: 'inventory_to_budget',
        start: r.inventoryChecked?.signedAt || r.recommendingApproval?.signedAt || fallbackStart,
        end: r.budgetApproved?.signedAt,
      },
      {
        key: 'budget_to_audit',
        start: r.budgetApproved?.signedAt || r.inventoryChecked?.signedAt || fallbackStart,
        end: r.checkedBy?.signedAt,
      },
      {
        key: 'audit_to_gm',
        start: r.checkedBy?.signedAt || r.budgetApproved?.signedAt || fallbackStart,
        end: r.approvedBy?.signedAt,
      },
      {
        key: 'gm_to_fulfillment',
        start: r.approvedBy?.signedAt || r.checkedBy?.signedAt || fallbackStart,
        end: r.receivedAt || r.archivedAt,
      },

      // PO Approval Workflow Durations
      {
        key: 'req_appr_to_po_issue',
        start: r.approvedBy?.signedAt || fallbackStart,
        end: r.orderedAt,
      },
      {
        key: 'po_issue_to_po_budget',
        start: r.orderedAt || r.approvedBy?.signedAt || fallbackStart,
        end: r.poBudgetApproved?.signedAt,
      },
      {
        key: 'po_budget_to_po_audit',
        start: r.poBudgetApproved?.signedAt || r.orderedAt || fallbackStart,
        end: r.poAuditApproved?.signedAt,
      },
      {
        key: 'po_audit_to_po_gm',
        start: r.poAuditApproved?.signedAt || r.poBudgetApproved?.signedAt || fallbackStart,
        end: r.poGMApproved?.signedAt,
      },
    ]

    stages.forEach((stage) => {
      const start = stage.start
        ? stage.start.toDate
          ? stage.start.toDate()
          : new Date(stage.start)
        : null
      const end = stage.end ? (stage.end.toDate ? stage.end.toDate() : new Date(stage.end)) : null

      if (!summary.durations[stage.key]) {
        summary.durations[stage.key] = { totalMs: 0, count: 0, activeTotalMs: 0, activeCount: 0 }
      }

      if (start && end && !isNaN(start.getTime()) && !isNaN(end.getTime())) {
        summary.durations[stage.key].totalMs += Math.max(0, end - start)
        summary.durations[stage.key].count++
        if (monthKey) {
          if (!summary.byMonth[monthKey].durations[stage.key]) {
            summary.byMonth[monthKey].durations[stage.key] = { totalMs: 0, count: 0 }
          }
          summary.byMonth[monthKey].durations[stage.key].totalMs += Math.max(0, end - start)
          summary.byMonth[monthKey].durations[stage.key].count++
        }
      } else if (start && !end && !isNaN(start.getTime())) {
        // Active item logic
        // Check if this item is currently in this stage
        let isInThisStage = false
        if (
          stage.key === 'submission_to_recommend' &&
          s === REQUISITION_STATUS.PENDING_RECOMMENDATION
        )
          isInThisStage = true
        else if (
          stage.key === 'recommend_to_inventory' &&
          s === REQUISITION_STATUS.PENDING_INVENTORY
        )
          isInThisStage = true
        else if (stage.key === 'inventory_to_budget' && s === REQUISITION_STATUS.PENDING_BUDGET)
          isInThisStage = true
        else if (stage.key === 'budget_to_audit' && s === REQUISITION_STATUS.PENDING_AUDIT)
          isInThisStage = true
        else if (stage.key === 'audit_to_gm' && s === REQUISITION_STATUS.PENDING_APPROVAL)
          isInThisStage = true
        else if (
          stage.key === 'gm_to_fulfillment' &&
          s === REQUISITION_STATUS.APPROVED &&
          (r.purchaseStatus || PURCHASE_STATUS.PENDING) === PURCHASE_STATUS.PENDING
        )
          isInThisStage = true
        else if (
          stage.key === 'req_appr_to_po_issue' &&
          s === REQUISITION_STATUS.APPROVED &&
          !r.poStatus
        )
          isInThisStage = true
        else if (stage.key === 'po_issue_to_po_budget' && r.poStatus === PO_STATUS.PENDING_BUDGET)
          isInThisStage = true
        else if (stage.key === 'po_budget_to_po_audit' && r.poStatus === PO_STATUS.PENDING_AUDIT)
          isInThisStage = true
        else if (stage.key === 'po_audit_to_po_gm' && r.poStatus === PO_STATUS.PENDING_GM)
          isInThisStage = true

        if (isInThisStage) {
          summary.durations[stage.key].activeTotalMs += Math.max(0, now - start)
          summary.durations[stage.key].activeCount++
          if (monthKey) {
            if (!summary.byMonth[monthKey].durations[stage.key]) {
              summary.byMonth[monthKey].durations[stage.key] = {
                totalMs: 0,
                count: 0,
                activeTotalMs: 0,
                activeCount: 0,
              }
            }
            summary.byMonth[monthKey].durations[stage.key].activeTotalMs += Math.max(0, now - start)
            summary.byMonth[monthKey].durations[stage.key].activeCount++
          }
        }
      }
    })
  })

  // Finalize global summary KPIs
  const allDecisions = totalApprovedCount + totalRejectedCount
  summary.summary.approvedPct =
    allDecisions > 0 ? Math.round((totalApprovedCount / allDecisions) * 100) : 0
  summary.summary.rejectedPct =
    allDecisions > 0 ? Math.round((totalRejectedCount / allDecisions) * 100) : 0
  summary.summary.totalApprovedValue = summary.totalApprovedValue
  summary.summary.avgLeadTimeDays =
    leadTimeCount > 0 ? (totalLeadTimeMs / leadTimeCount / (1000 * 60 * 60 * 24)).toFixed(1) : '—'
  summary.summary.avgOrderValue =
    totalApprovedCount > 0 ? summary.totalApprovedValue / totalApprovedCount : 0

  const ref = doc(db, COLLECTIONS.ANALYTICS, ANALYTICS_SUMMARY_ID)
  await setDoc(ref, summary)
  return docs.length
}

/**
 * Save an e-signature as a separate document (base64) to avoid the 1MB requisition doc limit.
 * One doc per requisition + roleKey.
 * roleKey: requestedBy | recommendingApproval | inventoryChecked | budgetApproved | checkedBy | approvedBy
 */
export async function upsertRequisitionSignature(requisitionId, roleKey, data) {
  if (!requisitionId || !roleKey) throw new Error('Missing requisitionId/roleKey')
  const sigId = `${requisitionId}_${roleKey}`
  const ref = doc(db, COLLECTIONS.REQUISITION_SIGNATURES, sigId)
  await setDoc(
    ref,
    {
      requisitionId,
      roleKey,
      userId: data?.userId ?? null,
      name: data?.name ?? null,
      title: data?.title ?? null,
      signedAt: data?.signedAt ?? new Date().toISOString(),
      signatureData: data?.signatureData ?? null,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
  return sigId
}

/**
 * Save a single quote document (Base64) to Firestore.
 */
export async function upsertRequisitionQuote(requisitionId, name, base64) {
  if (!requisitionId || !base64) return
  const quoteId = `${requisitionId}_${name}`
  const ref = doc(db, COLLECTIONS.REQUISITION_QUOTES, quoteId)
  await setDoc(
    ref,
    {
      requisitionId,
      name,
      base64,
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  )
}

/** Fetch all quotes for a requisition. */
export async function getRequisitionQuotes(requisitionId) {
  if (!requisitionId) return []
  const q = query(
    collection(db, COLLECTIONS.REQUISITION_QUOTES),
    where('requisitionId', '==', requisitionId),
  )
  const snap = await getDocs(q)
  const results = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
  // Sort client-side to avoid mandatory composite index
  return results.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
}

/** Subscribe to quote docs for a requisition. */
export function subscribeRequisitionQuotes(requisitionId, onData, onError) {
  if (!requisitionId) return () => {}
  const q = query(
    collection(db, COLLECTIONS.REQUISITION_QUOTES),
    where('requisitionId', '==', requisitionId),
  )
  return subscribeWithFallback(
    q,
    true,
    (snapshot) => {
      const results = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))
      // Robustness: Filter by unique name to avoid orphaned duplicates
      const uniqueMap = {}
      for (const item of results) {
        if (!uniqueMap[item.name]) {
          uniqueMap[item.name] = item
        }
      }
      const finalResults = Object.values(uniqueMap)
      // Sort client-side
      onData(finalResults.sort((a, b) => (a.name || '').localeCompare(b.name || '')))
    },
    onError,
  )
}

/** Load all signature docs for a requisition. Returns map by roleKey. */
export async function getRequisitionSignatures(requisitionId) {
  if (!requisitionId) return {}
  const q = query(
    collection(db, COLLECTIONS.REQUISITION_SIGNATURES),
    where('requisitionId', '==', requisitionId),
  )
  const snap = await getDocs(q)
  const map = {}
  for (const d of snap.docs) {
    const v = d.data()
    if (v?.roleKey) map[v.roleKey] = v
  }
  return map
}

/** Subscribe to signature docs for a requisition. callback(mapByRoleKey). */
export function subscribeRequisitionSignatures(requisitionId, callback, onError) {
  if (!requisitionId) return () => {}
  const q = query(
    collection(db, COLLECTIONS.REQUISITION_SIGNATURES),
    where('requisitionId', '==', requisitionId),
  )
  return subscribeWithFallback(
    q,
    true,
    (snap) => {
      const map = {}
      for (const d of snap.docs) {
        const v = d.data()
        if (v?.roleKey) map[v.roleKey] = v
      }
      callback(map)
    },
    (err) => {
      if (onError) onError(err)
    },
  )
}

/**
 * Requisition item structure (matches form table)
 */
export const createRequisitionItem = (data = {}) => ({
  quantity: data.quantity ?? 0,
  unit: data.unit ?? 'pcs',
  description: data.description ?? '',
  remarks: data.remarks ?? '',
  brand: data.brand ?? '',
  unitPrice: data.unitPrice ?? 0,
})

/**
 * Full requisition document structure (based on Leyeco III form)
 */
export const createRequisition = (data = {}) => ({
  // Control & metadata
  rfControlNo: data.rfControlNo ?? '',
  date: data.date ?? new Date().toISOString().split('T')[0],
  department: data.department ?? '',
  purpose: data.purpose ?? '',
  status: data.status ?? REQUISITION_STATUS.DRAFT,
  pbacFormNo: data.pbacFormNo ?? '',

  // Requested items (array of items)
  items: (data.items ?? []).map(createRequisitionItem),

  // Purchase Order specific extension
  supplier: data.supplier ?? '',
  poNumber: data.poNumber ?? '',
  poStatus: data.poStatus ?? null,
  orderedAt: data.orderedAt ?? null,
  orderedBy: data.orderedBy ?? null,
  purchaseStatus: data.purchaseStatus ?? null,
  canvassStatus: data.canvassStatus ?? null,

  // Approval workflow - user IDs and timestamps
  assignedApproverId: data.assignedApproverId ?? null,
  assignedApproverName: data.assignedApproverName ?? null,
  assignedApproverRole: data.assignedApproverRole ?? null,
  requestedBy: data.requestedBy ?? null, // { userId, name, signedAt }
  recommendingApproval: data.recommendingApproval ?? null, // { userId, name, title, signedAt }
  inventoryChecked: data.inventoryChecked ?? null, // { userId, name, title, signedAt }
  budgetApproved: data.budgetApproved ?? null, // { userId, name, title, signedAt }
  checkedBy: data.checkedBy ?? null, // { userId, name, title, signedAt }
  approvedBy: data.approvedBy ?? null, // { userId, name, title, signedAt }

  // Internal Auditor accountability log (array of { action, userId, name, signedAt, remarks? })
  internalAuditorLog: data.internalAuditorLog ?? [],

  // Timestamps
  createdAt: data.createdAt ?? null,
  updatedAt: data.updatedAt ?? null,
})

/**
 * Generate RF Control Number via secure Cloud Function.
 */
export async function generateRfControlNo() {
  const year = new Date().getFullYear()
  const counterRef = doc(db, 'counters', 'requisitionRf')

  /**
   * ATOMIC CLIENT-SIDE GENERATION
   * Directly uses Firestore transactions for reliable, adjustable number generation.
   * This respects manual adjustments made in the Admin panel and avoids CORS issues.
   */
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef)
    const lastNo = snap.exists() ? snap.data().lastNo || 0 : 0
    const nextNo = lastNo + 1
    await tx.set(counterRef, { lastNo: nextNo }, { merge: true })
    return `RF-${year}-${String(nextNo).padStart(6, '0')}`
  })
}

/**
 * Generate Canvass Number (e.g., CO-2024-001) via atomic counter.
 * Format: CO-[YEAR]-[NUMBER]
 */
export async function generateCanvassNo() {
  const year = new Date().getFullYear()
  const counterRef = doc(db, 'counters', `canvassNo_${year}`)
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef)
    const lastNo = snap.exists() ? snap.data().lastNo || 0 : 0
    const nextNo = lastNo + 1
    await tx.set(counterRef, { lastNo: nextNo }, { merge: true })
    return `CO-${year}-${String(nextNo).padStart(6, '0')}`
  })
}

/**
 * Generate PBAC Form 01 Serial Number (e.g., PBAC-01-2024-0001) via atomic counter.
 * Format: PBAC-01-[YEAR]-[NUMBER]
 */
export async function generatePbacFormNo() {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const counterRef = doc(db, 'counters', `pbacFormNo_${year}`)
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef)
    const lastNo = snap.exists() ? snap.data().lastNo || 0 : 0
    const nextNo = lastNo + 1
    await tx.set(counterRef, { lastNo: nextNo }, { merge: true })
    return `PBAC-${month}-${year}-${String(nextNo).padStart(4, '0')}`
  })
}

/**
 * Generate Purchase Order Number (e.g., PO-2024-001) via atomic counter.
 * Format: PO-[YEAR]-[NUMBER]
 */
export async function generatePoNo() {
  const year = new Date().getFullYear()
  const counterRef = doc(db, 'counters', `poNo_${year}`)
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef)
    const lastNo = snap.exists() ? snap.data().lastNo || 0 : 0
    const nextNo = lastNo + 1
    await tx.set(counterRef, { lastNo: nextNo }, { merge: true })
    return `PO-${year}-${String(nextNo).padStart(6, '0')}`
  })
}

/**
 * Create a new requisition
 */
export async function createRequisitionDocument(data) {
  const rfControlNo = data.rfControlNo || (await generateRfControlNo())
  // Default to DRAFT if status not provided (requestors can save drafts and submit later)
  const initialStatus = data.status ?? REQUISITION_STATUS.DRAFT
  const requisition = createRequisition({
    ...data,
    rfControlNo,
    status: initialStatus,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })

  const docRef = await addDoc(collection(db, COLLECTIONS.REQUISITIONS), requisition)

  // Audit Log Entry for Creation
  if (initialStatus !== REQUISITION_STATUS.DRAFT) {
    await appendTransactionLog(
      docRef.id,
      {
        action: 'created',
        userId: data.requestedBy?.userId ?? '',
        name: data.requestedBy?.name ?? 'Requestor',
        title: 'Requestor',
        email: data.requestedBy?.email ?? '',
        step: 'creation',
      },
      {
        statusBefore: '',
        statusAfter: initialStatus,
        rfControlNo: rfControlNo,
        purpose: (data.purpose ?? '').slice(0, 200),
      },
    )
  }

  return { id: docRef.id, ...requisition }
}

/**
 * Get a requisition by ID
 */
export async function getRequisition(id) {
  const docRef = doc(db, COLLECTIONS.REQUISITIONS, id)
  const snapshot = await getDoc(docRef)
  if (!snapshot.exists()) return null
  return { id: snapshot.id, ...snapshot.data() }
}

/**
 * Helper to ensure a requisition has the requestor's email
 * (Fallback for older documents that only stored userId/name)
 */
async function ensureRequestorEmail(requisition) {
  if (!requisition) return requisition
  if (requisition.requestedBy?.email) return requisition

  const userId = requisition.requestedBy?.userId
  if (!userId) return requisition

  try {
    const userRef = doc(db, COLLECTIONS.USERS, userId)
    const userSnap = await getDoc(userRef)
    if (userSnap.exists()) {
      const userData = userSnap.data()
      if (userData.email) {
        requisition.requestedBy = {
          ...requisition.requestedBy,
          email: userData.email,
        }
      }
    }
  } catch (e) {
    console.warn('[RequisitionService] Could not hydrate requestor email:', e)
  }
  return requisition
}

/**
 * Update a requisition
 */
export async function updateRequisition(id, data) {
  const docRef = doc(db, COLLECTIONS.REQUISITIONS, id)
  await updateDoc(docRef, {
    ...data,
    updatedAt: serverTimestamp(),
  })
  return getRequisition(id)
}

/**
 * Permanently delete a requisition from Firestore (e.g. from Archive). Use with caution.
 */
export async function deleteRequisition(id) {
  const docRef = doc(db, COLLECTIONS.REQUISITIONS, id)
  await deleteDoc(docRef)
}

/**
 * Mark an approved requisition as ordered (Purchaser). Sets purchaseStatus, orderedAt, orderedBy, poNumber.
 */
export async function markRequisitionOrdered(
  requisitionId,
  { poNumber, orderedAt, orderedBy, supplier, items, signatureData },
) {
  const current = await getRequisition(requisitionId)
  if (!current || current.status !== REQUISITION_STATUS.APPROVED) {
    throw new Error('Requisition is not approved.')
  }
  if (
    current.canvassStatus !== CANVASS_STATUS.ORDER_CREATED &&
    current.canvassStatus !== CANVASS_STATUS.SUBMITTED_TO_BAC
  ) {
    throw new Error('Canvass must be completed and submitted before creating a Purchase Order.')
  }
  const at = orderedAt
    ? orderedAt instanceof Date
      ? orderedAt.toISOString()
      : orderedAt
    : new Date().toISOString()

  const updates = {
    // We intentionally DO NOT set purchaseStatus: PURCHASE_STATUS.ORDERED yet.
    // That happens only AFTER the PO is fully approved.
    poStatus: PO_STATUS.PENDING_BUDGET,
    orderedAt: at,
    orderedBy: orderedBy ?? null,
    poNumber: poNumber ?? (current.poNumber || ''),
    supplier: supplier ?? (current.supplier || ''),
  }

  if (items && Array.isArray(items)) {
    updates.items = items.map(createRequisitionItem)
  }

  await updateRequisition(requisitionId, updates)

  // Save e-signature if provided
  if (orderedBy && signatureData) {
    await upsertRequisitionSignature(requisitionId, 'orderedBy', {
      userId: orderedBy.userId,
      name: orderedBy.name,
      title: orderedBy.role === USER_ROLES.BAC_SECRETARY ? 'BAC Secretary' : 'Purchaser',
      signedAt: at,
      signatureData,
    })
  }

  // Log the purchaser action
  const snapshot = {
    statusBefore: current.status,
    statusAfter: current.status, // Status remains APPROVED
    rfControlNo: current.rfControlNo ?? '',
    purpose: (current.purpose ?? '').slice(0, 200),
    // We explicitly do NOT set purchaseStatus: PURCHASE_STATUS.ORDERED here
    // as it's not actually ordered yet until GM approves.
    poNumber: poNumber ?? (current.poNumber || ''),
  }
  await appendTransactionLog(
    requisitionId,
    {
      action: 'po_issued',
      userId: orderedBy?.userId ?? '',
      name: orderedBy?.name ?? 'BAC Secretary / Purchaser',
      title: orderedBy?.role === USER_ROLES.BAC_SECRETARY ? 'BAC Secretary' : 'Purchaser',
      email: orderedBy?.email ?? '',
      step: 'purchase_order',
    },
    snapshot,
  )

  // Notification: Notify Budget Officer + Inform Requestor
  try {
    const reqWithEmail = await ensureRequestorEmail(current)
    const budgetEmails = await getEmailsByRole(USER_ROLES.BUDGET_OFFICER)
    if (budgetEmails.length > 0) {
      await notificationService.notifyPOAction(reqWithEmail, 'Budget Officer', budgetEmails)
    }
    // Inform the requestor their item is now in the PO approval stage
    await notificationService.notifyRequestorUpdate(
      reqWithEmail,
      'Step Approved',
      '',
      'PO Budget Review',
    )
  } catch (e) {
    console.error('PO Creation notification error:', e)
  }

  return getRequisition(requisitionId)
}

/**
 * Budget Officer approves the PO (Certifies Funds Available).
 * Moves poStatus from PENDING_BUDGET -> PENDING_AUDIT.
 */
export async function approvePOBudget(requisitionId, user, signatureData) {
  const current = await getRequisition(requisitionId)
  if (!current || current.poStatus !== PO_STATUS.PENDING_BUDGET) {
    throw new Error('Requisition is not pending Budget PO approval.')
  }
  // Build updates object
  const updates = {
    poStatus: PO_STATUS.PENDING_AUDIT,
  }

  // Save e-signature if provided
  if (user && signatureData) {
    const sigInfo = {
      userId: user.uid,
      name: user.displayName || user.name || 'Budget Officer',
      title: 'Budget Officer',
      signedAt: new Date().toISOString(),
      signatureData,
    }
    await upsertRequisitionSignature(requisitionId, 'poBudgetApproved', sigInfo)

    // Add to single updates object
    updates.poBudgetApproved = {
      userId: sigInfo.userId,
      name: sigInfo.name,
      signedAt: sigInfo.signedAt,
    }
  }

  // Single Firestore update to avoid permission race conditions
  await updateRequisition(requisitionId, updates)
  if (user) {
    await appendTransactionLog(
      requisitionId,
      {
        action: 'po_approved',
        userId: user.uid,
        name: user.displayName || user.name || 'Budget Officer',
        title: 'Budget Officer',
        email: user.email,
        step: 'po_budget',
      },
      {
        poStatusBefore: current.poStatus,
        poStatusAfter: PO_STATUS.PENDING_AUDIT,
        rfControlNo: current.rfControlNo ?? '',
        purpose: (current.purpose ?? '').slice(0, 200),
      },
    )

    // Notification: Notify Internal Auditor for PO Review + Update Requestor
    try {
      const reqWithEmail = await ensureRequestorEmail(current)
      const auditorEmails = await getEmailsByRole(USER_ROLES.INTERNAL_AUDITOR)
      if (auditorEmails.length > 0) {
        await notificationService.notifyPOAction(reqWithEmail, 'Internal Audit', auditorEmails)
      }
      // Keep requestor in the loop
      await notificationService.notifyRequestorUpdate(
        reqWithEmail,
        'Step Approved',
        '',
        'Internal Audit',
      )
    } catch (e) {
      console.error('PO Budget approval notification error:', e)
    }
  }
}

/**
 * Internal Auditor pre-audits the PO.
 * Moves poStatus from PENDING_AUDIT -> PENDING_GM.
 */
export async function approvePOAudit(requisitionId, user, signatureData) {
  const current = await getRequisition(requisitionId)
  if (!current || current.poStatus !== PO_STATUS.PENDING_AUDIT) {
    throw new Error('Requisition is not pending Audit PO approval.')
  }
  // Build updates object
  const updates = {
    poStatus: PO_STATUS.PENDING_GM,
  }

  // Save e-signature if provided
  if (user && signatureData) {
    const sigInfo = {
      userId: user.uid,
      name: user.displayName || user.name || 'Internal Audit Dept. Manager',
      title: 'Internal Audit Dept. Manager',
      signedAt: new Date().toISOString(),
      signatureData,
    }
    await upsertRequisitionSignature(requisitionId, 'poAuditApproved', sigInfo)

    // Add to single updates object
    updates.poAuditApproved = {
      userId: sigInfo.userId,
      name: sigInfo.name,
      signedAt: sigInfo.signedAt,
    }
  }

  // Single Firestore update to avoid permission race conditions
  await updateRequisition(requisitionId, updates)
  if (user) {
    await appendTransactionLog(
      requisitionId,
      {
        action: 'po_approved',
        userId: user.uid,
        name: user.displayName || user.name || 'Internal Auditor',
        title: 'Internal Auditor',
        email: user.email,
        step: 'po_audit',
      },
      {
        poStatusBefore: current.poStatus,
        poStatusAfter: PO_STATUS.PENDING_GM,
        rfControlNo: current.rfControlNo ?? '',
        purpose: (current.purpose ?? '').slice(0, 200),
      },
    )

    // Notification: Notify GM for PO Review + Update Requestor
    try {
      const reqWithEmail = await ensureRequestorEmail(current)
      const gmEmails = await getEmailsByRole(USER_ROLES.GENERAL_MANAGER)
      if (gmEmails.length > 0) {
        await notificationService.notifyPOAction(reqWithEmail, 'General Manager', gmEmails)
      }
      // Keep requestor in the loop
      await notificationService.notifyRequestorUpdate(
        reqWithEmail,
        'Step Approved',
        '',
        'General Manager',
      )
    } catch (e) {
      console.error('PO Audit approval notification error:', e)
    }
  }
}

/**
 * General Manager approves the PO.
 * Moves poStatus from PENDING_GM -> APPROVED.
 * Automatically marks the Purchase Status as ORDERED.
 */
export async function approvePOGM(requisitionId, user, signatureData) {
  const current = await getRequisition(requisitionId)
  if (!current || current.poStatus !== PO_STATUS.PENDING_GM) {
    throw new Error('Requisition is not pending GM PO approval.')
  }
  // Build updates object
  const updates = {
    poStatus: PO_STATUS.APPROVED,
    purchaseStatus: PURCHASE_STATUS.ORDERED, // Final GM approval implicitly marks it as ordered
  }

  // Save e-signature if provided
  if (user && signatureData) {
    const sigInfo = {
      userId: user.uid,
      name: user.displayName || user.name || 'General Manager',
      title: 'General Manager',
      signedAt: new Date().toISOString(),
      signatureData,
    }
    await upsertRequisitionSignature(requisitionId, 'poGMApproved', sigInfo)

    // Add to single updates object
    updates.poGMApproved = {
      userId: sigInfo.userId,
      name: sigInfo.name,
      signedAt: sigInfo.signedAt,
    }
  }

  // Single Firestore update to avoid permission race conditions
  await updateRequisition(requisitionId, updates)
  if (user) {
    await appendTransactionLog(
      requisitionId,
      {
        action: 'po_approved',
        userId: user.uid,
        name: user.displayName || user.name || 'General Manager',
        title: 'General Manager',
        email: user.email,
        step: 'po_gm',
      },
      {
        poStatusBefore: current.poStatus,
        poStatusAfter: PO_STATUS.APPROVED,
        rfControlNo: current.rfControlNo ?? '',
        purpose: (current.purpose ?? '').slice(0, 200),
      },
    )

    // Notification: Notify BAC Secretary (Ready to Print), Purchaser (for delivery), and Requestor
    try {
      const reqWithEmail = await ensureRequestorEmail(current)
      // Notify BAC Secretary the PO is fully signed
      const bacEmails = await getEmailsByRole(USER_ROLES.BAC_SECRETARY)
      if (bacEmails.length > 0) {
        await notificationService.notifyPOAction(reqWithEmail, 'BAC Secretary', bacEmails)
      }
      // Notify Purchaser to proceed with receiving delivery
      const purchaserEmails = await getEmailsByRole(USER_ROLES.PURCHASER)
      if (purchaserEmails.length > 0) {
        await notificationService.notifyNextApprover(
          reqWithEmail,
          'Purchaser (For Delivery)',
          purchaserEmails,
        )
      }
      // Notify the requestor the PO is fully approved
      await notificationService.notifyRequestorUpdate(reqWithEmail, 'po_approved')
    } catch (e) {
      console.error('PO GM approval notification error:', e)
    }
  }
}

/**
 * Any PO approver (Budget Officer, Internal Auditor, General Manager) can reject a PO.
 * Sets poStatus to REJECTED and logs the action with the provided remarks.
 */
export async function rejectPO(requisitionId, user, { remarks, step }) {
  if (!remarks || !remarks.trim()) {
    throw new Error('A rejection reason is required.')
  }
  const current = await getRequisition(requisitionId)
  if (!current) {
    throw new Error('Requisition not found.')
  }
  const poStatusBefore = current.poStatus
  await updateRequisition(requisitionId, {
    poStatus: PO_STATUS.REJECTED,
    poRejectedAt: new Date().toISOString(),
    poRejectedBy: user
      ? { userId: user.uid, name: user.displayName || user.name, email: user.email }
      : null,
    poRejectionRemarks: remarks.trim(),
    isArchived: true,
    archivedAt: serverTimestamp(),
  })
  if (user) {
    await appendTransactionLog(
      requisitionId,
      {
        action: 'po_rejected',
        userId: user.uid,
        name: user.displayName || user.name || 'Approver',
        title: step || 'Approver',
        email: user.email,
        step: step || 'po_review',
        remarks: remarks.trim(),
      },
      {
        poStatusBefore,
        poStatusAfter: PO_STATUS.REJECTED,
        rfControlNo: current.rfControlNo ?? '',
        purpose: (current.purpose ?? '').slice(0, 200),
      },
    )

    // Notification: Notify BAC Secretary of PO Rejection
    try {
      const bacEmails = await getEmailsByRole(USER_ROLES.BAC_SECRETARY)
      if (bacEmails.length > 0) {
        await notificationService.notifyPOAction(current, 'Correction Needed', bacEmails)
      }
    } catch (e) {
      console.error('PO rejection notification error:', e)
    }
  }
}

/**
 * Mark an approved requisition as canvassed (Purchaser). Sets canvassStatus, canvassDate, canvassNumber.
 */
export async function markRequisitionCanvassed(
  requisitionId,
  { canvassNumber, canvassDate, canvassBy, supplier, items, signatureData, hasQuotes },
) {
  const current = await getRequisition(requisitionId)
  if (!current || current.status !== REQUISITION_STATUS.APPROVED) {
    throw new Error('Requisition is not approved.')
  }
  const at = canvassDate
    ? canvassDate instanceof Date
      ? canvassDate.toISOString()
      : canvassDate
    : new Date().toISOString()

  const updates = {
    canvassStatus: CANVASS_STATUS.SUBMITTED_TO_BAC,
    canvassDate: at,
    canvassBy: canvassBy ?? null,
    canvassNumber: canvassNumber ?? '',
    submittedToBACAt: at,
    submittedToBACBy: canvassBy ?? null,
    hasQuotes: true,
  }

  if (supplier) updates.supplier = supplier
  if (items && Array.isArray(items)) {
    updates.items = items.map(createRequisitionItem)
  }

  await updateRequisition(requisitionId, updates)

  // Save e-signature if provided
  if (canvassBy && signatureData) {
    await upsertRequisitionSignature(requisitionId, 'canvassBy', {
      userId: canvassBy.userId,
      name: canvassBy.name,
      title: 'Purchaser / Canvasser',
      signedAt: at,
      signatureData,
    })
  }

  // Log the canvass action
  const snapshot = {
    statusBefore: current.status,
    statusAfter: current.status, // Status remains APPROVED
    rfControlNo: current.rfControlNo ?? '',
    purpose: (current.purpose ?? '').slice(0, 200),
    canvassStatus: CANVASS_STATUS.SUBMITTED_TO_BAC,
    canvassNumber: canvassNumber ?? '',
  }
  await appendTransactionLog(
    requisitionId,
    {
      action: 'canvassed',
      userId: canvassBy?.userId ?? '',
      name: canvassBy?.name ?? 'Purchaser / Canvasser',
      title: 'Purchaser',
      email: canvassBy?.email ?? '',
      step: 'purchaser_canvass',
    },
    snapshot,
  )

  // Notification: Notify BAC Secretary + Inform Requestor
  try {
    const reqWithEmail = await ensureRequestorEmail(current)
    const bacEmails = await getEmailsByRole(USER_ROLES.BAC_SECRETARY)
    console.log('[markRequisitionCanvassed] Found BAC emails:', bacEmails)
    if (bacEmails.length > 0) {
      console.log('[markRequisitionCanvassed] Notifying BAC...')
      await notificationService.notifyBACNewCanvass(reqWithEmail, bacEmails)
    } else {
      console.warn('[markRequisitionCanvassed] SKIPPING BAC NOTIFICATION: No active BAC_SECRETARY found.')
    }
    // Tell the requestor that their requisition is now in the canvassing/BAC phase
    await notificationService.notifyRequestorUpdate(
      reqWithEmail,
      'Step Approved',
      '',
      'BAC (Canvass)',
    )
  } catch (e) {
    console.error('[markRequisitionCanvassed] BAC notification error:', e)
  }

  return getRequisition(requisitionId)
}

/**
 * Submit canvassed requisition to BAC Secretary (Purchaser).
 * Sets canvassStatus to SUBMITTED_TO_BAC.
 */
export async function submitRequisitionToBAC(requisitionId, { submittedBy }) {
  const current = await getRequisition(requisitionId)
  if (!current || current.status !== REQUISITION_STATUS.APPROVED) {
    throw new Error('Requisition is not approved.')
  }
  if (current.canvassStatus !== CANVASS_STATUS.ORDER_CREATED) {
    throw new Error('Canvass must be completed before submitting to BAC.')
  }

  await updateRequisition(requisitionId, {
    canvassStatus: CANVASS_STATUS.SUBMITTED_TO_BAC,
    submittedToBACAt: new Date().toISOString(),
    submittedToBACBy: submittedBy ?? null,
  })

  // Log the submission
  const snapshot = {
    statusBefore: current.status,
    statusAfter: current.status,
    rfControlNo: current.rfControlNo ?? '',
    purpose: (current.purpose ?? '').slice(0, 200),
    canvassStatus: CANVASS_STATUS.SUBMITTED_TO_BAC,
  }
  await appendTransactionLog(
    requisitionId,
    {
      action: 'submitted_to_bac',
      userId: submittedBy?.userId ?? '',
      name: submittedBy?.name ?? 'Purchaser / Canvasser',
      title: 'Purchaser',
      email: submittedBy?.email ?? '',
      step: 'purchaser_bac_submit',
    },
    snapshot,
  )

  // Notification: Notify BAC Secretary
  try {
    const bacEmails = await getEmailsByRole(USER_ROLES.BAC_SECRETARY)
    if (bacEmails.length > 0) {
      await notificationService.notifyBACNewCanvass(current, bacEmails)
    }
  } catch (e) {
    console.error('BAC submission notification error:', e)
  }

  return getRequisition(requisitionId)
}

/**
 * Mark an approved requisition as received (Purchaser). Sets purchaseStatus to received, receivedAt, receivedBy.
 */
export async function markRequisitionReceived(
  requisitionId,
  { receivedAt, receivedBy, signatureData },
) {
  const current = await getRequisition(requisitionId)
  if (!current || current.status !== REQUISITION_STATUS.APPROVED) {
    throw new Error('Requisition is not approved.')
  }
  const at = receivedAt
    ? receivedAt instanceof Date
      ? receivedAt.toISOString()
      : receivedAt
    : new Date().toISOString()
  await updateRequisition(requisitionId, {
    purchaseStatus: PURCHASE_STATUS.RECEIVED,
    receivedAt: at,
    receivedBy: receivedBy ?? null,
    isArchived: true,
    archivedAt: serverTimestamp(),
  })

  // Save e-signature if provided
  if (receivedBy && signatureData) {
    await upsertRequisitionSignature(requisitionId, 'receivedBy', {
      userId: receivedBy.userId,
      name: receivedBy.name,
      title: 'Purchaser',
      signedAt: at,
      signatureData,
    })
  }
  // Log the purchaser received action
  const after = await getRequisition(requisitionId)
  const snap = {
    statusBefore: after.status,
    statusAfter: after.status,
    rfControlNo: after.rfControlNo ?? '',
    purpose: (after.purpose ?? '').slice(0, 200),
    purchaseStatus: PURCHASE_STATUS.RECEIVED,
    poNumber: after.poNumber ?? '',
  }
  await appendTransactionLog(
    requisitionId,
    {
      action: 'received',
      userId: receivedBy?.userId ?? '',
      name: receivedBy?.name ?? 'Purchaser',
      title: 'Purchaser',
      email: receivedBy?.email ?? '',
      step: 'purchaser',
    },
    snap,
  )

  return getRequisition(requisitionId)
}

/**
 * Build query for requisitions (with optional filters and pagination).
 * When requestedBy is set, query is restricted so requesters only read their own docs (matches rules).
 * @param {object} opts - { pageSize, startAfterDoc }
 */
function buildRequisitionsQuery(filters = {}, opts = {}) {
  const pageSize = opts.pageSize ?? REQUISITION_LIST_LIMIT
  const startAfterDoc = opts.startAfterDoc ?? null
  const base = collection(db, COLLECTIONS.REQUISITIONS)
  const constraints = []
  if (filters.requestedBy) {
    constraints.push(where('requestedBy.userId', '==', filters.requestedBy))
  }
  if (filters.status) {
    if (Array.isArray(filters.status)) {
      constraints.push(where('status', 'in', filters.status))
    } else {
      constraints.push(where('status', '==', filters.status))
    }
  }
  if (filters.purchaseStatus) {
    constraints.push(where('purchaseStatus', '==', filters.purchaseStatus))
  }
  if (filters.canvassStatus && !Array.isArray(filters.canvassStatus)) {
    constraints.push(where('canvassStatus', '==', filters.canvassStatus))
  }
  if (filters.department) {
    constraints.push(where('department', '==', filters.department))
  }
  if (filters.assignedApproverId) {
    constraints.push(where('assignedApproverId', '==', filters.assignedApproverId))
  }
  constraints.push(orderBy('createdAt', 'desc'), limit(pageSize))
  if (startAfterDoc) constraints.push(startAfter(startAfterDoc))
  return query(base, ...constraints)
}

function buildArchivedRequisitionsQuery(opts = {}) {
  const pageSize = opts.pageSize ?? REQUISITION_LIST_LIMIT
  const startAfterDoc = opts.startAfterDoc ?? null
  const base = collection(db, COLLECTIONS.REQUISITIONS)
  const constraints = [
    where('isArchived', '==', true),
    orderBy('archivedAt', 'desc'),
    limit(pageSize),
  ]
  if (startAfterDoc) constraints.push(startAfter(startAfterDoc))
  return query(base, ...constraints)
}

/**
 * Get total count of requisitions for pagination.
 * @param {object} filters - same as buildRequisitionsQuery
 */
export async function getRequisitionCount(filters = {}) {
  const base = collection(db, COLLECTIONS.REQUISITIONS)
  const constraints = []
  if (filters.requestedBy) {
    constraints.push(where('requestedBy.userId', '==', filters.requestedBy))
  }
  if (filters.status) {
    if (Array.isArray(filters.status)) {
      constraints.push(where('status', 'in', filters.status))
    } else {
      constraints.push(where('status', '==', filters.status))
    }
  }
  if (filters.purchaseStatus) {
    constraints.push(where('purchaseStatus', '==', filters.purchaseStatus))
  }
  if (filters.canvassStatus && !Array.isArray(filters.canvassStatus)) {
    constraints.push(where('canvassStatus', '==', filters.canvassStatus))
  }
  if (filters.department) {
    constraints.push(where('department', '==', filters.department))
  }
  if (filters.assignedApproverId) {
    constraints.push(where('assignedApproverId', '==', filters.assignedApproverId))
  }

  // Support for signature field filtering (e.g. "divisionApproved.userId")
  // and other nested fields
  Object.keys(filters).forEach(key => {
    if (['requestedBy', 'status', 'purchaseStatus', 'canvassStatus', 'department', 'assignedApproverId'].includes(key)) return
    constraints.push(where(key, '==', filters[key]))
  })
  const q = query(base, ...constraints)
  const snapshot = await getCountFromServer(q)
  return snapshot.data().count
}

/**
 * List requisitions (with optional filters and pagination).
 * @param {object} filters - { status, department, requestedBy }
 * @param {object} pagination - { pageSize = REQUISITION_PAGE_SIZE, startAfter = DocumentSnapshot }
 * @returns {Promise<{ requisitions: array, lastDoc: DocumentSnapshot|null, hasMore: boolean }>}
 */
export async function listRequisitions(filters = {}, pagination = {}) {
  const pageSize = pagination.pageSize ?? REQUISITION_PAGE_SIZE
  const startAfterDoc = pagination.startAfter ?? null
  const q = buildRequisitionsQuery(filters, { pageSize, startAfterDoc })
  const snapshot = await getDocs(q)
  let results = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))

  if (filters.department) results = results.filter((r) => r.department === filters.department)
  if (filters.canvassStatus) {
    const target = filters.canvassStatus
    if (Array.isArray(target)) {
      results = results.filter((r) => target.includes(r.canvassStatus || CANVASS_STATUS.PENDING))
    } else {
      results = results.filter((r) => (r.canvassStatus || CANVASS_STATUS.PENDING) === target)
    }
  }
  if (filters.purchaseStatus) {
    results = results.filter(
      (r) => (r.purchaseStatus || PURCHASE_STATUS.PENDING) === filters.purchaseStatus,
    )
  }
  if (filters.poStatus !== undefined) {
    const target = filters.poStatus
    if (Array.isArray(target)) {
      results = results.filter((r) => target.includes(r.poStatus ?? null))
    } else {
      results = results.filter((r) => r.poStatus === target)
    }
  }

  const lastDoc = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null
  const hasMore = snapshot.docs.length === pageSize

  return { requisitions: results, lastDoc, hasMore }
}

/**
 * List all requisitions (one shot, no cursor). For Dashboard/PendingApprovals that need a simple array.
 * Uses first page only (REQUISITION_PAGE_SIZE) to avoid loading hundreds at once.
 */
export async function listRequisitionsSimple(filters = {}) {
  const { requisitions } = await listRequisitions(filters, { pageSize: REQUISITION_PAGE_SIZE })
  return requisitions
}

/**
 * Get analytics counts for GM sidebar. Runs 3 queries in parallel.
 * @returns {Promise<{ pendingApproval: number, approvedThisMonth: number, rejectedThisMonth: number, approvedNotYetPurchased: number }>}
 */
export async function getGMStats() {
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)

  function toDate(val) {
    if (!val) return null
    if (val?.toDate) return val.toDate()
    const d = new Date(val)
    return Number.isNaN(d.getTime()) ? null : d
  }

  const [pendingList, approvedList, rejectedList] = await Promise.all([
    listRequisitionsSimple({ status: REQUISITION_STATUS.PENDING_APPROVAL }),
    listRequisitionsSimple({ status: REQUISITION_STATUS.APPROVED }),
    listRequisitionsSimple({ status: REQUISITION_STATUS.REJECTED }),
  ])

  const approvedThisMonth = approvedList.filter((r) => {
    const d = toDate(r.archivedAt ?? r.date)
    return d && d >= startOfMonth && d <= endOfMonth
  }).length

  const rejectedThisMonth = rejectedList.filter((r) => {
    const d = toDate(r.archivedAt ?? r.date)
    return d && d >= startOfMonth && d <= endOfMonth
  }).length

  const approvedNotYetPurchased = approvedList.filter((r) => {
    const ps = r.purchaseStatus || PURCHASE_STATUS.PENDING
    return ps === PURCHASE_STATUS.PENDING
  }).length

  return {
    pendingApproval: pendingList.length,
    approvedThisMonth,
    rejectedThisMonth,
    approvedNotYetPurchased,
  }
}

/** Status labels for analytics charts */
export const STATUS_LABELS = {
  [REQUISITION_STATUS.DRAFT]: 'Draft',
  [REQUISITION_STATUS.PENDING_RECOMMENDATION]: 'Pending Section Head',
  [REQUISITION_STATUS.PENDING_INVENTORY]: 'Pending Warehouse',
  [REQUISITION_STATUS.PENDING_BUDGET]: 'Pending Budget',
  [REQUISITION_STATUS.PENDING_AUDIT]: 'Pending Auditor',
  [REQUISITION_STATUS.PENDING_APPROVAL]: 'Pending GM',
  [REQUISITION_STATUS.APPROVED]: 'Approved',
  [REQUISITION_STATUS.REJECTED]: 'Rejected',
}

/**
 * Date range for analytics filter presets.
 * @param {'this_month'|'last_3_months'|'last_6_months'|'all'} preset
 * @returns {{ start: Date, end: Date } | null} null = all time
 */
export function getDateRangeForPreset(preset) {
  const now = new Date()
  if (preset === 'all') return null
  let start
  if (preset === 'this_month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1)
  } else if (preset === 'last_3_months') {
    start = new Date(now.getFullYear(), now.getMonth() - 2, 1)
  } else if (preset === 'last_6_months') {
    start = new Date(now.getFullYear(), now.getMonth() - 5, 1)
  } else {
    start = new Date(now.getFullYear(), now.getMonth(), 1)
  }
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)
  return { start, end }
}

const STATUS_ORDER = [
  REQUISITION_STATUS.DRAFT,
  REQUISITION_STATUS.PENDING_RECOMMENDATION,
  REQUISITION_STATUS.PENDING_INVENTORY,
  REQUISITION_STATUS.PENDING_BUDGET,
  REQUISITION_STATUS.PENDING_AUDIT,
  REQUISITION_STATUS.PENDING_APPROVAL,
  REQUISITION_STATUS.APPROVED,
  REQUISITION_STATUS.REJECTED,
]

/**
 * Full analytics payload for GM Analytics page (summary + chart data).
 * Uses 4 queries: one large list (no filter) for pipeline/department/trend, plus 3 status lists for summary.
 */
export async function getAnalyticsData() {
  const now = new Date()
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)

  function toDate(val) {
    if (!val) return null
    if (val?.toDate) return val.toDate()
    const d = new Date(val)
    return Number.isNaN(d.getTime()) ? null : d
  }

  const [{ requisitions: allReqs }, pendingList, approvedList, rejectedList] = await Promise.all([
    listRequisitions({}, { pageSize: REQUISITION_LIST_LIMIT }),
    listRequisitionsSimple({ status: REQUISITION_STATUS.PENDING_APPROVAL }),
    listRequisitionsSimple({ status: REQUISITION_STATUS.APPROVED }),
    listRequisitionsSimple({ status: REQUISITION_STATUS.REJECTED }),
  ])

  const approvedThisMonth = approvedList.filter((r) => {
    const d = toDate(r.archivedAt ?? r.date)
    return d && d >= startOfMonth && d <= endOfMonth
  }).length
  const rejectedThisMonth = rejectedList.filter((r) => {
    const d = toDate(r.archivedAt ?? r.date)
    return d && d >= startOfMonth && d <= endOfMonth
  }).length
  const approvedNotYetPurchased = approvedList.filter((r) => {
    const ps = r.purchaseStatus || PURCHASE_STATUS.PENDING
    return ps === PURCHASE_STATUS.PENDING
  }).length

  const pipeline = {}
  STATUS_ORDER.forEach((s) => {
    pipeline[s] = 0
  })
  allReqs.forEach((r) => {
    if (r.status && pipeline[r.status] !== undefined) pipeline[r.status]++
  })

  const departments = await getDepartments()
  const thisMonthReqs = allReqs.filter((r) => {
    const d = toDate(r.createdAt ?? r.date)
    return d && d >= startOfMonth && d <= endOfMonth
  })
  const byDepartmentMap = {}
  thisMonthReqs.forEach((r) => {
    const dept = normalizeDepartmentSync(r.department, departments)
    if (!byDepartmentMap[dept]) byDepartmentMap[dept] = 0
    byDepartmentMap[dept]++
  })
  // Ensure all known departments appear (show zero counts when absent)
  departments.forEach((d) => {
    if (!byDepartmentMap[d]) byDepartmentMap[d] = 0
  })
  const byDepartment = Object.entries(byDepartmentMap)
    .map(([department, count]) => ({ department, count }))
    .sort((a, b) => b.count - a.count)

  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)
  const monthlyMap = {}
  for (let i = 0; i < 6; i++) {
    const m = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`
    monthlyMap[key] = {
      label: m.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      total: 0,
    }
  }
  allReqs.forEach((r) => {
    const d = toDate(r.createdAt ?? r.date)
    if (!d || d < sixMonthsAgo) return
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (monthlyMap[key]) monthlyMap[key].total++
  })
  const monthlyTrend = Object.entries(monthlyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => ({ monthLabel: v.label, total: v.total }))

  const purchasePending = approvedList.filter(
    (r) => (r.purchaseStatus || PURCHASE_STATUS.PENDING) === PURCHASE_STATUS.PENDING,
  ).length
  const purchaseOrdered = approvedList.filter(
    (r) => r.purchaseStatus === PURCHASE_STATUS.ORDERED,
  ).length
  const purchaseReceived = approvedList.filter(
    (r) => r.purchaseStatus === PURCHASE_STATUS.RECEIVED,
  ).length

  return {
    summary: {
      pendingApproval: pendingList.length,
      approvedThisMonth,
      rejectedThisMonth,
      approvedNotYetPurchased,
    },
    pipeline,
    byDepartment,
    monthlyTrend,
    approvedVsRejected: { approved: approvedThisMonth, rejected: rejectedThisMonth },
    purchaseBreakdown: {
      pending: purchasePending,
      ordered: purchaseOrdered,
      received: purchaseReceived,
    },
  }
}

function toDate(val) {
  if (!val) return null
  if (val?.toDate) return val.toDate()
  // If it's a string like "YYYY-MM-DD", treat it as local date (not UTC)
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) {
    const [y, m, d] = val.split('-').map(Number)
    return new Date(y, m - 1, d)
  }
  const d = new Date(val)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * Compute analytics + percentages from four requisition lists (for realtime). dateRange = { start, end } or null for all.
 */
export async function computeAnalyticsFromLists(
  allReqs,
  pendingReqs,
  approvedReqs,
  rejectedReqs,
  dateRange,
) {
  const departments = await getDepartments()
  const rangeStart = dateRange?.start ?? null
  const rangeEnd = dateRange?.end ?? null

  // Helper to determine the relevant date for a requisition
  const getRefDate = (r) => {
    if (r.status === REQUISITION_STATUS.APPROVED || r.status === REQUISITION_STATUS.REJECTED) {
      return toDate(r.archivedAt ?? r.date)
    }
    return toDate(r.createdAt ?? r.date)
  }

  const isInRange = (r) => {
    if (!rangeStart || !rangeEnd) return true
    const d = getRefDate(r)
    return d && d >= rangeStart && d <= rangeEnd
  }

  // Filter all lists by the range first for consistency
  const activeInRange = allReqs.filter(isInRange)
  const pendingInRange = pendingReqs.filter(isInRange)
  const approvedInRangeFull = approvedReqs.filter(isInRange)
  const rejectedInRangeFull = rejectedReqs.filter(isInRange)

  const approvedCount = approvedInRangeFull.length
  const rejectedCount = rejectedInRangeFull.length
  const decisionsTotal = approvedCount + rejectedCount
  const approvedPct = decisionsTotal > 0 ? Math.round((approvedCount / decisionsTotal) * 100) : 0
  const rejectedPct = decisionsTotal > 0 ? Math.round((rejectedCount / decisionsTotal) * 100) : 0

  const approvedNotYetPurchased = approvedInRangeFull.filter(
    (r) => (r.purchaseStatus || PURCHASE_STATUS.PENDING) === PURCHASE_STATUS.PENDING,
  ).length
  const notYetPurchasedPct =
    approvedCount > 0 ? Math.round((approvedNotYetPurchased / approvedCount) * 100) : 0

  const pipeline = {}
  STATUS_ORDER.forEach((s) => {
    pipeline[s] = 0
  })
  activeInRange.forEach((r) => {
    if (r.status && pipeline[r.status] !== undefined) pipeline[r.status]++
  })
  const pipelineTotal = activeInRange.length
  const pipelineWithPct = STATUS_ORDER.map((s) => ({
    status: s,
    count: pipeline[s] ?? 0,
    pct: pipelineTotal > 0 ? Math.round(((pipeline[s] ?? 0) / pipelineTotal) * 100) : 0,
  }))

  const byDepartmentMap = {}
  activeInRange.forEach((r) => {
    const dept = normalizeDepartmentSync(r.department, departments)
    if (!byDepartmentMap[dept]) byDepartmentMap[dept] = 0
    byDepartmentMap[dept]++
  })
  // Ensure all known departments appear (show zero counts when absent)
  departments.forEach((d) => {
    if (!byDepartmentMap[d]) byDepartmentMap[d] = 0
  })
  const byDepartment = Object.entries(byDepartmentMap)
    .map(([department, count]) => ({
      department,
      count,
      pct: pipelineTotal > 0 ? Math.round((count / pipelineTotal) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count)

  const now = new Date()
  const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)
  const monthlyMap = {}
  for (let i = 0; i < 6; i++) {
    const m = new Date(now.getFullYear(), now.getMonth() - (5 - i), 1)
    const key = `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`
    monthlyMap[key] = {
      label: m.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      total: 0,
      value: 0,
    }
  }
  allReqs.forEach((r) => {
    const d = toDate(r.createdAt ?? r.date)
    if (!d || d < sixMonthsAgo) return
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (monthlyMap[key]) {
      monthlyMap[key].total++
      if (
        r.status === REQUISITION_STATUS.APPROVED ||
        r.purchaseStatus === PURCHASE_STATUS.RECEIVED
      ) {
        const reqTotal = (r.items || []).reduce((sum, item) => {
          const qty = parseFloat(item.quantity) || 0
          const price = parseFloat(item.unitPrice) || 0
          return sum + qty * price
        }, 0)
        monthlyMap[key].value += reqTotal
      }
    }
  })
  const monthlyTrend = Object.entries(monthlyMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => ({ monthLabel: v.label, total: v.total, value: v.value }))

  const purchasePending = approvedInRangeFull.filter(
    (r) => (r.purchaseStatus || PURCHASE_STATUS.PENDING) === PURCHASE_STATUS.PENDING,
  ).length
  const purchaseOrdered = approvedInRangeFull.filter(
    (r) => r.purchaseStatus === PURCHASE_STATUS.ORDERED,
  ).length
  const purchaseReceived = approvedInRangeFull.filter(
    (r) => r.purchaseStatus === PURCHASE_STATUS.RECEIVED,
  ).length
  const purchaseTotal = purchasePending + purchaseOrdered + purchaseReceived
  const purchasePendingPct =
    purchaseTotal > 0 ? Math.round((purchasePending / purchaseTotal) * 100) : 0
  const purchaseOrderedPct =
    purchaseTotal > 0 ? Math.round((purchaseOrdered / purchaseTotal) * 100) : 0
  const purchaseReceivedPct =
    purchaseTotal > 0 ? Math.round((purchaseReceived / purchaseTotal) * 100) : 0

  // Calculate Productivity & Financial Metrics
  let totalLeadTimeMs = 0
  let leadTimeCount = 0
  let totalApprovedValue = 0

  // Pre-populate department spend map with zeros
  const deptSpendMap = {}
  departments.forEach((d) => {
    deptSpendMap[d] = 0
  })

  const highValueThreshold = 50000
  const highValueReqs = []

  const stageVelocity = {
    submission_to_recommend: { total: 0, count: 0, activeTotal: 0, activeCount: 0 },
    recommend_to_inventory: { total: 0, count: 0, activeTotal: 0, activeCount: 0 },
    inventory_to_budget: { total: 0, count: 0, activeTotal: 0, activeCount: 0 },
    budget_to_audit: { total: 0, count: 0, activeTotal: 0, activeCount: 0 },
    audit_to_gm: { total: 0, count: 0, activeTotal: 0, activeCount: 0 },
    gm_to_fulfillment: { total: 0, count: 0, activeTotal: 0, activeCount: 0 },
    req_appr_to_po_issue: { total: 0, count: 0, activeTotal: 0, activeCount: 0 },
    po_issue_to_po_budget: { total: 0, count: 0, activeTotal: 0, activeCount: 0 },
    po_budget_to_po_audit: { total: 0, count: 0, activeTotal: 0, activeCount: 0 },
    po_audit_to_po_gm: { total: 0, count: 0, activeTotal: 0, activeCount: 0 },
  }

  approvedInRangeFull.forEach((r) => {
    // Lead Time
    const created = toDate(r.createdAt || r.date)
    const archived = toDate(r.archivedAt)
    if (created && archived) {
      totalLeadTimeMs += archived - created
      leadTimeCount++
    }

    // Financials
    const reqTotal = (r.items || []).reduce((sum, item) => {
      const qty = parseFloat(item.quantity) || 0
      const price = parseFloat(item.unitPrice) || 0
      return sum + qty * price
    }, 0)

    totalApprovedValue += reqTotal

    // Dept Spend
    const dept = normalizeDepartmentSync(r.department, departments)
    if (deptSpendMap[dept] !== undefined) {
      deptSpendMap[dept] += reqTotal
    } else {
      deptSpendMap[dept] = reqTotal
    }

    // High Value Tracking
    if (reqTotal >= highValueThreshold) {
      highValueReqs.push({
        id: r.id,
        rfControlNo: r.rfControlNo,
        total: reqTotal,
        department: dept,
      })
    }

    // Velocity breakdown
    const t0 = toDate(r.requestedBy?.signedAt)
    const t1 = toDate(r.recommendingApproval?.signedAt)
    const t2 = toDate(r.inventoryChecked?.signedAt)
    const t3 = toDate(r.budgetApproved?.signedAt)
    const t4 = toDate(r.checkedBy?.signedAt)
    const t5 = toDate(r.approvedBy?.signedAt)
    const t6 = toDate(r.receivedAt || r.archivedAt)

    // PO Phase timestamps
    const tp0 = r.orderedAt ? toDate(r.orderedAt) : null
    const tp1 = r.poBudgetApproved?.signedAt ? toDate(r.poBudgetApproved.signedAt) : null
    const tp2 = r.poAuditApproved?.signedAt ? toDate(r.poAuditApproved.signedAt) : null
    const tp3 = r.poGMApproved?.signedAt ? toDate(r.poGMApproved.signedAt) : null

    if (t0 && t1) {
      stageVelocity.submission_to_recommend.total += Math.max(0, t1 - t0)
      stageVelocity.submission_to_recommend.count++
    }
    if (t1 && t2) {
      stageVelocity.recommend_to_inventory.total += Math.max(0, t2 - t1)
      stageVelocity.recommend_to_inventory.count++
    }
    if (t2 && t3) {
      stageVelocity.inventory_to_budget.total += Math.max(0, t3 - t2)
      stageVelocity.inventory_to_budget.count++
    }
    if (t3 && t4) {
      stageVelocity.budget_to_audit.total += Math.max(0, t4 - t3)
      stageVelocity.budget_to_audit.count++
    }
    if (t4 && t5) {
      stageVelocity.audit_to_gm.total += Math.max(0, t5 - t4)
      stageVelocity.audit_to_gm.count++
    }
    if (t5 && t6 && r.purchaseStatus === PURCHASE_STATUS.RECEIVED) {
      stageVelocity.gm_to_fulfillment.total += Math.max(0, t6 - t5)
      stageVelocity.gm_to_fulfillment.count++
    }

    // New PO Phase Velocity
    if (t5 && tp0) {
      // Req Approved -> PO First Issued
      stageVelocity.req_appr_to_po_issue.total += Math.max(0, tp0 - t5)
      stageVelocity.req_appr_to_po_issue.count++
    }
    if (tp0 && tp1) {
      stageVelocity.po_issue_to_po_budget.total += Math.max(0, tp1 - tp0)
      stageVelocity.po_issue_to_po_budget.count++
    }
    if (tp1 && tp2) {
      stageVelocity.po_budget_to_po_audit.total += Math.max(0, tp2 - tp1)
      stageVelocity.po_budget_to_po_audit.count++
    }
    if (tp2 && tp3) {
      stageVelocity.po_audit_to_po_gm.total += Math.max(0, tp3 - tp2)
      stageVelocity.po_audit_to_po_gm.count++
    }
  })

  // Factor rejected into Lead Time (Submission -> Rejection)
  rejectedInRangeFull.forEach((r) => {
    const created = toDate(r.createdAt || r.date)
    const archived = toDate(r.archivedAt)
    if (created && archived) {
      totalLeadTimeMs += archived - created
      leadTimeCount++
    }
  })

  // --- START ACTIVE AGING LOGIC ---
  activeInRange.forEach((r) => {
    // Lead Time Aging (Real-time)
    const createdForLT = toDate(r.createdAt || r.date)
    const archivedForLT = toDate(r.archivedAt)
    if (createdForLT && !archivedForLT) {
      totalLeadTimeMs += Math.max(0, now - createdForLT)
      leadTimeCount++
    }

    // REQUISITION Stages
    if (r.status === REQUISITION_STATUS.PENDING_RECOMMENDATION) {
      const entry = toDate(r.createdAt || r.date)
      if (entry) {
        stageVelocity.submission_to_recommend.activeTotal += Math.max(0, now - entry)
        stageVelocity.submission_to_recommend.activeCount++
      }
    } else if (r.status === REQUISITION_STATUS.PENDING_INVENTORY) {
      const entry = toDate(r.recommendingApproval?.signedAt)
      if (entry) {
        stageVelocity.recommend_to_inventory.activeTotal += Math.max(0, now - entry)
        stageVelocity.recommend_to_inventory.activeCount++
      }
    } else if (r.status === REQUISITION_STATUS.PENDING_BUDGET) {
      const entry = toDate(r.inventoryChecked?.signedAt)
      if (entry) {
        stageVelocity.inventory_to_budget.activeTotal += Math.max(0, now - entry)
        stageVelocity.inventory_to_budget.activeCount++
      }
    } else if (r.status === REQUISITION_STATUS.PENDING_AUDIT) {
      const entry = toDate(r.budgetApproved?.signedAt)
      if (entry) {
        stageVelocity.budget_to_audit.activeTotal += Math.max(0, now - entry)
        stageVelocity.budget_to_audit.activeCount++
      }
    } else if (r.status === REQUISITION_STATUS.PENDING_APPROVAL) {
      const entry = toDate(r.checkedBy?.signedAt)
      if (entry) {
        stageVelocity.audit_to_gm.activeTotal += Math.max(0, now - entry)
        stageVelocity.audit_to_gm.activeCount++
      }
    } else if (
      r.status === REQUISITION_STATUS.APPROVED &&
      (r.purchaseStatus || PURCHASE_STATUS.PENDING) === PURCHASE_STATUS.PENDING
    ) {
      const entry = toDate(r.approvedBy?.signedAt)
      if (entry) {
        stageVelocity.gm_to_fulfillment.activeTotal += Math.max(0, now - entry)
        stageVelocity.gm_to_fulfillment.activeCount++
      }
    }

    // PO Stages
    if (r.status === REQUISITION_STATUS.APPROVED && !r.poStatus) {
      const entry = toDate(r.approvedBy?.signedAt)
      if (entry) {
        stageVelocity.req_appr_to_po_issue.activeTotal += Math.max(0, now - entry)
        stageVelocity.req_appr_to_po_issue.activeCount++
      }
    } else if (r.poStatus === PO_STATUS.PENDING_BUDGET) {
      const entry = r.orderedAt ? toDate(r.orderedAt) : null
      if (entry) {
        stageVelocity.po_issue_to_po_budget.activeTotal += Math.max(0, now - entry)
        stageVelocity.po_issue_to_po_budget.activeCount++
      }
    } else if (r.poStatus === PO_STATUS.PENDING_AUDIT) {
      const entry = toDate(r.poBudgetApproved?.signedAt)
      if (entry) {
        stageVelocity.po_budget_to_po_audit.activeTotal += Math.max(0, now - entry)
        stageVelocity.po_budget_to_po_audit.activeCount++
      }
    } else if (r.poStatus === PO_STATUS.PENDING_GM) {
      const entry = toDate(r.poAuditApproved?.signedAt)
      if (entry) {
        stageVelocity.po_audit_to_po_gm.activeTotal += Math.max(0, now - entry)
        stageVelocity.po_audit_to_po_gm.activeCount++
      }
    }
  })
  // --- END ACTIVE AGING LOGIC ---

  const avgLeadTimeDays =
    leadTimeCount > 0 ? (totalLeadTimeMs / leadTimeCount / (1000 * 60 * 60 * 24)).toFixed(1) : '—'

  const bottlenecks = Object.entries(stageVelocity).map(([stage, v]) => ({
    stage,
    avgDays: v.count > 0 ? (v.total / v.count / (1000 * 60 * 60 * 24)).toFixed(2) : 0,
    activeCount: v.activeCount || 0,
    activeAvgDays:
      v.activeCount > 0 ? (v.activeTotal / v.activeCount / (1000 * 60 * 60 * 24)).toFixed(2) : 0,
  }))

  const avgOrderValue = approvedCount > 0 ? totalApprovedValue / approvedCount : 0

  const departmentalSpend = Object.entries(deptSpendMap)
    .map(([department, total]) => ({
      department,
      total,
      pct: totalApprovedValue > 0 ? Math.round((total / totalApprovedValue) * 100) : 0,
    }))
    .sort((a, b) => b.total - a.total)

  const poPipeline = {
    [PO_STATUS.PENDING_BUDGET]: 0,
    [PO_STATUS.PENDING_AUDIT]: 0,
    [PO_STATUS.PENDING_GM]: 0,
    [PO_STATUS.APPROVED]: 0,
  }
  activeInRange.forEach((r) => {
    if (r.poStatus && poPipeline[r.poStatus] !== undefined) {
      poPipeline[r.poStatus]++
    }
  })
  const poPipelineTotal = activeInRange.filter((r) => !!r.poStatus).length
  const poPipelineWithPct = Object.entries(poPipeline).map(([status, count]) => ({
    status,
    count,
    pct: poPipelineTotal > 0 ? Math.round((count / poPipelineTotal) * 100) : 0,
  }))

  return {
    summary: {
      pendingApproval: pendingInRange.length,
      approvedThisMonth: approvedCount,
      rejectedThisMonth: rejectedCount,
      approvedNotYetPurchased,
      approvedPct,
      rejectedPct,
      notYetPurchasedPct,
      avgLeadTimeDays,
      totalApprovedValue,
      avgOrderValue,
    },
    pipeline,
    pipelineWithPct,
    pipelineTotal,
    poPipeline,
    poPipelineWithPct,
    poPipelineTotal,
    byDepartment,
    monthlyTrend,
    approvedVsRejected: {
      approved: approvedCount,
      rejected: rejectedCount,
      approvedPct,
      rejectedPct,
    },
    purchaseBreakdown: {
      pending: purchasePending,
      ordered: purchaseOrdered,
      received: purchaseReceived,
      pendingPct: purchasePendingPct,
      orderedPct: purchaseOrderedPct,
      receivedPct: purchaseReceivedPct,
    },
    productivity: {
      avgLeadTimeDays,
      bottlenecks,
    },
    financials: {
      totalApprovedValue,
      avgOrderValue,
      departmentalSpend,
      highValueReqs: highValueReqs.sort((a, b) => b.total - a.total).slice(0, 5),
    },
  }
}

/**
 * Submit a requisition for approval (move from draft to pending_recommendation).
 * Optional requestedBy (e.g. with signatureUrl) is applied when the requestor submits.
 */
export async function submitRequisition(id, updates = {}) {
  const res = await updateRequisition(id, {
    status: REQUISITION_STATUS.PENDING_RECOMMENDATION,
    ...updates,
  })

  // 1. Log the submission in Transaction Log
  try {
    const req = await getRequisition(id)
    if (req) {
      await appendTransactionLog(
        id,
        {
          action: 'submitted',
          userId: req.requestedBy?.userId || '',
          name: req.requestedBy?.name || 'Requestor',
          title: 'Requestor',
          email: req.requestedBy?.email || '',
          step: 'submission',
          remarks: 'Submitted for approval',
        },
        {
          statusBefore: 'DRAFT',
          statusAfter: REQUISITION_STATUS.PENDING_RECOMMENDATION,
          rfControlNo: req.rfControlNo,
          purpose: (req.purpose || '').slice(0, 200),
        },
      )
    }
  } catch (err) {
    console.warn('[submitRequisition] Failed to log transaction:', err)
  }

  // Notification: Notify Assigned Approver and Requestor (Receipt)
  try {
    let req = await getRequisition(id)
    req = await ensureRequestorEmail(req)

    // 1. Receipt to Requestor
    await notificationService.notifySubmissionReceipt(req)

    // 2. Alert to Assigned Approver
    if (req.assignedApproverId) {
      // Fetch specific approver email
      const userRef = doc(db, COLLECTIONS.USERS, req.assignedApproverId)
      const userSnap = await getDoc(userRef)
      if (userSnap.exists()) {
        const userData = userSnap.data()
        if (userData.email && userData.isActive !== false) {
          await notificationService.notifyNextApprover(
            req,
            userData.role || 'Manager',
            userData.email,
          )
        }
      }
    } else {
      // Legacy Fallback: Notify all Managers of the same department
      const managerRoles = [
        USER_ROLES.SECTION_HEAD,
        USER_ROLES.DIVISION_HEAD,
        USER_ROLES.DEPARTMENT_HEAD,
      ]
      const managers = await getEmailsByRoles(managerRoles)

      const targetEmails = managers
        .filter((m) => {
          if (!m.department || !req.department) return false
          return m.department.trim().toUpperCase() === req.department.trim().toUpperCase()
        })
        .map((m) => m.email)
        .filter((e) => !!e)

      if (targetEmails.length > 0) {
        await notificationService.notifyNextApprover(req, 'Manager', targetEmails)
      }
    }
  } catch (e) {
    console.error('Submission notification error:', e)
  }

  // Audit Log Entry for Submission
  await appendTransactionLog(
    id,
    {
      action: 'submitted',
      userId: updates.requestedBy?.userId ?? '',
      name: updates.requestedBy?.name ?? 'Requestor',
      title: 'Requestor',
      email: updates.requestedBy?.email ?? '',
      step: 'submission',
    },
    {
      statusBefore: REQUISITION_STATUS.DRAFT,
      statusAfter: REQUISITION_STATUS.PENDING_RECOMMENDATION,
      rfControlNo: (await getRequisition(id))?.rfControlNo ?? '',
      purpose: ((await getRequisition(id))?.purpose ?? '').slice(0, 200),
    },
  )

  return res
}

/**
 * Approval workflow configuration
 * Maps each role to the status they can approve and the next status after approval
 */
export const APPROVAL_WORKFLOW = {
  section_head: {
    canApproveStatus: REQUISITION_STATUS.PENDING_RECOMMENDATION,
    nextStatus: REQUISITION_STATUS.PENDING_INVENTORY,
    field: 'recommendingApproval',
    title: 'Section Head',
  },
  division_head: {
    canApproveStatus: REQUISITION_STATUS.PENDING_RECOMMENDATION,
    nextStatus: REQUISITION_STATUS.PENDING_INVENTORY,
    field: 'recommendingApproval',
    title: 'Manager',
  },
  department_head: {
    canApproveStatus: REQUISITION_STATUS.PENDING_RECOMMENDATION,
    nextStatus: REQUISITION_STATUS.PENDING_INVENTORY,
    field: 'recommendingApproval',
    title: 'Supervisor',
  },
  warehouse_head: {
    canApproveStatus: REQUISITION_STATUS.PENDING_INVENTORY,
    nextStatus: REQUISITION_STATUS.PENDING_BUDGET,
    field: 'inventoryChecked',
    title: 'Warehouse Section Head',
  },
  budget_officer: {
    canApproveStatus: REQUISITION_STATUS.PENDING_BUDGET,
    nextStatus: REQUISITION_STATUS.PENDING_AUDIT,
    field: 'budgetApproved',
    title: 'Acctg. Div. Supervisor / Budget Officer',
  },
  internal_auditor: {
    canApproveStatus: REQUISITION_STATUS.PENDING_AUDIT,
    nextStatus: REQUISITION_STATUS.PENDING_APPROVAL,
    field: 'checkedBy',
    title: 'Internal Auditor',
  },
  general_manager: {
    canApproveStatus: REQUISITION_STATUS.PENDING_APPROVAL,
    nextStatus: REQUISITION_STATUS.APPROVED,
    field: 'approvedBy',
    title: 'General Manager',
  },
}

/**
 * Write one entry to the transaction log (all approval/decline actions by any role). Used by Logs page.
 * entry: { action, userId, name, title, email?, remarks?, step }
 * snapshot: { statusBefore, statusAfter, rfControlNo, purpose? }
 */
async function appendTransactionLog(requisitionId, entry, snapshot = {}) {
  const signedAt = new Date().toISOString()
  const fullEntry = { requisitionId, ...entry, ...snapshot, signedAt }
  const ref = collection(db, COLLECTIONS.TRANSACTION_LOG)
  await addDoc(ref, fullEntry)
}

/**
 * Append Internal Auditor log entry on the requisition doc only (for detail view section).
 * Transaction log is written by approveRequisition/declineRequisition for all roles.
 */
async function appendInternalAuditorLog(id, entry, snapshot = {}) {
  const current = await getRequisition(id)
  const log = Array.isArray(current?.internalAuditorLog) ? current.internalAuditorLog : []
  const signedAt = new Date().toISOString()
  const fullEntry = { ...entry, ...snapshot, signedAt }
  await updateRequisition(id, {
    internalAuditorLog: [...log, fullEntry],
  })
}

/** Max transaction log entries to load on Logs page */
export const AUDIT_LOG_LIMIT = 500

/**
 * List transaction log entries with pagination (for Logs page). All approval/decline actions by any role.
 * @param {object} options - { pageSize = 50, startAfter = null }
 */
export async function listAuditLogEntries(options = {}) {
  const pageSize = options.pageSize ?? 50
  const startAfterDoc = options.startAfter ?? null

  let q = query(collection(db, COLLECTIONS.TRANSACTION_LOG), orderBy('signedAt', 'desc'))

  if (startAfterDoc) {
    q = query(q, startAfter(startAfterDoc), limit(pageSize))
  } else {
    q = query(q, limit(pageSize))
  }

  const snapshot = await getDocs(q)
  const entries = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))

  return {
    entries,
    lastDoc: snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null,
    hasMore: snapshot.docs.length === pageSize,
  }
}

/**
 * Delete a single transaction log entry (used after CSV export).
 */
export async function deleteTransactionLogEntry(entryId) {
  const ref = doc(db, COLLECTIONS.TRANSACTION_LOG, entryId)
  await deleteDoc(ref)
}

/**
 * Fetch all transaction log entries for a specific requisition ID.
 * Used to show complete history regardless of main log pagination.
 */
export async function getAuditLogsForRequisition(requisitionId, rfControlNo = null) {
  if (!requisitionId && !rfControlNo) return []
  
  // 1. Determine RF number to search by
  let rf = rfControlNo
  if (!rf && requisitionId) {
    const req = await getRequisition(requisitionId)
    rf = req?.rfControlNo
  }
  
  // 2. Query by ID (if available)
  let qId = null
  if (requisitionId) {
    qId = query(
      collection(db, COLLECTIONS.TRANSACTION_LOG),
      where('requisitionId', '==', requisitionId)
    )
  }
  
  // 3. Query by RF (if available)
  let qRf = null
  if (rf) {
    qRf = query(
      collection(db, COLLECTIONS.TRANSACTION_LOG),
      where('rfControlNo', '==', rf)
    )
  }

  const [snapId, snapRf] = await Promise.all([
    getDocs(qId),
    rf ? getDocs(qRf) : Promise.resolve({ docs: [] })
  ])

  // 4. Merge and deduplicate
  const map = new Map()
  const allDocs = [...snapId.docs, ...snapRf.docs]
  allDocs.forEach(d => {
    map.set(d.id, { id: d.id, ...d.data() })
  })

  // 5. Final Sort (Map doesn't preserve custom order well after merge)
  return Array.from(map.values()).sort((a, b) => {
    const dateA = a.signedAt ? (a.signedAt.toDate ? a.signedAt.toDate() : new Date(a.signedAt)) : 0
    const dateB = b.signedAt ? (b.signedAt.toDate ? b.signedAt.toDate() : new Date(b.signedAt)) : 0
    return dateB - dateA
  })
}

/**
 * Get total count of audit log entries (for pagination info)
 */
export async function getAuditLogCount() {
  const q = query(collection(db, COLLECTIONS.TRANSACTION_LOG))
  const snapshot = await getDocs(q)
  return snapshot.size
}

/**
 * Approve a requisition based on the approver's role
 */
export async function approveRequisition(id, approver, role) {
  const workflow = APPROVAL_WORKFLOW[role]
  if (!workflow) throw new Error('Invalid approver role')

  const current = await getRequisition(id)

  // First-to-Action Validation: Check if the requisition was already approved by a colleague
  if (current.status !== workflow.canApproveStatus) {
    throw new Error(
      `This requisition is no longer pending your approval. It is currently at: ${current.status}. It may have already been processed by a colleague.`,
    )
  }
  const signedAt = new Date().toISOString()

  const updateData = {
    status: workflow.nextStatus,
    [workflow.field]: {
      userId: approver.userId,
      name: approver.name,
      title: workflow.title,
      signedAt,
    },
  }
  if (workflow.nextStatus === REQUISITION_STATUS.APPROVED) {
    updateData.archivedAt = serverTimestamp()
    updateData.canvassStatus = CANVASS_STATUS.PENDING
    updateData.purchaseStatus = PURCHASE_STATUS.PENDING
  }

  // For the internal auditor: append log entry in the SAME write as the status change.
  // This avoids a second write after the status has already moved to pending_approval,
  // which would be rejected by Firestore rules.
  if (role === 'internal_auditor') {
    const snapshot = {
      statusBefore: current?.status ?? '',
      statusAfter: workflow.nextStatus,
      rfControlNo: current?.rfControlNo ?? '',
      purpose: (current?.purpose ?? '').slice(0, 200),
    }
    const log = Array.isArray(current?.internalAuditorLog) ? current.internalAuditorLog : []
    updateData.internalAuditorLog = [
      ...log,
      {
        action: 'approved',
        userId: approver.userId,
        name: approver.name,
        title: workflow.title,
        email: approver.email ?? '',
        ...snapshot,
        signedAt,
      },
    ]
  }

  await updateRequisition(id, updateData)

  // Save signature separately (base64) so requisition doc stays small.
  if (approver?.signatureData) {
    await upsertRequisitionSignature(id, workflow.field, {
      userId: approver.userId,
      name: approver.name,
      title: workflow.title,
      signedAt,
      signatureData: approver.signatureData,
    })
  }

  const snapshot = {
    statusBefore: current?.status ?? '',
    statusAfter: workflow.nextStatus,
    rfControlNo: current?.rfControlNo ?? '',
    purpose: (current?.purpose ?? '').slice(0, 200),
  }
  await appendTransactionLog(
    id,
    {
      action: 'approved',
      userId: approver.userId,
      name: approver.name,
      title: workflow.title,
      email: approver.email ?? '',
      step: role,
    },
    snapshot,
  )

  // Notifications logic
  try {
    const reqWithEmail = await ensureRequestorEmail(current)
    const nextWorkflow = Object.entries(APPROVAL_WORKFLOW).find(
      ([, w]) => w.canApproveStatus === workflow.nextStatus,
    )

    if (nextWorkflow) {
      const [nextRole] = nextWorkflow
      const nextEmails = await getEmailsByRole(nextRole)
      if (nextEmails.length > 0) {
        await notificationService.notifyNextApprover(reqWithEmail, nextRole, nextEmails)
      }
      // Step-by-Step Notification: Inform requestor it moved to the next role
      await notificationService.notifyRequestorUpdate(reqWithEmail, 'Step Approved', '', nextRole)
    } else if (workflow.nextStatus === REQUISITION_STATUS.APPROVED) {
      // Final Approval: Inform requestor and explicitly mention Purchaser phase
      await notificationService.notifyRequestorUpdate(reqWithEmail, 'approved', '', 'Purchaser')
      // Notify Purchaser
      const purchaserEmails = await getEmailsByRole(USER_ROLES.PURCHASER)
      if (purchaserEmails.length > 0) {
        await notificationService.notifyNextApprover(reqWithEmail, 'Purchaser', purchaserEmails)
      }
    }
  } catch (e) {
    console.error('Approval notification error:', e)
  }

  return getRequisition(id)
}

/**
 * Decline/Reject a requisition with remarks
 */
export async function declineRequisition(id, approver, remarks, role) {
  const workflow = APPROVAL_WORKFLOW[role]
  const title = workflow?.title || 'Approver'
  const signedAt = new Date().toISOString()

  const current = await getRequisition(id)

  const updateData = {
    status: REQUISITION_STATUS.REJECTED,
    isArchived: true,
    archivedAt: serverTimestamp(),
    rejectedBy: {
      userId: approver.userId,
      name: approver.name,
      title: title,
      signedAt,
      remarks: remarks || '',
    },
  }

  // For the internal auditor: merge log update into the SAME write as the status change.
  // A second write after status is 'rejected' would be denied by Firestore rules.
  if (role === 'internal_auditor') {
    const snapshot = {
      statusBefore: current?.status ?? '',
      statusAfter: REQUISITION_STATUS.REJECTED,
      rfControlNo: current?.rfControlNo ?? '',
      purpose: (current?.purpose ?? '').slice(0, 200),
    }
    const log = Array.isArray(current?.internalAuditorLog) ? current.internalAuditorLog : []
    updateData.internalAuditorLog = [
      ...log,
      {
        action: 'declined',
        userId: approver.userId,
        name: approver.name,
        title: title,
        email: approver.email ?? '',
        remarks: remarks || '',
        ...snapshot,
        signedAt,
      },
    ]
  }

  await updateRequisition(id, updateData)

  const snapshot = {
    statusBefore: current?.status ?? '',
    statusAfter: REQUISITION_STATUS.REJECTED,
    rfControlNo: current?.rfControlNo ?? '',
    purpose: (current?.purpose ?? '').slice(0, 200),
  }
  await appendTransactionLog(
    id,
    {
      action: 'declined',
      userId: approver.userId,
      name: approver.name,
      title: title,
      email: approver.email ?? '',
      remarks: remarks || '',
      step: role,
    },
    snapshot,
  )

  // Notification: Notify Requestor of Rejection
  try {
    console.log('[RequisitionService] Attempting to notify requestor of rejection:', id)
    const reqWithEmail = await ensureRequestorEmail(current)
    await notificationService.notifyRequestorUpdate(reqWithEmail, 'rejected', remarks)
  } catch (e) {
    console.error('Rejection notification error:', e)
  }

  return getRequisition(id)
}

/**
 * Check if a user can approve a requisition based on their role and the requisition status
 */
export function canUserApprove(role, requisitionStatus) {
  const workflow = APPROVAL_WORKFLOW[role]
  if (!workflow) return false
  return requisitionStatus === workflow.canApproveStatus
}

/** Human-readable "currently at" label per status (for requestor log/tracking) */
const STATUS_TO_CURRENT_STEP = {
  [REQUISITION_STATUS.DRAFT]: 'Draft (not yet submitted)',
  [REQUISITION_STATUS.PENDING_RECOMMENDATION]: 'Section Head / Div. Head / Dept. Head',
  [REQUISITION_STATUS.PENDING_INVENTORY]: 'Warehouse Section Head',
  [REQUISITION_STATUS.PENDING_BUDGET]: 'Acctg. / Budget Officer',
  [REQUISITION_STATUS.PENDING_AUDIT]: 'Internal Auditor',
  [REQUISITION_STATUS.PENDING_APPROVAL]: 'General Manager',
  [REQUISITION_STATUS.APPROVED]: 'Approved',
  [REQUISITION_STATUS.REJECTED]: 'Rejected',
}

/**
 * Get current step label and department for a requisition (for requestor "where is my request")
 */
export function getRequisitionCurrentStep(requisition) {
  if (!requisition) return { label: '—', department: requisition?.department ?? '—' }
  const status = requisition.status
  let label = STATUS_TO_CURRENT_STEP[status] || status

  if (status === REQUISITION_STATUS.APPROVED) {
    if (requisition.isArchived) {
      label = 'Finished / Archived'
    } else if (requisition.purchaseStatus === PURCHASE_STATUS.ORDERED) {
      label = 'In Receiving'
    } else if (requisition.canvassStatus === CANVASS_STATUS.SUBMITTED_TO_BAC) {
      label = 'PO Approval'
    } else {
      label = 'Procurement Hub'
    }
  }

  const department = requisition.department || '—'
  return { label, department }
}

/**
 * Build a status log (timeline) for a requisition so requestors can see where it's been
 */
export function getRequisitionStatusLog(requisition) {
  if (!requisition) return { currentStep: null, entries: [] }
  const entries = []
  const req = requisition

  if (req.requestedBy) {
    entries.push({
      step: 'Submitted',
      role: 'Requestor',
      department: req.department || '—',
      by: req.requestedBy.name,
      at: req.requestedBy.signedAt,
      done: true,
    })
  }

  const steps = [
    {
      key: 'recommendingApproval',
      status: REQUISITION_STATUS.PENDING_RECOMMENDATION,
      role: 'Manager (Sec/Div/Dept)',
    },
    {
      key: 'inventoryChecked',
      status: REQUISITION_STATUS.PENDING_INVENTORY,
      role: 'Warehouse Section Head',
    },
    {
      key: 'budgetApproved',
      status: REQUISITION_STATUS.PENDING_BUDGET,
      role: 'Acctg. / Budget Officer',
    },
    { key: 'checkedBy', status: REQUISITION_STATUS.PENDING_AUDIT, role: 'Internal Auditor' },
    { key: 'approvedBy', status: REQUISITION_STATUS.PENDING_APPROVAL, role: 'General Manager' },
  ]

  for (const { key, status, role } of steps) {
    const data = req[key]
    const isCurrent = req.status === status
    entries.push({
      step: role,
      role: data?.title || role,
      department: req.department || '—',
      by: data?.name ?? null,
      at: data?.signedAt ?? null,
      done: !!data,
      isCurrent,
    })
  }

  if (req.status === REQUISITION_STATUS.REJECTED && req.rejectedBy) {
    entries.push({
      step: 'Rejected',
      role: req.rejectedBy.title || 'Approver',
      department: req.department || '—',
      by: req.rejectedBy.name,
      at: req.rejectedBy.signedAt,
      remarks: req.rejectedBy.remarks,
      done: true,
      isRejection: true,
    })
  }

  const currentStep = getRequisitionCurrentStep(requisition)
  return { currentStep, entries }
}

/**
 * Build a status log (timeline) for a Purchase Order approval
 */
export function getPOStatusLog(requisition) {
  if (!requisition || !requisition.poStatus) return { currentStep: null, entries: [] }
  const r = requisition
  const entries = []

  // 1. Initial Step: PO Issued
  const orderedBy = r.orderedBy
  entries.push({
    step: 'PO Issued',
    role: orderedBy?.role === USER_ROLES.BAC_SECRETARY ? 'BAC Secretary' : 'Purchaser',
    by: orderedBy?.name ?? null,
    at: r.orderedAt ?? null,
    done: !!r.orderedAt,
    current: false,
  })

  const steps = [
    {
      key: 'poBudgetApproved',
      status: PO_STATUS.PENDING_BUDGET,
      role: 'Acctg. Div. Supervisor / Budget Officer',
    },
    {
      key: 'poAuditApproved',
      status: PO_STATUS.PENDING_AUDIT,
      role: 'Internal Auditor',
    },
    {
      key: 'poGMApproved',
      status: PO_STATUS.PENDING_GM,
      role: 'General Manager',
    },
  ]

  for (const { key, status, role } of steps) {
    const data = r[key]
    const isCurrent = r.poStatus === status

    // Logic: A step is "done" if we have its data (signature/timestamp)
    // OR if the PO is already approved (meaning we passed this step).
    const isDone = !!data || r.poStatus === PO_STATUS.APPROVED

    entries.push({
      step: role,
      role,
      by: data?.name ?? null,
      at: data?.signedAt ?? null,
      done: isDone,
      current: isCurrent,
    })
  }

  // Final 'Issued' step indicator (only if approved)
  if (r.poStatus === PO_STATUS.APPROVED) {
    entries.push({
      step: 'PO Fully Approved',
      role: 'System',
      by: 'Automatic',
      at: r.poGMApproved?.signedAt,
      done: true,
      current: true,
    })
  }

  return { entries }
}

/**
 * Subscribe to requisitions in realtime (first page only). Use loadMoreRequisitions for next pages.
 * @param {object} filters - optional { status, department, requestedBy }
 * @param {function} callback - (results, lastDoc) => void — lastDoc is for "Load more"
 * @param {function} onError - optional (err) => void
 * @param {object} opts - { pageSize = REQUISITION_PAGE_SIZE }
 * @returns {function} unsubscribe
 */
export function subscribeRequisitions(filters, callback, onError, opts = {}) {
  const pageSize = opts.pageSize ?? REQUISITION_PAGE_SIZE
  const startAfterDoc = opts.startAfter ?? null
  const q = buildRequisitionsQuery(filters || {}, { pageSize, startAfterDoc })
  return subscribeWithFallback(
    q,
    true,
    (snapshot) => {
      let results = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))
      // server-side handled status, purchaseStatus, and singular canvassStatus mostly
      // but keeping safety checks for client-side fallback/arrays
      if (filters?.status) {
        if (Array.isArray(filters.status)) {
          results = results.filter((r) => filters.status.includes(r.status))
        } else {
          results = results.filter((r) => r.status === filters.status)
        }
      }
      if (filters?.purchaseStatus) {
        results = results.filter(
          (r) => (r.purchaseStatus || PURCHASE_STATUS.PENDING) === filters.purchaseStatus,
        )
      }
      if (filters?.department) results = results.filter((r) => r.department === filters.department)
      if (filters?.canvassStatus) {
        const target = filters.canvassStatus
        if (Array.isArray(target)) {
          results = results.filter((r) =>
            target.includes(r.canvassStatus || CANVASS_STATUS.PENDING),
          )
        } else if (results.length > 0) {
          results = results.filter((r) => (r.canvassStatus || CANVASS_STATUS.PENDING) === target)
        }
      }
      if (filters?.poStatus !== undefined) {
        const target = filters.poStatus
        if (Array.isArray(target)) {
          results = results.filter((r) => target.includes(r.poStatus ?? null))
        } else {
          results = results.filter((r) => r.poStatus === target)
        }
      }
      const lastDoc = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null
      callback(results, lastDoc)
    },
    (err) => {
      if (onError) onError(err)
    },
  )
}

/**
 * Get aggregated statistics for a department manager.
 * Returns counts for department total, personal drafts, and personal active approvals.
 */
export async function getDepartmentManagerStats(dept, userId, activeStatus) {
  if (!dept || !userId) return null
  const base = collection(db, COLLECTIONS.REQUISITIONS)
  const targetDept = dept.trim().toUpperCase()

  const queries = {
    total: query(base, where('department', '==', targetDept)),
    draft: query(
      base,
      where('requestedBy.userId', '==', userId),
      where('status', '==', REQUISITION_STATUS.DRAFT),
    ),
    approved: query(
      base,
      where('department', '==', targetDept),
      where('status', '==', REQUISITION_STATUS.APPROVED),
    ),
    // Active is anything in the department assigned specifically to this user
    pending: query(
      base,
      where('department', '==', targetDept),
      where('assignedApproverId', '==', userId),
      where('status', '==', activeStatus),
    ),
  }

  const results = {}
  await Promise.all(
    Object.entries(queries).map(async ([key, q]) => {
      const snapshot = await getCountFromServer(q)
      results[key] = snapshot.data().count
    }),
  )

  return results
}

/**
 * Get aggregated statistics for a specific user.
 * Returns counts for total, drafts, pending, approved, and rejected.
 */
export async function getUserRequisitionStats(userId) {
  if (!userId) return null
  const base = collection(db, COLLECTIONS.REQUISITIONS)

  const queries = {
    total: query(base, where('requestedBy.userId', '==', userId)),
    draft: query(
      base,
      where('requestedBy.userId', '==', userId),
      where('status', '==', REQUISITION_STATUS.DRAFT),
    ),
    approved: query(
      base,
      where('requestedBy.userId', '==', userId),
      where('status', '==', REQUISITION_STATUS.APPROVED),
    ),
    rejected: query(
      base,
      where('requestedBy.userId', '==', userId),
      where('status', '==', REQUISITION_STATUS.REJECTED),
    ),
    // Pending is anything starting with 'pending_'
    // Using Firestore inequality/range query for prefix match
    pending: query(
      base,
      where('requestedBy.userId', '==', userId),
      where('status', '>=', 'pending_'),
      where('status', '<=', 'pending_\uf8ff'),
    ),
  }

  const results = {}
  await Promise.all(
    Object.entries(queries).map(async ([key, q]) => {
      const snapshot = await getCountFromServer(q)
      results[key] = snapshot.data().count
    }),
  )

  return results
}

/**
 * Fetch next page of requisitions (for "Load more"). One-time read, not realtime.
 * @param {object} filters - same as subscribeRequisitions
 * @param {DocumentSnapshot} startAfterDoc - last doc from previous page
 * @param {number} pageSize - default REQUISITION_PAGE_SIZE
 * @returns {Promise<{ requisitions, lastDoc, hasMore }>}
 */
export async function loadMoreRequisitions(
  filters,
  startAfterDoc,
  pageSize = REQUISITION_PAGE_SIZE,
) {
  return listRequisitions(filters, { pageSize, startAfter: startAfterDoc })
}

/**
 * Subscribe to archived requisitions (first page). Date/status filters applied client-side.
 * @param {function} callback - (results, lastDoc) => void
 * @param {function} onError - optional (err) => void
 * @param {object} opts - { pageSize = REQUISITION_PAGE_SIZE }
 * @returns {function} unsubscribe
 */
export function subscribeArchivedRequisitions(callback, onError, opts = {}) {
  const pageSize = opts.pageSize ?? REQUISITION_PAGE_SIZE
  const q = buildArchivedRequisitionsQuery({ pageSize })
  return subscribeWithFallback(
    q,
    true,
    (snapshot) => {
      const results = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))
      const lastDoc = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null
      callback(results, lastDoc)
    },
    (err) => {
      if (onError) onError(err)
    },
  )
}

/**
 * Load next page of archived requisitions (for "Load more" on Archive page).
 */
export async function loadMoreArchivedRequisitions(
  startAfterDoc,
  pageSize = REQUISITION_PAGE_SIZE,
) {
  const q = buildArchivedRequisitionsQuery({ pageSize, startAfterDoc })
  const snapshot = await getDocs(q)
  const results = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }))
  const lastDoc = snapshot.docs.length > 0 ? snapshot.docs[snapshot.docs.length - 1] : null
  const hasMore = snapshot.docs.length === pageSize
  return { requisitions: results, lastDoc, hasMore }
}

/**
 * Subscribe to a single requisition in realtime
 * @returns {function} unsubscribe
 */
export function subscribeRequisition(id, callback) {
  if (!id) return () => {}
  const docRef = doc(db, COLLECTIONS.REQUISITIONS, id)
  return subscribeWithFallback(docRef, false, (snapshot) => {
    if (!snapshot.exists()) {
      callback(null)
      return
    }
    callback({ id: snapshot.id, ...snapshot.data() })
  })
}

/**
 * Fetch Purchase Orders pending approval by the specified status (e.g. PENDING_BUDGET, PENDING_AUDIT)
 */
export async function getPOApprovals(status, limitVal = REQUISITION_PAGE_SIZE) {
  const q = query(
    collection(db, COLLECTIONS.REQUISITIONS),
    where('poStatus', '==', status),
    orderBy('orderedAt', 'desc'),
    limit(limitVal),
  )
  const snap = await getDocs(q)
  return snap.docs.map((doc) => ({ id: doc.id, ...doc.data() }))
}

/**
 * Subscribe to Purchase Orders by poStatus.
 */
export function subscribePOApprovals(status, onData, onError, limitVal = REQUISITION_PAGE_SIZE) {
  const q = query(
    collection(db, COLLECTIONS.REQUISITIONS),
    where('poStatus', '==', status),
    orderBy('orderedAt', 'desc'),
    limit(limitVal),
  )
  return subscribeWithFallback(q, true, onData, onError)
}

/**
 * Force-advance a requisition to the next step (Super Admin override)
 */
export async function forceAdvanceStep(id, user, reason) {
  // 1. Strict Authorization Check (Defensive)
  const userSnap = await getDoc(doc(db, COLLECTIONS.USERS, user.uid))
  const profile = userSnap.exists() ? userSnap.data() : null
  if (profile?.role !== USER_ROLES.SUPER_ADMIN) {
    throw new Error('Unauthorized: Only Super Administrators can force-advance workflows.')
  }

  const current = await getRequisition(id)
  if (!current) throw new Error('Requisition not found')

  const statusFlow = [
    REQUISITION_STATUS.PENDING_RECOMMENDATION,
    REQUISITION_STATUS.PENDING_INVENTORY,
    REQUISITION_STATUS.PENDING_BUDGET,
    REQUISITION_STATUS.PENDING_AUDIT,
    REQUISITION_STATUS.PENDING_APPROVAL,
    REQUISITION_STATUS.APPROVED,
  ]

  const currentIndex = statusFlow.indexOf(current.status)
  if (currentIndex === -1 || currentIndex === statusFlow.length - 1) {
    throw new Error(
      'This requisition cannot be advanced further or is in an invalid state for override.',
    )
  }

  const nextStatus = statusFlow[currentIndex + 1]
  const signedAt = new Date().toISOString()

  // 2. Enhanced Audit Context: Identify exactly what was bypassed
  const bypassedStep = STATUS_TO_CURRENT_STEP[current.status] || current.status
  const auditRemarks = `[ADMIN OVERRIDE] Bypassed "${bypassedStep}" stage. Reason: ${reason}`

  // 3. Digital Stamp: Mark the bypassed field as overridden
  const workflowEntry = Object.values(APPROVAL_WORKFLOW).find(
    (w) => w.canApproveStatus === current.status,
  )
  const sigField = workflowEntry?.field || null

  const updateData = {
    status: nextStatus,
    updatedAt: serverTimestamp(),
  }

  if (sigField) {
    updateData[sigField] = {
      name: '[ADMIN OVERRIDE]',
      signedAt,
      isOverride: true,
      overriddenBy: user.uid,
    }
  }

  if (nextStatus === REQUISITION_STATUS.APPROVED) {
    updateData.archivedAt = serverTimestamp()
    updateData.canvassStatus = CANVASS_STATUS.PENDING
    updateData.purchaseStatus = PURCHASE_STATUS.PENDING
  }

  // Audit Log Entry
  const auditEntry = {
    action: 'force_advance',
    userId: user.uid,
    name: profile.displayName || user.displayName || 'Super Admin',
    title: 'Super Administrator',
    email: user.email,
    remarks: auditRemarks,
    step: 'admin_override',
    systemNote: `Advanced from ${current.status} to ${nextStatus}`,
  }

  const snapshot = {
    statusBefore: current.status,
    statusAfter: nextStatus,
    rfControlNo: current.rfControlNo ?? '',
    purpose: (current.purpose ?? '').slice(0, 200),
  }

  // Write to internal auditor log for the requisition itself
  const log = Array.isArray(current.internalAuditorLog) ? current.internalAuditorLog : []
  updateData.internalAuditorLog = [...log, { ...auditEntry, ...snapshot, signedAt }]

  await updateRequisition(id, updateData)

  // Save "Stamp" signature if we bypassed a specific signature field
  if (sigField) {
    await upsertRequisitionSignature(id, sigField, {
      userId: user.uid,
      name: '[ADMIN OVERRIDE]',
      title: workflowEntry?.title || 'Administrator',
      signedAt,
      isOverride: true,
      signatureData: 'OVERRIDE_STAMP', // Marker for UI to show the stamp
    })
  }

  await appendTransactionLog(id, auditEntry, snapshot)

  return getRequisition(id)
}

/**
 * Void/Cancel a requisition (Super Admin override)
 */
export async function voidRequisition(id, user, reason) {
  // 1. Strict Authorization Check (Defensive)
  const userSnap = await getDoc(doc(db, COLLECTIONS.USERS, user.uid))
  const profile = userSnap.exists() ? userSnap.data() : null
  if (profile?.role !== USER_ROLES.SUPER_ADMIN) {
    throw new Error('Unauthorized: Only Super Administrators can void requisitions.')
  }

  const current = await getRequisition(id)
  if (!current) throw new Error('Requisition not found')

  const signedAt = new Date().toISOString()
  const statusBefore = current.status

  // 2. Burn/Retire the control number if it exists
  const controlNo = current.rfControlNo || 'DRAFT'
  const voidRemarks = `[VOIDED BY ADMIN] Control #: ${controlNo} is retired. Reason: ${reason}`

  const updateData = {
    status: REQUISITION_STATUS.REJECTED,
    isArchived: true,
    archivedAt: serverTimestamp(),
    voidedBy: {
      userId: user.uid,
      name: profile.displayName || user.displayName || 'Super Admin',
      signedAt,
      remarks: reason,
    },
    // Prevent any further modifications
    isVoided: true,
  }

  // Audit Log Entry
  const auditEntry = {
    action: 'void_requisition',
    userId: user.uid,
    name: profile.displayName || user.displayName || 'Super Admin',
    title: 'Super Administrator',
    email: user.email,
    remarks: voidRemarks,
    step: 'admin_override',
    systemNote: `Requisition ${controlNo} was permanently voided and retired.`,
  }

  const snapshot = {
    statusBefore,
    statusAfter: REQUISITION_STATUS.REJECTED,
    rfControlNo: controlNo,
    purpose: (current.purpose ?? '').slice(0, 200),
  }

  const log = Array.isArray(current.internalAuditorLog) ? current.internalAuditorLog : []
  updateData.internalAuditorLog = [...log, { ...auditEntry, ...snapshot, signedAt }]

  await updateRequisition(id, updateData)
  await appendTransactionLog(id, auditEntry, snapshot)

  return getRequisition(id)
}

/**
 * Migration utility for the Archive logic update.
 * Finds all requisitions that are either REJECTED or (APPROVED + RECEIVED) but missing 'isArchived' flag.
 * @returns {Promise<number>} Number of migrated docs
 */
export async function migrateLegacyArchivedRecords() {
  console.log('[Migration] Starting Archive Repair...')
  const base = collection(db, COLLECTIONS.REQUISITIONS)

  // 1. Find records that SHOULD be archived but aren't
  console.log('[Migration] Fetching records to archive...')
  const toArchiveSnaps = await Promise.all([
    getDocs(query(base, where('status', '==', REQUISITION_STATUS.REJECTED))),
    getDocs(
      query(
        base,
        where('status', '==', REQUISITION_STATUS.APPROVED),
        where('purchaseStatus', '==', PURCHASE_STATUS.RECEIVED),
      ),
    ),
  ]).catch(err => {
    console.error('[Migration] Error fetching toArchiveSnaps:', err)
    throw err
  })

  // 2. Find records that SHOULD NOT be archived but are (the current bug fix)
  console.log('[Migration] Fetching prematurely archived records...')
  const prematurelyArchivedSnap = await getDocs(
    query(
      base,
      where('status', '==', REQUISITION_STATUS.APPROVED),
      where('isArchived', '==', true),
    ),
  ).catch(err => {
    console.error('[Migration] Error fetching prematurelyArchivedSnap:', err)
    throw err
  })

  console.log('[Migration] Starting batch updates...')
  const batch = writeBatch(db)
  let count = 0

  // Handle Missing Archive Flags
  toArchiveSnaps.forEach((snap) => {
    snap.docs.forEach((d) => {
      const data = d.data()
      if (data.isArchived === undefined || data.isArchived === false) {
        batch.update(d.ref, {
          isArchived: true,
          archivedAt:
            data.archivedAt ?? data.receivedAt ?? data.rejectedBy?.signedAt ?? serverTimestamp(),
        })
        count++
      }
    })
  })

  // Handle Premature Archive Flags (Fix for the reported bug)
  prematurelyArchivedSnap.docs.forEach((d) => {
    const data = d.data()
    // If it's APPROVED but NOT RECEIVED, it shouldn't be archived yet
    if (data.purchaseStatus !== PURCHASE_STATUS.RECEIVED) {
      batch.update(d.ref, {
        isArchived: false,
        archivedAt: null,
        // Ensure statuses are initialized so it shows in Purchaser Hub
        canvassStatus: data.canvassStatus || CANVASS_STATUS.PENDING,
        purchaseStatus: data.purchaseStatus || PURCHASE_STATUS.PENDING,
      })
      count++
    }
  })

  if (count > 0) {
    await batch.commit()
  }
  return count
}

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
