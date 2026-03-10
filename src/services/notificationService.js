/**
 * Notification Service
 * Sends email notifications via a 100% Free Google App Script Relay.
 * No Cloud Functions (Blaze Plan) required.
 */

const RELAY_URL =
  'https://script.google.com/macros/s/AKfycbzAFUB6_D5CTA1Mr-DZ1eqXUzsLTiFevyV62u_FIMMTZHLf-bisPVfOIsHsNdHi3r1Dhw/exec'
const SECRET_KEY = 'Leyeco2025Secret' // Symbol-free for URL safety

/**
 * Sends a raw email via the relay
 */
async function sendEmailRelay({ to, subject, htmlBody, body }) {
  if (!RELAY_URL) return console.warn('[Notification] No relay URL configured')

  try {
    console.log(`[Notification] Pinging relay for: ${to} | Subject: ${subject}`)
    // We send as a pure string because 'no-cors' forces headers to be simple.
    // This ensures Google's doPost(e) always sees the data in e.postData.contents.
    const response = await fetch(RELAY_URL, {
      method: 'POST',
      mode: 'no-cors',
      body: JSON.stringify({
        key: SECRET_KEY,
        to,
        subject,
        htmlBody,
        body: body || 'New notification',
      }),
    })
    console.log('[Notification] Email relay pinged successfully')
    return true
  } catch (error) {
    console.error('[Notification] Relay Error:', error)
    return false
  }
}

/**
 * Notifies the next approver(s) in the Requisition flow
 * @param {object} requisition The requisition document
 * @param {string} nextRole The next role name (e.g., 'Section Head')
 * @param {string|string[]} nextApproverEmails A single email string or an array of email strings
 */
export async function notifyNextApprover(requisition, nextRole, nextApproverEmails) {
  if (!nextApproverEmails) return
  const emails = Array.isArray(nextApproverEmails) ? nextApproverEmails : [nextApproverEmails]
  if (emails.length === 0) return

  const subject = `[Action Required] New Requisition for Review - ${requisition.rfControlNo || 'New'}`
  const appLink = `${window.location.origin}/all-requisitions`

  const htmlBody = `
    <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 650px; margin: 0 auto; background: #ffffff; border-radius: 20px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01);">
      <div style="background: linear-gradient(135deg, #7f1d1d 0%, #b91c1c 100%); padding: 40px 32px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 28px; letter-spacing: -0.03em; font-weight: 800;">LEYECO III</h1>
        <p style="color: rgba(255, 255, 255, 0.9); margin: 8px 0 0; font-size: 16px; font-weight: 500; letter-spacing: 0.02em;">Requisition Management System</p>
      </div>
      <div style="padding: 48px 40px;">
        <h2 style="color: #0f172a; margin: 0 0 16px; font-size: 24px; font-weight: 700; letter-spacing: -0.02em;">Approval Required</h2>
        <p style="color: #334155; line-height: 1.7; margin: 0 0 32px; font-size: 16px;">Greetings, a new requisition is pending review for the <strong style="color: #0f172a; font-weight: 700;">${nextRole}</strong> phase.</p>

        <div style="background: #f8fafc; border-radius: 16px; padding: 32px; border: 1px solid #e2e8f0; margin-bottom: 40px;">
          <table style="width: 100%; border-collapse: separate; border-spacing: 0 16px;">
            <tr>
              <td style="padding: 0; color: #64748b; font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; width: 160px; vertical-align: top;">Control Number</td>
              <td style="padding: 0; color: #0f172a; font-weight: 700; font-size: 16px; vertical-align: top;">
                ${requisition.rfControlNo ? `<span style="background: #e2e8f0; padding: 4px 10px; border-radius: 6px; color: #0f172a;">${requisition.rfControlNo}</span>` : '<span style="color: #64748b; font-style: italic; font-weight: 500; font-size: 14px; background: #f1f5f9; padding: 4px 10px; border-radius: 6px;">Pending Generation</span>'}
              </td>
            </tr>
            <tr>
              <td style="padding: 0; color: #64748b; font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; vertical-align: top;">Purpose</td>
              <td style="padding: 0; color: #1e293b; vertical-align: top; line-height: 1.6; font-size: 16px;">${requisition.purpose}</td>
            </tr>
            <tr>
              <td style="padding: 0; color: #64748b; font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 700; vertical-align: top;">Requested By</td>
              <td style="padding: 0; color: #1e293b; vertical-align: top; font-size: 16px; font-weight: 500;">${requisition.requestedBy?.name}</td>
            </tr>
          </table>
        </div>

        <div style="text-align: center;">
          <a href="${appLink}" style="display: inline-block; background: #b91c1c; color: #ffffff; padding: 16px 40px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 16px; transition: background 0.2s; box-shadow: 0 4px 6px -1px rgba(185, 28, 28, 0.2), 0 2px 4px -1px rgba(185, 28, 28, 0.1);">Open Dashboard</a>
        </div>
      </div>
      <div style="background: #f8fafc; padding: 24px; text-align: center; border-top: 1px solid #e2e8f0;">
        <p style="margin: 0; font-size: 13px; color: #64748b; font-weight: 500;">This is an automated priority notification broadcasted to all ${nextRole} personnel. Please do not reply.</p>
      </div>
    </div>
  `

  const promises = emails.map((email) => sendEmailRelay({ to: email, subject, htmlBody }))
  await Promise.allSettled(promises)
}

