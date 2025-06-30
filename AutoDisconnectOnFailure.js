const logsMap = {};

function addLog(id, message)
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
    console.log(formatted);
}

function storeLogs(paymentId, callback)
{
    const logString = logsMap[paymentId]?.join('\n') || '[No logs recorded]';
    VTAP.Api.Put('records', {
        module: "Payments",
        id: paymentId,
        cf_payments_scriptlogs: logString
    }, (error, response) =>
    {
        if (callback) callback();
    });
}

function flagFailure(payment, callback)
{
    addLog(payment.id, "[INFO] Flagging VTAP script failure.");
    VTAP.Api.Put('records', {
        module: "Payments",
        id: payment.id,
        cf_payments_vtapscriptfailed: "1"
    }, () =>
    {
        storeLogs(payment.id, callback);
    });
}

// MAIN EXECUTION
VTAP.Api.Get("records", {
    "module": "Payments",
    "filterid": 171,
    "q": JSON.stringify(
        [[["paymentsstatus", "equal", ["Failure"]], ["retrycounter", "equal", ["4"]], ["createdtime", "lastmonth", ""], ["cf_payments_internetdisabledbyvtiger", "equal", 0], ["cf_payments_vtapscriptfailed", "equal", 0]]]
    )
}, (err, payments) =>
{
    if (err || !Array.isArray(payments))
    {
        VTAP.Utility.ShowErrorNotification('No payments have failed 4 times this month.');
        console.error("Failed to get failed payments:", err);
        return;
    }
    console.log(payments);

    payments.forEach(payment =>
    {
        payment.id = payment.id.split('x')[1];
        console.log(payment.id);
        addLog(payment.id, `Processing payment: ${payment.paymentsno}`);

        const [modulePrefix, invoiceId] = payment.related_to.split('x');
        if (!invoiceId)
        {
            addLog(payment.id, "Missing invoice related to the payment.");
            flagFailure(payment, () =>
            {
                VTAP.Utility.ShowErrorNotification(`Error processing: ${payment.paymentsno}`);
            });
            return;
        }

        console.log(invoiceId);

        VTAP.Api.Get('records', {
            id: invoiceId,
            module: "Invoice"
        }, (err, invoice) =>
        {
            if (err || !invoice)
            {
                addLog(payment.id, "Failed to fetch invoice related to the payment.");
                flagFailure(payment, () =>
                {
                    VTAP.Utility.ShowErrorNotification(`Error processing: ${payment.paymentsno}`);
                });
                return;
            }
            console.log(invoice);

            const dealId = invoice.potential_id?.id;
            const dealModule = invoice.potential_id?.module || "Potentials";

            if (!dealId || !dealModule)
            {
                addLog(payment.id, "Invoice is not linked to a deal.");
                flagFailure(payment, () =>
                {
                    VTAP.Utility.ShowErrorNotification(`Error processing: ${payment.paymentsno}`);
                });
                return;
            }

            VTAP.Api.Get('records', {
                id: dealId,
                module: dealModule
            }, (err, deal) =>
            {
                if (err || !deal)
                {
                    addLog(payment.id, "Failed to fetch deal related to the invoice of the payment.");
                    flagFailure(payment, () =>
                    {
                        VTAP.Utility.ShowErrorNotification(`Error processing: ${payment.paymentsno}`);
                    });
                    return;
                }

                const username = deal.cf_potentials_pppoeusername;
                if (!username)
                {
                    addLog(payment.id, "PPPoE username field is missing from the deal.");
                    flagFailure(payment, () =>
                    {
                        VTAP.Utility.ShowErrorNotification(`Error processing: ${payment.paymentsno}`);
                    });
                    return;
                }

                VTAP.CustomApi.Post('Find PPPoE ID on Netwire Fiber Radius Server Using MikroTik API', {
                    PPPoE_Username: [`=name=${username}`]
                }, (err, res) =>
                {
                    if (err || !res?.content)
                    {
                        addLog(payment.id, "PPPoE lookup failed on MikroTik API.");
                        flagFailure(payment, () =>
                        {
                            VTAP.Utility.ShowErrorNotification(`Error processing: ${payment.paymentsno}`);
                        });
                        return;
                    }

                    let user;
                    try
                    {
                        const records = JSON.parse(res.content);
                        user = records[0];
                    } catch
                    {
                        addLog(payment.id, "Failed to parse MikroTik API(/rest/user-manager/user/print) response.");
                        flagFailure(payment, () =>
                        {
                            VTAP.Utility.ShowErrorNotification(`Error processing: ${payment.paymentsno}`);
                        });
                        return;
                    }

                    if (!user?.['.id'])
                    {
                        addLog(payment.id, "No valid PPPoE ID found on MikroTik API(/rest/user-manager/user/print) response.");
                        flagFailure(payment, () =>
                        {
                            VTAP.Utility.ShowErrorNotification(`Error processing: ${payment.paymentsno}`);
                        });
                        return;
                    }

                    const pppoeId = user['.id'];

                    VTAP.CustomApi.Post('Disables a PPPoE username to suspend internet access via the Netwire Fiber Radius Server', {
                        pppoe_id: pppoeId
                    }, (err) =>
                    {
                        if (err)
                        {
                            addLog(payment.id, "Failed to disable PPPoE user on Netwire Fiber Radius Server through MikroTik API(/rest/user-manager/user/disable).");
                            flagFailure(payment, () =>
                            {
                                VTAP.Utility.ShowErrorNotification(`Error processing: ${payment.paymentsno}`);
                            });
                            return;
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
                                flagFailure(payment, () =>
                                {
                                    VTAP.Utility.ShowErrorNotification(`Error processing: ${payment.paymentsno}`);
                                });
                                return;
                            }

                            addLog(payment.id, "Deal sales stage updated to 'Non Payment Internet Disconnection'.");

                            VTAP.Api.Put('records', {
                                module: "Payments",
                                id: payment.id,
                                cf_payments_internetdisabledbyvtiger: "1"
                            }, (err) =>
                            {
                                if (err)
                                {
                                    addLog(payment.id, "Failed to update cf_payments_internetdisabledbyvtiger field payment to enabled.");
                                    flagFailure(payment, () =>
                                    {
                                        VTAP.Utility.ShowErrorNotification(`Error processing: ${payment.paymentsno}`);
                                    });
                                    return;
                                }

                                addLog(payment.id, "Successfully updated cf_payments_internetdisabledbyvtiger field payment to enabled.");
                                storeLogs(payment.id, () =>
                                {
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