var Payments_Component_PopupAutoDisconnectOnFailure = VTAP.Component.Core.extend({

    methods: {
        onok(event)
        {
            event.preventDefault();
            console.log("[Popup] User confirmed disconnection.");
            this.executeDisconnectionScript();
        },

        executeDisconnectionScript()
        {
            VTAP.Utility.ShowProgress();
            console.log("[Script] Starting disconnection script...");

            const logsMap = {};

            const addLog = (id, message) =>
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
                if (!logsMap[id]) logsMap[id] = [];
                logsMap[id].push(formatted);
                console.log(`[Log ${id}] ${message}`);
            };

            const storeLogs = (paymentId, callback) =>
            {
                const logString = logsMap[paymentId]?.join('\n') || '[No logs recorded]';
                VTAP.Api.Put('records', {
                    module: "Payments",
                    id: paymentId,
                    cf_payments_scriptlogs: logString
                }, () =>
                {
                    VTAP.Detail.RefreshRecord();
                    VTAP.Utility.HideProgress();
                    this.hidePopup();
                    if (callback) callback();
                });
            };

            const flagFailure = (payment, callback) =>
            {
                addLog(payment.id, "Updating cf_payments_vtapscriptfailed field set to 'Yes'.");
                VTAP.Api.Put('records', {
                    module: "Payments",
                    id: payment.id,
                    cf_payments_vtapscriptfailed: "1"
                }, () => storeLogs(payment.id, callback));
            };

            VTAP.Api.Get("records", {
                module: "Payments",
                filterid: 171,
                q: JSON.stringify([
                    [["paymentsstatus", "equal", ["Failure"]],
                    ["retrycounter", "equal", ["4"]],
                    ["createdtime", "lastmonth", ""],
                    ["cf_payments_internetdisabledbyvtiger", "equal", 0],
                    ["cf_payments_vtapscriptfailed", "equal", 0]]
                ])
            }, (err, payments) =>
            {
                if (err || !Array.isArray(payments) || payments.length === 0)
                {
                    console.error("[API ERROR] Failed to retrieve payments.", err);
                    VTAP.Utility.ShowErrorNotification('No payments to process right now.');
                    VTAP.Utility.HideProgress();
                    this.hidePopup();
                    return;
                }

                console.log(`[Data] Retrieved ${payments.length} failed payments.`);
                console.log(payments);
                payments.forEach((payment) =>
                {
                    addLog(payment.id, `Processing payment: ${payment.paymentsno}`);

                    const invoiceId = payment.related_to?.id;
                    if (!invoiceId)
                    {
                        addLog(payment.id, "Missing invoice related to the payment.");
                        return flagFailure(payment, () =>
                        {
                            VTAP.Utility.ShowErrorNotification(`Error on ${payment.paymentsno}. Check logs.`);
                        });
                    }

                    VTAP.Api.Get('records', { id: invoiceId, module: "Invoice" }, (err, invoice) =>
                    {
                        if (err || !invoice)
                        {
                            addLog(payment.id, "Failed to fetch invoice related to the payment.");
                            return flagFailure(payment, () =>
                            {
                                VTAP.Utility.ShowErrorNotification(`Error on ${payment.paymentsno}. Check logs.`);
                            });
                        }

                        const dealId = invoice.potential_id?.id;
                        const dealModule = invoice.potential_id?.module || "Potentials";

                        if (!dealId)
                        {
                            addLog(payment.id, "Invoice is not linked to a deal.");
                            return flagFailure(payment, () =>
                            {
                                VTAP.Utility.ShowErrorNotification(`Error on ${payment.paymentsno}. Check logs.`);
                            });
                        }

                        VTAP.Api.Get('records', { id: dealId, module: dealModule }, (err, deal) =>
                        {
                            if (err || !deal)
                            {
                                addLog(payment.id, "Failed to fetch deal related to the invoice of the payment.");
                                return flagFailure(payment, () =>
                                {
                                    VTAP.Utility.ShowErrorNotification(`Error on ${payment.paymentsno}. Check logs.`);
                                });
                            }

                            const username = deal.cf_potentials_pppoeusername;
                            if (!username)
                            {
                                addLog(payment.id, "PPPoE username field is missing from the deal.");
                                return flagFailure(payment, () =>
                                {
                                    VTAP.Utility.ShowErrorNotification(`Error on ${payment.paymentsno}. Check logs.`);
                                });
                            }

                            VTAP.CustomApi.Post('Find PPPoE ID on Netwire Fiber Radius Server Using MikroTik API', {
                                PPPoE_Username: [`=name=${username}`]
                            }, (err, res) =>
                            {
                                if (err || !res?.content)
                                {
                                    addLog(payment.id, "PPPoE lookup failed on MikroTik API(/rest/user-manager/user/print).");
                                    return flagFailure(payment, () =>
                                    {
                                        VTAP.Utility.ShowErrorNotification(`Error on ${payment.paymentsno}. Check logs.`);
                                    });
                                }

                                let user;
                                try
                                {
                                    user = JSON.parse(res.content)[0];
                                } catch
                                {
                                    addLog(payment.id, "Failed to parse MikroTik response.");
                                    return flagFailure(payment, () =>
                                    {
                                        VTAP.Utility.ShowErrorNotification(`Error on ${payment.paymentsno}. Check logs.`);
                                    });
                                }

                                if (!user?.['.id'])
                                {
                                    addLog(payment.id, "No valid PPPoE ID found on MikroTik API(/rest/user-manager/user/print) response.");
                                    return flagFailure(payment, () =>
                                    {
                                        VTAP.Utility.ShowErrorNotification(`Error on ${payment.paymentsno}. Check logs.`);
                                    });
                                }

                                VTAP.CustomApi.Post('Disables a PPPoE username to suspend internet access via the Netwire Fiber Radius Server', {
                                    pppoe_id: user['.id']
                                }, (err) =>
                                {
                                    if (err)
                                    {
                                        addLog(payment.id, "Failed to disable PPPoE user on Netwire Fiber Radius Server through MikroTik API(/rest/user-manager/user/disable).");
                                        return flagFailure(payment, () =>
                                        {
                                            VTAP.Utility.ShowErrorNotification(`Error on ${payment.paymentsno}. Check logs.`);
                                        });
                                    }

                                    addLog(payment.id, "PPPoE user disabled on Netwire Fiber Radius Server through MikroTik API(/rest/user-manager/user/disbale).");

                                    VTAP.Api.Put('records', {
                                        module: dealModule,
                                        id: dealId,
                                        sales_stage: "Non Payment Internet Disconnection"
                                    }, (err) =>
                                    {
                                        if (err)
                                        {
                                            addLog(payment.id, "Failed to update deal stage to 'Non Payment Internet Disconnection'.");
                                            return flagFailure(payment, () =>
                                            {
                                                VTAP.Utility.ShowErrorNotification(`Error on ${payment.paymentsno}. Check logs.`);
                                            });
                                        }

                                        VTAP.Api.Put('records', {
                                            module: "Payments",
                                            id: payment.id,
                                            cf_payments_internetdisabledbyvtiger: "1"
                                        }, (err) =>
                                        {
                                            if (err)
                                            {
                                                addLog(payment.id, "Failed to update cf_payments_internetdisabledbyvtiger field payment to 'Yes'.");
                                                return flagFailure(payment, () =>
                                                {
                                                    VTAP.Utility.ShowErrorNotification(`Error on ${payment.paymentsno}. Check logs.`);
                                                });
                                            }

                                            addLog(payment.id, "Successfully updated cf_payments_internetdisabledbyvtiger field payment to 'Yes'.");
                                            storeLogs(payment.id, () =>
                                            {
                                                console.log(`[Complete] Processed payment: ${payment.paymentsno}`);
                                                VTAP.Utility.ShowSuccessNotification(`Processed: ${payment.paymentsno}`);

                                            });
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        },

        hidePopup()
        {
            console.log("[Popup] Closing modal.");
            this.$root.$emit('bv::hide::modal', 'disconnect-failure-modal');
        }
    },

    template: `
    <b-modal id="disconnect-failure-modal" title="Auto Disconnect Failed Payments" @ok="onok" ok-title="Yes" cancel-title="No">
      <div class="text-warning">
        This will disable internet access for customers whose payments have failed 4 times this month.<br><br>
        ⚠️ Please make sure all payments are linked to an invoice and a deal has valid PPPoE Username field before continuing.<br><br>
        Do you want to continue?
      </div>
    </b-modal>
  `
});