/**
 * Notifies the requestor of a status update (Approved/Rejected/Forwarded)
 */
export async function notifyRequestorUpdate(requisition, status, remarks = '', nextRole = '') {
  console.log('[Notification] notifyRequestorUpdate triggered:', {
    id: requisition.id,
    status,
    nextRole,
  })
  const email = requisition.requestedBy?.email
  if (!email) {
    console.warn('[Notification] No requestor email found for requisition:', requisition.id)
    return
  }
  console.log('[Notification] Target email:', email)

  const isApproved = status === 'approved'
  const isRejected = status === 'rejected' || status === 'declined'
  const isStepUpdate = !isApproved && !isRejected

  let subject = `[Update] Requisition ${requisition.rfControlNo} - ${status.toUpperCase()}`
  let headerGradient = 'linear-gradient(135deg, #1e293b 0%, #334155 100%)' // Default Slate
  let statusText = status.toUpperCase()
  let statusColor = '#1e293b'
  let mainTitle = 'Status Update'

  if (isApproved) {
    subject = `[Final Approval] Requisition ${requisition.rfControlNo} is Fully Approved`
    headerGradient = 'linear-gradient(135deg, #065f46 0%, #059669 100%)' // Success Green
    statusColor = '#059669'
    mainTitle = 'Fully Approved'
  } else if (isRejected) {
    subject = `[Action Required] Requisition ${requisition.rfControlNo} was REJECTED`
    headerGradient = 'linear-gradient(135deg, #7f1d1d 0%, #b91c1c 100%)' // Danger Red
    statusColor = '#b91c1c'
    mainTitle = 'Action Required'
  } else if (isStepUpdate) {
    subject = `[Update] Requisition ${requisition.rfControlNo} - Moving Forward`
    headerGradient = 'linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%)' // Info Blue
    statusColor = '#2563eb'
    mainTitle = 'Moving to Next Step'
  }

  const htmlBody = `
    <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 650px; margin: 0 auto; background: #ffffff; border-radius: 20px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01);">
      <div style="background: ${headerGradient}; padding: 40px 32px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 28px; letter-spacing: -0.03em; font-weight: 800;">LEYECO III</h1>
        <p style="color: rgba(255, 255, 255, 0.9); margin: 8px 0 0; font-size: 16px; font-weight: 500; letter-spacing: 0.02em;">Requisition Tracking</p>
      </div>
      <div style="padding: 48px 40px;">
        <h2 style="color: #0f172a; margin: 0 0 16px; font-size: 24px; font-weight: 700; letter-spacing: -0.02em;">${mainTitle}</h2>

        <p style="color: #334155; line-height: 1.7; margin: 0 0 32px; font-size: 16px;">
          ${
            isApproved
              ? 'Great news! Your requisition has received final approval from the General Manager.'
              : isRejected
                ? 'Your requisition has been <strong style="color: #b91c1c;">rejected</strong> or returned for corrections. Please see the remarks below.'
                : `Your requisition has been approved at the current stage and is now moving to the <strong style="color: #0f172a; font-weight: 700;">${nextRole}</strong> phase.`
          }
        </p>

        <div style="margin-bottom: 32px; padding: 16px 24px; background: #f8fafc; border-radius: 12px; border: 1px solid #e2e8f0; display: flex; align-items: center;">
           <span style="color: #64748b; font-size: 13px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em; margin-right: 12px;">Status:</span>
           <span style="color: ${statusColor}; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; font-size: 16px;">${statusText}</span>
        </div>

        ${
          remarks
            ? `
        <div style="margin-bottom: 40px; padding: 24px; background: #fff7ed; border-left: 4px solid #f97316; border-radius: 8px;">
          <h4 style="margin: 0 0 12px; color: #9a3412; font-size: 14px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.05em;">Reviewer Remarks</h4>
          <p style="margin: 0; color: #9a3412; font-style: italic; font-size: 16px; line-height: 1.6;">"${remarks}"</p>
        </div>
        `
            : ''
        }

        <div style="background: #f8fafc; border-radius: 16px; padding: 32px; border: 1px solid #e2e8f0; margin-bottom: 40px;">
          <table style="width: 100%; border-collapse: separate; border-spacing: 0 16px;">
            <tr>
              <td style="padding: 0; color: #64748b; font-size: 13px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.08em; width: 160px; vertical-align: top;">Control Number</td>
              <td style="padding: 0; color: #0f172a; font-weight: 700; font-size: 16px; vertical-align: top;">
                <span style="background: #e2e8f0; padding: 4px 10px; border-radius: 6px; color: #0f172a;">${requisition.rfControlNo}</span>
              </td>
            </tr>
            <tr>
              <td style="padding: 0; color: #64748b; font-size: 13px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.08em; vertical-align: top;">Purpose</td>
              <td style="padding: 0; color: #1e293b; vertical-align: top; line-height: 1.6; font-size: 16px;">${requisition.purpose}</td>
            </tr>
          </table>
        </div>

        <div style="text-align: center;">
          <a href="${window.location.origin}/my-requisitions" style="display: inline-block; background: #0f172a; color: #ffffff; padding: 16px 40px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 16px; box-shadow: 0 4px 6px -1px rgba(15, 23, 42, 0.2);">Open Requisitions</a>
        </div>
      </div>
      <div style="background: #f8fafc; padding: 24px; text-align: center; border-top: 1px solid #e2e8f0;">
        <p style="margin: 0; font-size: 13px; color: #64748b; font-weight: 500;">This is a system-generated tracking alert from Leyeco III RMS.</p>
      </div>
    </div>
  `

  return sendEmailRelay({ to: email, subject, htmlBody })
}

