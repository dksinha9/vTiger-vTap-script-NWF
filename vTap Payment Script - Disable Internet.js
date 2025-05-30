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
            paymentRecord: ''
        };
    },

    mounted()
    {
        const REQUIRED_RETRY_COUNT = 0;

        VTAP.Event.Register('RECORD_UPDATED', (moduleName, updatedRecord) =>
        {
            this.retryCount = updatedRecord.retrycounter;
            this.paymentRecord = updatedRecord;
            console.log(this.paymentRecord);

            if (this.retryCount > REQUIRED_RETRY_COUNT)
            {
                console.log("[INFO] payment_retry_counter is not 4. Skipping action.");
                return;
            }

            // NEW: Created date filter
            const createdTimestamp = new Date(updatedRecord.createdtime);
            const filterDate = new Date("2025-05-28T23:59:59");

            if (createdTimestamp <= filterDate)
            {
                console.log("[INFO] Skipping record: createdtime is before or on 2025-05-28.");
                return;
            }

            if (updatedRecord.cf_payments_internetdisabledbyvtiger === "1")
            {
                console.log("[INFO] Internet already disabled by Vtiger. Skipping.");
                return;
            }

            console.log("[INFO] Retry count = 4. Initiating disconnection flow...");

            this.relatedInvoiceId = updatedRecord.related_to?.id;
            this.relatedInvoiceModule = updatedRecord.related_to?.module;

            if (!this.relatedInvoiceId || !this.relatedInvoiceModule)
            {
                console.warn("[WARN] Missing related_to information.");
                return;
            }

            this.fetchInvoice();
        });
    },

    methods: {
        fetchInvoice()
        {
            VTAP.Api.Get('records', {
                id: this.relatedInvoiceId,
                module: this.relatedInvoiceModule
            }, (error, invoiceRecord) =>
            {
                if (error || !invoiceRecord)
                {
                    console.error("[ERROR] Could not fetch invoice record:", error);
                    return;
                }

                console.log("[INFO] Invoice record fetched.");

                this.relatedDealId = invoiceRecord.potential_id?.id;
                this.relatedDealModule = invoiceRecord.potential_id?.module;

                if (!this.relatedDealId || !this.relatedDealModule)
                {
                    console.warn("[WARN] Invoice is not linked to any Deal.");
                    return;
                }

                this.fetchDeal();
            });
        },

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
                    return;
                }

                console.log("[INFO] Deal record fetched.");

                this.pppoeUsername = dealRecord.cf_potentials_pppoeusername;

                if (!this.pppoeUsername)
                {
                    console.warn("[WARN] PPPoE username is missing in the deal.");
                    return;
                }

                this.findPppoeId();
            });
        },

        findPppoeId()
        {
            VTAP.CustomApi.Post('Find PPPoE ID on Netwire Fiber Radius Server Using MikroTik API', {
                PPPoE_Username: [`=name=${this.pppoeUsername}`]
            }, (error, response) =>
            {
                if (error || !response?.content)
                {
                    console.error("[ERROR] Failed to fetch PPPoE ID:", error);
                    return;
                }

                try
                {
                    const userRecords = JSON.parse(response.content);
                    if (!userRecords.length || !userRecords[0]['.id'])
                    {
                        console.warn("[WARN] No valid PPPoE user found.");
                        return;
                    }

                    this.pppoeUserId = userRecords[0]['.id'];
                    console.log("[INFO] PPPoE user ID:", this.pppoeUserId);

                    this.disableInternetAccess();
                } catch (parseError)
                {
                    console.error("[ERROR] Failed to parse MikroTik response:", parseError);
                }
            });
        },

        disableInternetAccess()
        {
            VTAP.CustomApi.Post('Disables a PPPoE username to suspend internet access via the Netwire Fiber Radius system', {
                pppoe_id: this.pppoeUserId
            }, (error, response) =>
            {
                if (error)
                {
                    console.error("[ERROR] Failed to disable PPPoE user:", error);
                    return;
                }

                console.log("[SUCCESS] PPPoE user disabled.");
                this.updateSalesStage();
            });
        },

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
                    console.error("[ERROR] Failed to update sales_stage:", error);
                } else
                {
                    console.log("[INFO] Deal sales_stage updated to:", DISCONNECTION_STAGE);
                    this.markPaymentAsDisabled();
                }
            });
        },
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
                } else
                {
                    console.log("[INFO] Payment field 'cf_payments_internetdisabledbyvtiger' updated to 1.");
                }
            });
        }
    }
});