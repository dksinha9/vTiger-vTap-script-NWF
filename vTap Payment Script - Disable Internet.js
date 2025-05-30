var Payments_Component_DisableInternet = VTAP.Component.Core.extend({
    data()
    {
        return {
            retryCount: 0,
            relatedInvoiceId: '',
            relatedInvoiceModule: '',
            relatedDealId: '',
            relatedDealModule: '',
            pppoeUsername: '',
            pppoeUserId: '',
            paymentRecord: '',
            executionLogs: []
        };
    },

    mounted()
    {
        const REQUIRED_RETRY_COUNT = 0;

        // Listen for updates on payment records
        VTAP.Event.Register('RECORD_UPDATED', (moduleName, updatedRecord) =>
        {
            this.retryCount = updatedRecord.retrycounter;
            this.paymentRecord = updatedRecord;
            console.log(this.paymentRecord);
            this.addLog(`[DEBUG] Payment: ID=${this.paymentRecord.id}, Status=${this.paymentRecord.paymentsstatus}, RetryCount=${this.paymentRecord.retrycounter}`);
            // Exit if retry counter is not 4
            if (this.retryCount > REQUIRED_RETRY_COUNT)
            {
                console.log("[INFO] Payment retry count is not 4. Skipping action.");
                return;
            }

            // Exit if created before cutoff date as we dont want closed records to go through this script
            const createdTimestamp = new Date(updatedRecord.createdtime);
            const filterDate = new Date("2025-05-28T23:59:59");

            if (createdTimestamp <= filterDate)
            {
                console.log("[INFO] Skipping record: createdtime is before or on 2025-05-28.");
                return;
            }

            // Exit if already processed the record
            if (updatedRecord.cf_payments_internetdisabledbyvtiger === "1")
            {
                console.log("[INFO] Internet already disabled by Vtiger. Skipping.");
                return;
            }

            // Exit if paymentsstatus is not 'Received(Invoice)'
            if (updatedRecord.paymentsstatus === "Received(Invoice)")
            {
                console.log("[INFO] Skipping: paymentsstatus is 'Received(Invoice)'.");
                return;
            }

            console.log("[INFO] Retry count = 4. Initiating disconnection flow...");
            this.addLog("[INFO] Retry count = 4. Initiating disconnection flow...");

            // Store related invoice reference
            this.relatedInvoiceId = updatedRecord.related_to?.id;
            this.relatedInvoiceModule = updatedRecord.related_to?.module;

            if (!this.relatedInvoiceId || !this.relatedInvoiceModule)
            {
                console.warn("[WARN] Missing payment related to invoice(related_to field).");
                this.addLog("[WARN] Missing payment related to invoice(related_to field).");
                this.flagVtapScriptFailure();
                this.storeExecutionLogs();
                return;
            }

            this.fetchInvoice();
        });
    },

    methods: {
        // Fetch invoice record
        fetchInvoice()
        {
            VTAP.Api.Get('records', {
                id: this.relatedInvoiceId,
                module: this.relatedInvoiceModule
            }, (error, invoiceRecord) =>
            {
                if (error || !invoiceRecord)
                {
                    console.error("[ERROR] Could not fetch invoice record for the payment:", error);
                    this.addLog(`[ERROR] Could not fetch invoice record for the payment: ${JSON.stringify(error)}`);
                    this.flagVtapScriptFailure();
                    this.storeExecutionLogs();
                    return;
                }

                console.log("[INFO] Invoice record fetched for the payment: ", invoiceRecord);
                this.addLog(`[INFO] Invoice fetched. ID: ${invoiceRecord.id}, Linked Deal ID: ${invoiceRecord.potential_id?.id}`); this.relatedDealId = invoiceRecord.potential_id?.id;
                this.relatedDealModule = invoiceRecord.potential_id?.module;

                if (!this.relatedDealId || !this.relatedDealModule)
                {
                    console.warn("[WARN] Invoice is not linked to any Deal.");
                    this.addLog("[WARN] Invoice is not linked to any Deal.");
                    this.flagVtapScriptFailure();
                    this.storeExecutionLogs();
                    return;
                }

                this.fetchDeal();
            });
        },

        // Fetch related deal record
        fetchDeal()
        {
            VTAP.Api.Get('records', {
                id: this.relatedDealId,
                module: this.relatedDealModule
            }, (error, dealRecord) =>
            {
                if (error || !dealRecord)
                {
                    console.error("[ERROR] Could not fetch deal record:", error);
                    this.addLog(`[ERROR] Could not fetch deal record: ${JSON.stringify(error)}`);
                    this.flagVtapScriptFailure();
                    this.storeExecutionLogs();
                    return;
                }

                console.log("[INFO] Deal record fetched for the payment: ", dealRecord);
                this.addLog(`[INFO] Deal fetched. ID: ${dealRecord.id}, PPPoE Username: ${dealRecord.cf_potentials_pppoeusername}`);
                this.pppoeUsername = dealRecord.cf_potentials_pppoeusername;

                if (!this.pppoeUsername)
                {
                    console.warn("[WARN] PPPoE username is missing in the deal.");
                    this.addLog("[WARN] PPPoE username is missing in the deal.");
                    this.flagVtapScriptFailure();
                    this.storeExecutionLogs();
                    return;
                }

                this.findPppoeId();
            });
        },

        // Look up PPPoE ID via vTiger Custom REST API(Find PPPoE ID on Netwire Fiber Radius Server Using MikroTik API) that connects to MikroTik API
        findPppoeId()
        {
            VTAP.CustomApi.Post('Find PPPoE ID on Netwire Fiber Radius Server Using MikroTik API', {
                PPPoE_Username: [`=name=${this.pppoeUsername}`]
            }, (error, response) =>
            {
                if (error || !response?.content)
                {
                    console.error("[ERROR] Failed to fetch PPPoE ID from MikroTik API:", error);
                    this.addLog(`[ERROR] Failed to fetch PPPoE ID from MikroTik API: ${JSON.stringify(error)}`);
                    this.flagVtapScriptFailure();
                    this.storeExecutionLogs();
                    return;
                }

                try
                {
                    const userRecords = JSON.parse(response.content);
                    if (!userRecords.length || !userRecords[0]['.id'])
                    {
                        console.warn("[WARN] No valid PPPoE user found on Netwire Fiber Radius Server and Mikroitk API parsed response :", userRecords);
                        this.addLog(`[WARN] No valid PPPoE user found on Netwire Fiber Radius Server. Parsed response: ${JSON.stringify(userRecords)}`);
                        this.flagVtapScriptFailure();
                        this.storeExecutionLogs();
                        return;
                    }

                    this.pppoeUserId = userRecords[0]['.id'];
                    console.log("[INFO] PPPoE user ID:", this.pppoeUserId);
                    this.addLog(`[INFO] PPPoE user ID: ${this.pppoeUserId}`);
                    this.disableInternetAccess();
                } catch (parseError)
                {
                    console.error("[ERROR] Failed to parse MikroTik API response:", parseError);
                    this.addLog(`[ERROR] Failed to parse MikroTik API response: ${JSON.stringify(parseError)}`);
                    this.flagVtapScriptFailure();
                    this.storeExecutionLogs();
                    return;
                }
            });
        },

        // Disable user access using PPPoE ID via vTiger Custom REST API(Disables a PPPoE username to suspend internet access via the Netwire Fiber Radius system) that connects to MikroTik API
        disableInternetAccess()
        {
            VTAP.CustomApi.Post('Disables a PPPoE username to suspend internet access via the Netwire Fiber Radius system', {
                pppoe_id: this.pppoeUserId
            }, (error, response) =>
            {
                if (error)
                {
                    console.error("[ERROR] Failed to disable PPPoE user Netwire Fiber Radius Server through Mikrotik API:", error);
                    this.addLog(`[ERROR] Failed to disable PPPoE user on Netwire Fiber Radius Server through MikroTik API: ${JSON.stringify(error)}`);
                    this.flagVtapScriptFailure();
                    this.storeExecutionLogs();
                    return;
                }

                console.log("[SUCCESS] PPPoE user disabled on Netwire Fiber Radius Server.");
                this.addLog("[SUCCESS] PPPoE user disabled on Netwire Fiber Radius Server.");
                this.updateSalesStage();
            });
        },

        // Update deal sales stage
        updateSalesStage()
        {
            const DISCONNECTION_STAGE = "Non Payment Internet Disconnection";

            VTAP.Api.Put('records', {
                module: this.relatedDealModule,
                id: this.relatedDealId,
                sales_stage: DISCONNECTION_STAGE
            }, (error, response) =>
            {
                if (error)
                {
                    console.error("[ERROR] Failed to update Deal sales_stage:", error);
                    this.addLog(`[ERROR] Failed to update Deal sales_stage: ${JSON.stringify(error)}`);
                    this.flagVtapScriptFailure();
                    this.storeExecutionLogs();
                    return;
                } else
                {
                    console.log("[INFO] Deal sales_stage updated to:", DISCONNECTION_STAGE);
                    this.addLog(`[INFO] Deal sales_stage updated to: ${DISCONNECTION_STAGE}`);
                    this.markPaymentAsDisabled();
                }
            });
        },

        // Mark payment as processed to avoid duplicate execution
        markPaymentAsDisabled()
        {
            VTAP.Api.Put('records', {
                module: this.paymentRecord.record_module,
                id: this.paymentRecord.id,
                cf_payments_internetdisabledbyvtiger: "1"
            }, (error, response) =>
            {
                if (error)
                {
                    console.error("[ERROR] Failed to mark payment as internet disabled:", error);
                    this.addLog(`[ERROR] Failed to mark payment as internet disabled: ${JSON.stringify(error)}`);
                    this.flagVtapScriptFailure();
                    this.storeExecutionLogs();
                    return;
                } else
                {
                    console.log("[INFO] Payment field 'cf_payments_internetdisabledbyvtiger' updated to 1 and API response:", response);
                    this.addLog(`[INFO] Payment field 'cf_payments_internetdisabledbyvtiger' updated to 1`);
                    this.storeExecutionLogs();
                    return;
                }
            });
        },
        // Push logs to custom CRM field(cf_payments_scriptlogs)
        storeExecutionLogs()
        {
            const logString = this.executionLogs.length ? this.executionLogs.join("\n") : "[No logs recorded]";
            VTAP.Api.Put('records', {
                module: this.paymentRecord.record_module,
                id: this.paymentRecord.id,
                cf_payments_scriptlogs: logString
            }, (error, response) =>
            {
                if (error)
                {
                    console.error("[ERROR] Failed to store script logs:", error);
                    return;
                } else
                {
                    console.log("[INFO] Script logs saved successfully and API response:", response);
                    return;
                }
            });
        },

        // Add timestamped message to execution log
        addLog(message)
        {
            const now = new Date();
            const timestamp = now.toLocaleString('en-CA', {
                timeZone: 'America/Toronto',
                year: 'numeric',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
                hour12: false
            }).replace(',', '');

            const formatted = `[${timestamp}] ${message}`;
            this.executionLogs.push(formatted);
            console.log(formatted);
            return;
        },
        flagVtapScriptFailure()
        {
            this.markPaymentAsDisabled();
            VTAP.Api.Put('records', {
                module: this.paymentRecord.record_module,
                id: this.paymentRecord.id,
                cf_payments_vtapscriptfailed: "1"
            }, (error, response) =>
            {
                if (error)
                {
                    console.error("[ERROR] Failed to flag VTAP script failure:", error);
                    this.addLog(`[ERROR] Failed to flag VTAP script failure: ${JSON.stringify(error)}`);
                } else
                {
                    console.log("[INFO] Flagged payment as VTAP script failure and API response:", response);
                    this.addLog(`[INFO] Flagged payment as VTAP script failure }`);
                }
            });
        }
    }
});