/**
 * Notifies the BAC Secretary of a new Canvass submission
 */
export async function notifyBACNewCanvass(requisition) {
  const subject = `[New Canvass] Ready for PO Issuance - ${requisition.rfControlNo}`
  // In a real scenario, you'd fetch the BAC Secretary's email from Firestore.
  // For now, we'll assume there's a collective or targeted email.
  const bacEmail = 'bac@leyeco3.com'

  const htmlBody = `
    <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 650px; margin: 0 auto; background: #ffffff; border-radius: 20px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01);">
      <div style="background: linear-gradient(135deg, #450a0a 0%, #7f1d1d 100%); padding: 40px 32px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 28px; letter-spacing: -0.03em; font-weight: 800;">LEYECO III</h1>
        <p style="color: rgba(255, 255, 255, 0.9); margin: 8px 0 0; font-size: 16px; font-weight: 500; letter-spacing: 0.02em;">BAC Management Module</p>
      </div>
      <div style="padding: 48px 40px;">
        <h2 style="color: #0f172a; margin: 0 0 16px; font-size: 24px; font-weight: 700; letter-spacing: -0.02em;">Canvass Ready for PO</h2>
        <p style="color: #334155; line-height: 1.7; margin: 0 0 32px; font-size: 16px;">A new canvass has been finalized and is ready for <strong style="color: #0f172a; font-weight: 700;">Purchase Order issuance</strong>.</p>

        <div style="background: #f8fafc; border-radius: 16px; padding: 32px; border: 1px solid #e2e8f0; margin-bottom: 40px;">
          <table style="width: 100%; border-collapse: separate; border-spacing: 0 16px;">
            <tr>
              <td style="padding: 0; color: #64748b; font-size: 13px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.08em; width: 160px; vertical-align: top;">Control Number</td>
              <td style="padding: 0; color: #0f172a; font-weight: 700; font-size: 16px; vertical-align: top;">
                 <span style="background: #e2e8f0; padding: 4px 10px; border-radius: 6px; color: #0f172a;">${requisition.rfControlNo}</span>
              </td>
            </tr>
            <tr>
              <td style="padding: 0; color: #64748b; font-size: 13px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.08em; vertical-align: top;">Supplier</td>
              <td style="padding: 0; color: #1e293b; vertical-align: top; font-size: 16px; font-weight: 500;">${requisition.supplier?.name || 'Multiple Suppliers'}</td>
            </tr>
          </table>
        </div>

        <div style="text-align: center;">
          <a href="${window.location.origin}/bac-dashboard" style="display: inline-block; background: #b91c1c; color: #ffffff; padding: 16px 40px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 16px; transition: background 0.2s; box-shadow: 0 4px 6px -1px rgba(185, 28, 28, 0.2), 0 2px 4px -1px rgba(185, 28, 28, 0.1);">Open BAC Dashboard</a>
        </div>
      </div>
      <div style="background: #f8fafc; padding: 24px; text-align: center; border-top: 1px solid #e2e8f0;">
        <p style="margin: 0; font-size: 13px; color: #64748b; font-weight: 500;">This is a system-generated alert for BAC Personnel.</p>
      </div>
    </div>
  `

  return sendEmailRelay({ to: bacEmail, subject, htmlBody })
}

