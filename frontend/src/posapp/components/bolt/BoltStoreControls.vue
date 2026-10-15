<template>
			<div class="bolt-status" role="status" aria-live="polite">
				<strong>{{ store.statusBanner.title }}</strong>
				<div>{{ store.statusBanner.text }}</div>
			</div>
			<div class="actions">
				<v-btn
					v-if="store.canReject"
					:disabled="store.storeControlsBlocked || store.availability === 'open'"
					:color="store.availability === 'open' ? 'grey' : 'success'"
					@click="storeChoice = 'open'"
					>Accept new orders</v-btn
				>
				<v-btn
					v-if="store.canReject"
					:disabled="store.storeControlsBlocked || store.availability === 'pause'"
					:color="store.availability === 'pause' ? 'grey' : 'warning'"
					@click="storeChoice = 'pause'"
					>Pause new orders</v-btn
				>
			</div>
		<v-dialog :model-value="!!storeChoice" max-width="500" @update:model-value="storeChoice = ''">
			<v-card title="Change Bolt store availability"
				><v-card-text>{{
					storeChoice === "open"
						? "Allow new Bolt orders to arrive? Make sure staff and the alarm terminal are ready."
						: "Pause new Bolt orders indefinitely? Existing orders still need to be fulfilled."
				}}</v-card-text
				><v-card-actions
					><v-btn :disabled="store.busy" @click="storeChoice = ''">Back</v-btn
					><v-btn :disabled="store.busy" color="primary" @click="changeStore"
						>Confirm</v-btn
					></v-card-actions
				></v-card
			>
		</v-dialog>
<span v-if="notice" role="status">{{ notice }}</span><span v-if="error" role="alert">{{ error }}</span>
</template>
<script setup lang="ts">
import { ref } from "vue";
import { useBoltOrdersStore } from "../../stores/boltOrdersStore";
const store = useBoltOrdersStore();
const storeChoice = ref(""), notice = ref(""), error = ref("");
async function changeStore() {
	try {
		const result = await store.command("store_status", { action: storeChoice.value });
		notice.value = result.message;
		storeChoice.value = "";
	} catch (e: any) {
		error.value = e.message;
		storeChoice.value = "";
	}
}

</script>
<style scoped>
.bolt-status { flex: 1; min-width: 220px; }
.bolt-status div { font-size: 12px; }
.actions { display:flex; flex-wrap:wrap; gap:8px; }
</style>
