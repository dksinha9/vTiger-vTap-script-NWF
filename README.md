# Payments_Component_DisableInternet

A Vtiger VTAP (Vtiger Application Platform) script to automate internet suspension when a customer's payment has failed after a predefined number of retries(4). This component integrates with external MikroTik API services to suspend the customer’s internet and logs every decision step for traceability.

---

## Purpose

To reduce manual effort and ensure timely service suspension, this script:

- Listens to updates on payment records.
- Verifies retry attempts, payment status,  created date and flag to check if script has already been triggered.
- Looks up related invoice and deal information.
- Fetches the customer’s PPPoE username from the Deal.
- Disables the user's internet using the MikroTik API.
- Updates the deal’s `sales_stage` field.
- Marks the payment as processed by vTiger Script(cf_payments_internetdisabledbyvtiger) to prevent re-execution.
- Logs detailed actions and decisions in the `cf_payments_scriptlogs` field for auditability.
- If an error occurs at any step, sets the cf_payments_vtapscriptfailed flag to true, which can trigger a follow-up workflow for alerting or manual review.

---
## 🏗️ Component Details

| Key                     | Value                                                                 |
|-------------------------|-----------------------------------------------------------------------|
| vTAP Script Name        | `Disable Internet`                                                    |
| Target Module           | `Payments`                                                            |
| Trigger Type            | `RECORD_UPDATED` event on Payments                                    |
| External API Used       | MikroTik API via custom REST API defined in Vtiger API Designer       |
| Fields Used (Payment)   | `retrycounter`, `createdtime`, `cf_payments_internetdisabledbyvtiger`, `cf_payments_scriptlogs`, `cf_payments_vtapscriptfailed`, `paymentsstatus`, `related_to` |
| Fields Used (Invoice)   | `potential_id`                  |
| Fields Used (Deal)      | `cf_potentials_pppoeusername`, `sales_stage`                         |
---

### 🛠️ Required Custom Fields

Ensure the following custom fields are created and available in your CRM for proper script execution and auditability:

#### 📄 Payments Module
- `cf_payments_internetdisabledbyvtiger` (Checkbox or Picklist):  
  Flags if the internet disconnection process has already been executed for this payment record.

- `cf_payments_scriptlogs` (Text Area – Long):  
  Stores the execution logs of the VTAP script, including actions, timestamps, and error messages (if any).

- `cf_payments_vtapscriptfailed` (Checkbox or Picklist):  
  Flags whether the VTAP script failed during execution. This can be used to trigger workflows or alerts.

#### 💼 Deals Module
- `cf_potentials_pppoeusername` (Text):  
  Stores the customer’s PPPoE username used for identifying the user on the MikroTik system.

- `sales_stage` (Picklist):  
  Must include the value `Non Payment Internet Disconnection`, which is used to update the deal status during the disconnection process.

#### 🧾 Invoice Module
- `potential_id` (Reference):  
  Used to trace the invoice back to the originating deal (needed for PPPoE lookup and disconnection logic).
---
## 🧠 Business Logic

### ✅ Conditions to Trigger Internet Suspension

- `retrycounter === 4` on the Payment record.
- `createdtime > 2025-05-28` to avoid acting on legacy records.
- Internet has **not** already been disabled (`cf_payments_internetdisabledbyvtiger !== "1"`).
- `paymentsstatus !== "Received(Invoice)"`.
- Related invoice exists and links to a valid Deal.
- Deal record contains a valid PPPoE username.

---

### 🔄 Execution Flow

1. **Monitor Payment Updates**
   - Triggered by `RECORD_UPDATED` event in the Payments module.

2. **Verify Preconditions**
   - Check retry count, creation date, status, and flags.

3. **Fetch Related Invoice**
   - Accessed via the `related_to` field in the payment.

4. **Get Linked Deal**
   - Retrieved using the invoice’s `potential_id` reference.

5. **Look Up PPPoE ID**
   - Uses `VTAP.CustomApi.Post` calling MikroTik API (via custom vTiger REST API).

6. **Disable Internet Access**
   - Sends command to MikroTik system using another `VTAP.CustomApi.Post`.

7. **Update Deal Status**
   - Sets `sales_stage` to `"Non Payment Internet Disconnection"`.

8. **Mark Payment as Processed**
   - Updates `cf_payments_internetdisabledbyvtiger` to `"1"` to prevent re-execution.

9. **Log Script Actions**
   - All steps and decisions are timestamped and saved in `cf_payments_scriptlogs`.
   - This update also triggers a workflow to **notify team about the internet disconnection**.

10. **Flag Errors (if any)**
   - If any critical step fails, sets `cf_payments_vtapscriptfailed = "1"` to enable workflow triggers and alerts.
---

## 🛠️ Error Handling & Logging

- Each step (API call, condition check, data fetch) includes robust error logging.
- All messages are timestamped and saved to the `cf_payments_scriptlogs` field on the payment record.
- If an error occurs at any stage:
  - The script halts further execution.
  - The `cf_payments_vtapscriptfailed` field is set to `"1"` to indicate failure.
  - This flag can trigger a separate workflow to notify admins or support teams for manual intervention.
---

## 📋 Sample Log Format

```text
[2025-05-29 11:16] [INFO] Retry count = 4. Initiating disconnection flow...
[2025-05-29 11:16] [INFO] Invoice record fetched for the payment: {invoiceData}
[2025-05-29 11:16] [INFO] Deal record fetched for the payment: {dealData}
[2025-05-29 11:16] [INFO] PPPoE user ID: *9C
[2025-05-29 11:17] [SUCCESS] PPPoE user disabled on Netwire Fiber Radius Server.
[2025-05-29 11:17] [INFO] Deal sales_stage updated to: Non Payment Internet Disconnection
[2025-05-29 11:17] [INFO] Payment field 'cf_payments_internetdisabledbyvtiger' updated to 1 and API respose: {apiResponse}
[2025-05-29 11:17] [INFO] Script logs saved successfully and API response: {apiResponse}