/**
 * Notifies the next PO Approver(s)
 * @param {object} requisition The requisition document
 * @param {string} nextRole The next role name
 * @param {string|string[]} nextApproverEmails A single email string or an array of email strings
 */
export async function notifyPOAction(requisition, nextRole, nextApproverEmails) {
  if (!nextApproverEmails) return
  const emails = Array.isArray(nextApproverEmails) ? nextApproverEmails : [nextApproverEmails]
  if (emails.length === 0) return

  const subject = `[PO Review] Action Required - ${requisition.rfControlNo}`
  const htmlBody = `
    <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 650px; margin: 0 auto; background: #ffffff; border-radius: 20px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01);">
      <div style="background: linear-gradient(135deg, #7f1d1d 0%, #b91c1c 100%); padding: 40px 32px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 28px; letter-spacing: -0.03em; font-weight: 800;">LEYECO III</h1>
        <p style="color: rgba(255, 255, 255, 0.9); margin: 8px 0 0; font-size: 16px; font-weight: 500; letter-spacing: 0.02em;">Purchase Order Workflow</p>
      </div>
      <div style="padding: 48px 40px;">
        <h2 style="color: #0f172a; margin: 0 0 16px; font-size: 24px; font-weight: 700; letter-spacing: -0.02em;">PO Approval Required</h2>
        <p style="color: #334155; line-height: 1.7; margin: 0 0 32px; font-size: 16px;">A Purchase Order requires signature for the <strong style="color: #0f172a; font-weight: 700;">${nextRole}</strong> phase.</p>

        <div style="background: #f8fafc; border-radius: 16px; padding: 32px; border: 1px solid #e2e8f0; margin-bottom: 40px;">
          <table style="width: 100%; border-collapse: separate; border-spacing: 0 16px;">
            <tr>
              <td style="padding: 0; color: #64748b; font-size: 13px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.08em; width: 160px; vertical-align: top;">Control Number</td>
              <td style="padding: 0; color: #0f172a; font-weight: 700; font-size: 16px; vertical-align: top;">
                 <span style="background: #e2e8f0; padding: 4px 10px; border-radius: 6px; color: #0f172a;">${requisition.rfControlNo}</span>
              </td>
            </tr>
            <tr>
              <td style="padding: 0; color: #64748b; font-size: 13px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.08em; vertical-align: top;">Total Amount</td>
              <td style="padding: 0; color: #059669; font-weight: 800; font-size: 20px; vertical-align: top;">₱${requisition.totalAmount?.toLocaleString()}</td>
            </tr>
          </table>
        </div>

        <div style="text-align: center;">
          <a href="${window.location.origin}/po-approvals" style="display: inline-block; background: #b91c1c; color: #ffffff; padding: 16px 40px; border-radius: 10px; text-decoration: none; font-weight: 600; font-size: 16px; transition: background 0.2s; box-shadow: 0 4px 6px -1px rgba(185, 28, 28, 0.2), 0 2px 4px -1px rgba(185, 28, 28, 0.1);">Approve PO</a>
        </div>
      </div>
      <div style="background: #f8fafc; padding: 24px; text-align: center; border-top: 1px solid #e2e8f0;">
        <p style="margin: 0; font-size: 13px; color: #64748b; font-weight: 500;">This is a high-priority financial notification broadcasted to all ${nextRole} personnel.</p>
      </div>
    </div>
  `
  const promises = emails.map((email) => sendEmailRelay({ to: email, subject, htmlBody }))
  await Promise.allSettled(promises)
}

