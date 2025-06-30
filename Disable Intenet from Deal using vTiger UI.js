var Potentials_Component_Popup = VTAP.Component.Core.extend({
    data()
    {
        return {
            internetStatus: '',     // user-selected status
            pppoeUsername: '',      // fetched from record
            recordId: ''            // record ID
        };
    },
    mounted()
    {
        VTAP.Detail.Record().then((record) =>
        {
            console.log("Loaded record:", record);
            this.pppoeUsername = record.cf_potentials_pppoeusername;
            this.internetStatus = record.cf_potentials_internetaccessstatus || '';
            this.recordId = record.id;

            if (!this.pppoeUsername)
            {
                VTAP.Utility.ShowErrorNotification("Missing PPPoE username in current deal.");
            }
        });
    },
    methods: {
        onok(event)
        {
            event.preventDefault(); // Prevent modal from closing

            if (!this.pppoeUsername)
            {
                VTAP.Utility.ShowErrorNotification("Missing PPPoE username in the current deal.");
                return;
            }

            if (!this.internetStatus)
            {
                VTAP.Utility.ShowErrorNotification("Please select an internet access status.");
                return;
            }

            const selectedStatus = this.internetStatus;
            const apiName = selectedStatus === 'Disabled'
                ? 'Disable internet access via the Netwire Fiber Radius Server'
                : 'Enable internet access via the Netwire Fiber Radius Server';

            VTAP.Utility.ShowProgress();
            console.log("Fetching PPPoE ID for:", this.pppoeUsername);

            // Step 1: Get PPPoE ID
            VTAP.CustomApi.Post('Find PPPoE ID on Netwire Fiber Radius Server Using MikroTik API', {
                PPPoE_Username: [`=name=${this.pppoeUsername}`]
            }, (fetchError, fetchResponse) =>
            {
                if (fetchError || !fetchResponse?.content)
                {
                    VTAP.Utility.HideProgress();
                    console.error("Failed to fetch PPPoE ID:", fetchError);
                    VTAP.Utility.ShowErrorNotification("Failed to fetch PPPoE ID.");
                    return;
                }

                let userRecords;
                try
                {
                    userRecords = JSON.parse(fetchResponse.content);
                } catch (parseError)
                {
                    VTAP.Utility.HideProgress();
                    console.error("Failed to parse response:", parseError);
                    VTAP.Utility.ShowErrorNotification("Invalid response while fetching PPPoE ID.");
                    return;
                }

                if (!userRecords.length || !userRecords[0]['.id'])
                {
                    VTAP.Utility.HideProgress();
                    console.warn("PPPoE user not found:", userRecords);
                    VTAP.Utility.ShowErrorNotification("PPPoE user not found on Netwire Fiber Radius Server.");
                    return;
                }

                const pppoeId = userRecords[0]['.id'];
                console.log("PPPoE ID:", pppoeId);

                // Step 2: Enable/Disable Internet Access
                VTAP.CustomApi.Post(apiName, {
                    pppoe_id: pppoeId
                }, (error, response) =>
                {
                    if (error)
                    {
                        VTAP.Utility.HideProgress();
                        console.error("Failed to update access status:", error);
                        VTAP.Utility.ShowErrorNotification("Failed to update internet access status.");
                        return;
                    }

                    console.log("Internet access updated successfully. Now updating record field...");

                    // Step 3: Update Deal Field
                    VTAP.Api.Put('records', {
                        module: 'Potentials',
                        id: this.recordId,
                        cf_potentials_internetaccessstatus: selectedStatus
                    }, () =>
                    {
                        VTAP.Utility.HideProgress();
                        VTAP.Utility.ShowSuccessNotification(`Internet access status ${selectedStatus.toLowerCase()} successfully.`);
                        VTAP.Detail.RefreshRecord(); // ✅ Refresh detail view to show updated value
                        this.hidePopup();
                    });
                });
            });
        },
        hidePopup()
        {
            this.$root.$emit('bv::hide::modal', 'modal-1');
        }
    },
    template: `
        <b-modal id="modal-1" title="Update Internet Access Status" @ok="onok" ok-title="Save" :no-close-on-backdrop="true">
            <div class="container">
                <label class="m-2">Internet Access Status</label>
                <select v-model="internetStatus" class="form-control w-50 m-2">
                    <option disabled value="">Select an Option</option>
                    <option value="Enabled">Enabled</option>
                    <option value="Disabled">Disabled</option>
                </select>
            </div>
        </b-modal>
    `
});