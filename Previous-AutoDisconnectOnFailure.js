const logsMap = {};

function addLog(id, message) {
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

function storeLogs(paymentId, callback) {
    const logString = logsMap[paymentId]?.join('\n') || '[No logs recorded]';
    VTAP.Api.Put('records', {
        module: "Payments",
        id: paymentId,
        cf_payments_scriptlogs: logString
    }, (error) => {
        if (callback) callback();
    });
}

function flagFailure(payment, callback) {
    addLog(payment.id, "[INFO] Flagging VTAP script failure.");
    VTAP.Api.Put('records', {
        module: "Payments",
        id: payment.id,
        cf_payments_vtapscriptfailed: "1"
    }, () => {
        storeLogs(payment.id, callback);
    });
}

// MAIN EXECUTION
VTAP.CustomApi.Get('Get All Failed Payment', {}, (err, payments) => {
    if (err || !Array.isArray(payments)) {
        console.error("Failed to get failed payments:", err);
        return;
    }
    console.log(payments);

    payments.forEach(payment => {
        payment.id = payment.id.split('x')[1];
        console.log(payment.id)
        addLog(payment.id, `Processing payment: ${payment.paymentsno}`);

        const [modulePrefix, invoiceId] = payment.related_to.split('x');
        if (!invoiceId) {
            addLog(payment.id, "[WARN] Missing related_to field.");
            flagFailure(payment);
            return;
        }

        console.log(invoiceId);

        VTAP.Api.Get('records', {
            id: invoiceId,
            module: "Invoice"
        }, (err, invoice) => {
            if (err || !invoice) {
                addLog(payment.id, "[ERROR] Failed to fetch invoice.");
                flagFailure(payment);
                return;
            }
            console.log(invoice);

            const dealId = invoice.potential_id?.id;
            const dealModule = invoice.potential_id?.module || "Potentials";

            if (!dealId || !dealModule) {
                addLog(payment.id, "[WARN] Invoice not linked to a deal.");
                flagFailure(payment);
                return;
            }

            VTAP.Api.Get('records', {
                id: dealId,
                module: dealModule
            }, (err, deal) => {
                if (err || !deal) {
                    addLog(payment.id, "[ERROR] Failed to fetch deal.");
                    flagFailure(payment);
                    return;
                }

                const username = deal.cf_potentials_pppoeusername;
                if (!username) {
                    addLog(payment.id, "[WARN] PPPoE username missing.");
                    flagFailure(payment);
                    return;
                }

                VTAP.CustomApi.Post('Find PPPoE ID on Netwire Fiber Radius Server Using MikroTik API', {
                    PPPoE_Username: [`=name=${username}`]
                }, (err, res) => {
                    if (err || !res?.content) {
                        addLog(payment.id, "[ERROR] PPPoE lookup failed.");
                        flagFailure(payment);
                        return;
                    }

                    let user;
                    try {
                        const records = JSON.parse(res.content);
                        user = records[0];
                    } catch {
                        addLog(payment.id, "[ERROR] Failed to parse MikroTik API response.");
                        flagFailure(payment);
                        return;
                    }

                    if (!user?.['.id']) {
                        addLog(payment.id, "[WARN] No valid PPPoE ID found.");
                        flagFailure(payment);
                        return;
                    }

                    const pppoeId = user['.id'];

                    VTAP.CustomApi.Post('Disables a PPPoE username to suspend internet access via the Netwire Fiber Radius Server', {
                        pppoe_id: pppoeId
                    }, (err) => {
                        if (err) {
                            addLog(payment.id, "[ERROR] Failed to disable PPPoE user.");
                            flagFailure(payment);
                            return;
                        }

                        addLog(payment.id, "[SUCCESS] PPPoE user disabled.");

                        VTAP.Api.Put('records', {
                            module: dealModule,
                            id: dealId,
                            sales_stage: "Non Payment Internet Disconnection"
                        }, (err) => {
                            if (err) {
                                addLog(payment.id, "[ERROR] Failed to update deal stage.");
                                flagFailure(payment);
                                return;
                            }

                            addLog(payment.id, "[INFO] Deal sales stage updated.");

                            VTAP.Api.Put('records', {
                                module: "Payments",
                                id: payment.id,
                                cf_payments_internetdisabledbyvtiger: "1"
                            }, (err) => {
                                if (err) {
                                    addLog(payment.id, "[ERROR] Failed to mark payment.");
                                    flagFailure(payment);
                                    return;
                                }

                                addLog(payment.id, "[INFO] Payment marked as internet disabled.");
                                storeLogs(payment.id, () => {
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