/**
 * Sends a confirmation receipt to the original Requestor
 */
export async function notifySubmissionReceipt(requisition) {
  const email = requisition.requestedBy?.email
  if (!email) return

  const subject = `[Receipt] Requisition Submitted - ${requisition.rfControlNo || 'New'}`
  const htmlBody = `
    <div style="font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 650px; margin: 0 auto; background: #ffffff; border-radius: 20px; overflow: hidden; border: 1px solid #e2e8f0; box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.01);">
      <div style="background: #0f172a; padding: 32px 32px; text-align: center;">
        <h1 style="color: #ffffff; margin: 0; font-size: 24px; letter-spacing: 0.05em; font-weight: 800;">LEYECO III</h1>
      </div>
      <div style="padding: 48px 40px;">
        <div style="text-align: center; margin-bottom: 32px;">
          <div style="display: inline-block; background: #ecfdf5; color: #059669; padding: 8px 16px; border-radius: 20px; font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; border: 1px solid #a7f3d0; box-shadow: 0 2px 4px rgba(5, 150, 105, 0.05);">Submission Receipt</div>
        </div>
        <h2 style="color: #0f172a; margin: 0 0 16px; font-size: 26px; text-align: center; font-weight: 700; letter-spacing: -0.02em;">Document Received</h2>
        <p style="color: #334155; text-align: center; line-height: 1.7; margin: 0 0 40px; font-size: 16px;">This is a receipt confirming your requisition has been successfully submitted and is now in the <strong style="color: #0f172a; font-weight: 700;">Section Head</strong> review phase.</p>

        <div style="background: #f8fafc; border-radius: 16px; padding: 32px; border: 1px solid #e2e8f0; margin-bottom: 40px;">
          <table style="width: 100%; border-collapse: separate; border-spacing: 0 16px;">
             <tr>
              <td style="padding: 0; color: #64748b; font-size: 13px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.08em; width: 150px; vertical-align: top;">Control Number</td>
              <td style="padding: 0; color: #0f172a; font-weight: 700; font-size: 16px; vertical-align: top;">
                ${requisition.rfControlNo ? `<span style="background: #e2e8f0; padding: 4px 10px; border-radius: 6px; color: #0f172a;">${requisition.rfControlNo}</span>` : '<span style="color: #64748b; font-style: italic; font-weight: 500; font-size: 14px; background: #f1f5f9; padding: 4px 10px; border-radius: 6px;">Pending Generation</span>'}
              </td>
            </tr>
            <tr>
              <td style="padding: 0; color: #64748b; font-size: 13px; text-transform: uppercase; font-weight: 700; letter-spacing: 0.08em; vertical-align: top;">Purpose</td>
              <td style="padding: 0; color: #1e293b; vertical-align: top; line-height: 1.6; font-size: 16px;">${requisition.purpose}</td>
            </tr>
          </table>
        </div>

        <p style="font-size: 14px; color: #64748b; text-align: center; font-weight: 500;">You will receive another update once the next level of approval is complete.</p>
      </div>
      <div style="background: #f8fafc; padding: 24px; text-align: center; border-top: 1px solid #e2e8f0;">
        <p style="margin: 0; font-size: 12px; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.1em; font-weight: 700;">Official System Confirmation</p>
      </div>
    </div>
  `
  return sendEmailRelay({ to: email, subject, htmlBody })
}
