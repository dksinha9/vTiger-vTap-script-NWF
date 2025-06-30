var Potentials_Component_PopupResetDealForNewCustomer = VTAP.Component.Core.extend({
    data() {
      return {
        invoices: [],
        contactId: '',
        subscriptions: [],
        completedTasks: 0,
        totalTasks: 0,
        hasError: false
      };
    },
  
    mounted() {
      console.log('[mounted] Component mounted.');
      this.loadRelatedData();
    },
  
    methods: {
      loadRelatedData() {
        console.log('[loadRelatedData] Fetching related records...');
  
        VTAP.Detail.RelatedRecords('Invoice').then((records) => {
          this.invoices = records;
          console.log('[loadRelatedData] Invoices loaded:', records);
        });
  
        VTAP.Detail.RelatedRecords('Subscription').then((records) => {
          this.subscriptions = records;
          console.log('[loadRelatedData] Subscriptions loaded:', records);
        });
  
        VTAP.Detail.RelatedRecords('Contacts').then((records) => {
          this.contactId = records[0]?.id || '';
          console.log('[loadRelatedData] Contact ID set to:', this.contactId);
        });
      },
  
      confirmReset() {
        console.log('[confirmReset] Reset confirmed by user.');
        VTAP.Utility.ShowProgress();
  
        const dealId = VTAP.Detail.Id();
        console.log('[confirmReset] Deal ID:', dealId);
  
        this.completedTasks = 0;
        this.hasError = false;
        this.totalTasks = this.invoices.length + this.subscriptions.length + (this.contactId ? 1 : 0);
        console.log(`[confirmReset] Total tasks to complete: ${this.totalTasks}`);
  
        const finalize = () => {
          console.log('[finalize] All tasks completed. Finalizing...');
          VTAP.Event.Trigger('ONE_VIEW_RELOAD');
          VTAP.Utility.HideProgress();
          if (this.hasError) {
            console.error('[finalize] Errors occurred during reset.');
            VTAP.Utility.ShowErrorNotification("Server error.");
          } else {
            console.log('[finalize] Reset completed successfully.');
            VTAP.Utility.ShowSuccessNotification("Deal reset successfully.");
          }
          VTAP.Detail.RefreshRecord();
          this.closeModal();
        };
  
        const checkCompletion = () => {
          this.completedTasks++;
          console.log(`[checkCompletion] Task completed (${this.completedTasks}/${this.totalTasks})`);
          if (this.completedTasks === this.totalTasks) {
            finalize();
          }
        };
  
        // Step 1: Unlink all invoices
        VTAP.Detail.Relation('Invoice').then((invoiceRelation) => {
          console.log('[confirmReset] Unlinking invoices...');
          this.invoices.forEach((inv) => {
            console.log('[unlinkInvoice] Attempting to unlink invoice:', inv.id);
            VTAP.Api.Delete('records/relationrecords', {
              module: 'Potentials',
              id: dealId,
              relation_id: invoiceRelation.relation_id,
              related_module: 'Invoice',
              related_record_id: inv.id
            }, (error) => {
              if (error) {
                this.hasError = true;
                console.error('[unlinkInvoice] Error unlinking invoice:', inv.id, error);
              } else {
                console.log('[unlinkInvoice] Successfully unlinked invoice:', inv.id);
              }
              checkCompletion();
            });
          });
        });
  
        // Step 2: Unlink contact
        if (this.contactId) {
          console.log('[confirmReset] Unlinking contact:', this.contactId);
          VTAP.Detail.Relation('Contacts').then((contactRelation) => {
            VTAP.Api.Delete('records/relationrecords', {
              module: 'Potentials',
              id: dealId,
              relation_id: contactRelation.relation_id,
              related_module: 'Contacts',
              related_record_id: this.contactId
            }, (error) => {
              if (error) {
                this.hasError = true;
                console.error('[unlinkContact] Error unlinking contact:', this.contactId, error);
              } else {
                console.log('[unlinkContact] Successfully unlinked contact:', this.contactId);
              }
              checkCompletion();
            });
          });
        }
  
        // Step 3: Delete subscriptions
        console.log('[confirmReset] Deleting subscriptions...');
        this.subscriptions.forEach((sub) => {
          console.log('[deleteSubscription] Attempting to delete subscription:', sub.id);
          VTAP.Api.Delete('records', {
            module: 'Subscription',
            id: sub.id
          }, (error) => {
            if (error) {
              this.hasError = true;
              console.error('[deleteSubscription] Error deleting subscription:', sub.id, error);
            } else {
              console.log('[deleteSubscription] Successfully deleted subscription:', sub.id);
            }
            checkCompletion();
          });
        });
      },
  
      closeModal() {
        console.log('[closeModal] Closing modal...');
        this.$root.$emit('bv::hide::modal', 'reset-confirm-modal');
      }
    },
  
    template: `
      <b-modal id="reset-confirm-modal" title="Reset Deal For New Customer" @ok="confirmReset" ok-title="Yes" cancel-title="No">
        <div class="text-danger">
          Are you sure you want to unlink all invoices and the related contact, and delete this subscription?
        </div>
      </b-modal>
    `
  });