<template>
	<section class="bolt-workspace">
		<header>
			<div>
				<h1>Bolt Orders</h1>
				<p>Receive, pick and hand over orders to Bolt couriers.</p>
			</div>
			<v-btn :disabled="store.busy" @click="reload">Refresh</v-btn>
		</header>
		<v-alert v-if="store.error || error" type="error" class="mb-4">{{ error || store.error }}</v-alert>
		<v-alert v-if="!store.enabled" type="info"
			>Bolt operations are not enabled for this terminal, or access has not been configured.</v-alert
		>
		<template v-else>
			<v-alert :type="store.statusBanner.type" variant="tonal" class="mb-4" role="status" aria-live="polite">
				<strong>{{ store.statusBanner.title }}</strong>
				<div>{{ store.statusBanner.text }}</div>
			</v-alert>
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
			<v-alert v-if="notice" type="info" class="mb-4">{{ notice }}</v-alert>
			<v-alert v-if="store.overflow" type="warning"
				>More than 200 active orders. Ask a manager to review the backlog.</v-alert
			>
			<v-alert v-if="store.reviewEvents" type="warning"
				>{{ store.reviewEvents }} incoming events need a manager to review the Bolt event log. They
				may include orders that could not be imported.</v-alert
			>
			<nav class="filters">
				<v-btn
					v-for="tab in tabs"
					:key="tab"
					:variant="filter === tab ? 'flat' : 'outlined'"
					@click="filter = tab"
					>{{ tab }}</v-btn
				>
			</nav>
			<div class="work-grid">
				<div>
					<p v-if="!filtered.length">No orders in this view.</p>
					<button
						v-for="order in filtered"
						:key="order.name"
						class="order-card"
						:class="{ selected: selected?.name === order.name }"
						@click="open(order.name)"
					>
						<strong>#{{ order.order_reference }}</strong
						><span>{{ order.workflow_state }}</span>
						<p>
							€{{ Number(order.source_amount).toFixed(2) }} · Due
							{{ order.due_at || "not supplied" }}
						</p>
						<p v-if="!order.acknowledged_by" class="new-order">
							New alert — acknowledgement needed
						</p>
						<p v-if="order.operation_state === 'Sending'">
							Waiting for Bolt confirmation — do not repeat
						</p>
						<p v-if="order.operation_error" class="text-error">{{ order.operation_error }}</p>
					</button>
				</div>
				<article v-if="selected" class="order-detail">
					<h2>Order #{{ selected.order_reference }}</h2>
					<v-alert v-if="selected.courier_pickup_ts" type="info" class="my-3"
						>Bolt confirms courier pickup at
						{{ new Date(selected.courier_pickup_ts * 1000).toLocaleString() }}. This is separate
						from the ERP handover record.</v-alert
					>
					<v-btn
						v-if="
							store.canReject &&
							selected.attention_from &&
							selected.workflow_state === 'Needs attention'
						"
						:disabled="store.busy"
						@click="recover('resume_problem')"
						>Resume after resolving problem</v-btn
					>
					<v-btn
						v-if="
							store.canReject &&
							selected.operation === 'ready_adjusted' &&
							selected.operation_state === 'Confirmed' &&
							selected.workflow_state === 'Needs attention'
						"
						:disabled="store.busy"
						@click="recover('reconcile_adjustment')"
						>Check final basket again (no repeat refund)</v-btn
					>
					<p v-if="selected.instructions">Customer note: {{ selected.instructions }}</p>
					<p v-if="selected.courier?.partial_name">
						Courier: {{ selected.courier.partial_name }} · {{ selected.courier.phone }}
					</p>
					<p>
						{{ selected.workflow_state }} ·
						{{ selected.assigned_to ? `Picker: ${selected.assigned_to}` : "Awaiting acceptance" }}
					</p>
					<v-alert v-if="selected.operation_error" type="warning" class="my-3">{{
						selected.operation_error
					}}</v-alert>
					<v-btn
						v-if="!selected.acknowledged_by"
						color="warning"
						:disabled="store.busy"
						@click="action('acknowledge')"
						>Acknowledge · stop alarm</v-btn
					>
					<p v-if="selected.workflow_state === 'New'">
						Acknowledgement stops the alert. Accepting confirms the order to Bolt.
					</p>
					<v-btn
						v-if="
							store.canReject &&
							selected.assigned_to !== store.user &&
							['Picking', 'Ready'].includes(selected.workflow_state)
						"
						:disabled="store.busy"
						@click="action('takeover')"
						>Take over picking (manager)</v-btn
					>
					<div class="items">
						<div v-for="line in selected.lines" :key="line.id" class="item">
							<img v-if="line.image" :src="line.image" alt="" />
							<div>
								<strong>{{ line.name }}</strong>
								<p>{{ line.code }} · {{ line.qty }} {{ line.uom }}</p>
							</div>
							<v-text-field
								v-if="selected.workflow_state === 'Picking'"
								v-model.number="picks[line.id]"
								type="number"
								min="0"
								:max="line.qty"
								label="Picked"
								:disabled="store.busy || selected.assigned_to !== store.user"
								hide-details
								density="compact"
								class="quantity"
							/>
						</div>
					</div>
					<v-text-field
						v-if="selected.workflow_state === 'Picking'"
						v-model="barcode"
						label="Scan barcode or enter item code"
						@keydown.enter.prevent="scan"
					/>
					<div class="actions">
						<v-btn
							v-if="selected.workflow_state === 'New'"
							color="success"
							:disabled="store.busy"
							@click="action('accept')"
							>Accept & start picking</v-btn
						>
						<v-btn
							v-if="selected.workflow_state === 'Picking'"
							:disabled="store.busy"
							@click="action('pick', { quantities: picks })"
							>Save picked quantities</v-btn
						>
						<v-btn
							v-if="selected.workflow_state === 'Picking'"
							color="success"
							:disabled="store.busy"
							@click="action('ready')"
							>Mark ready for courier</v-btn
						>
					</div>
					<p v-if="selected.workflow_state === 'Picking'">
						Save quantities before marking ready. Managers can review reduced quantities and equal
						or cheaper replacements below.
					</p>
					<v-btn
						v-if="store.canReject && selected.workflow_state === 'Picking'"
						:disabled="store.busy"
						@click="openAdjustments"
						>Review shortages / replacements</v-btn
					>
					<v-text-field
						v-model="note"
						:label="
							selected.workflow_state === 'Ready'
								? 'Enter order reference to confirm courier handover'
								: 'Reason for rejection / problem'
						"
					/>
					<div class="actions">
						<v-btn
							v-if="selected.workflow_state === 'Ready'"
							color="success"
							:disabled="store.busy"
							@click="action('handover', { note })"
							>Confirm handover & record sale</v-btn
						>
						<v-btn
							v-if="selected.workflow_state === 'New' && store.canReject"
							color="error"
							:disabled="store.busy"
							@click="action('reject', { note })"
							>Reject order</v-btn
						>
						<v-btn
							v-if="['New', 'Picking', 'Ready'].includes(selected.workflow_state)"
							:disabled="store.busy"
							@click="action('shortage', { note })"
							>Report a problem</v-btn
						>
					</div>
					<p class="footnote">
						Payment is collected by Bolt. Handover records the sale under your open shift with the
						separate Bolt Food payment method. POS invoices are consolidated at closing.
						Resolve any ERP error before releasing the goods.
					</p>
				</article>
				<article v-else class="order-detail empty">Choose an order to begin.</article>
			</div>
		</template>
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
		<v-dialog v-model="adjustDialog" max-width="850" :persistent="store.busy">
			<v-card title="Manager: review final basket">
				<v-card-text>
					<p>
						Enter the quantity physically picked. Zero removes the product. Replacements must
						already be published on Bolt and have an equal or lower price.
					</p>
					<div v-for="line in selected?.lines" :key="line.id" class="adjust-row">
						<strong
							>{{ line.name }} · ordered {{ line.qty }} · €{{
								Number(line.rate).toFixed(2)
							}}</strong
						>
						<v-text-field
							v-model.number="picks[line.id]"
							type="number"
							min="0"
							:max="line.qty"
							label="Final picked quantity"
							:disabled="store.busy"
						/>
						<v-autocomplete
							v-model="replacementChoices[line.id]"
							:items="
								replacementOptions.filter((r) => r.price <= line.rate && r.code !== line.code)
							"
							item-title="label"
							item-value="code"
							label="Replacement (leave empty to keep original)"
							clearable
							:disabled="store.busy"
						/>
					</div>
					<v-textarea
						v-model="note"
						label="Reason / customer agreement for this change"
						:disabled="store.busy"
					/>
					<v-alert v-if="preview" type="warning"
						>Final expected total: €{{ Number(preview.expected_total).toFixed(2) }}. Expected
						reduction: €{{
							(Number(selected?.source_amount || 0) - preview.expected_total).toFixed(2)
						}}. Confirming sends the adjusted basket to Bolt, may trigger a customer refund, and
						marks the order ready. It cannot be undone here.</v-alert
					>
					<v-alert v-if="error" type="error">{{ error }}</v-alert>
				</v-card-text>
				<v-card-actions
					><v-btn :disabled="store.busy" @click="adjustDialog = false">Back</v-btn
					><v-btn :disabled="store.busy" @click="previewAdjustment">Review total</v-btn
					><v-btn
						:disabled="store.busy || !preview || note.trim().length < 5"
						color="warning"
						@click="confirmAdjustment"
						>Confirm adjustment & ready</v-btn
					></v-card-actions
				>
			</v-card>
		</v-dialog>
	</section>
</template>
<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useBoltOrdersStore, type BoltOrder } from "../../stores/boltOrdersStore";
const store = useBoltOrdersStore();
const storeChoice = ref(""),
	notice = ref(""),
	adjustDialog = ref(false);
const replacementChoices = ref<Record<string, string | null>>({});
const replacementOptions = ref<{ code: string; name: string; price: number; label: string }[]>([]);
const preview = ref<{ token: string; expected_total: number } | null>(null);
const tabs = ["All", "New", "Picking", "Ready", "Needs attention", "Recent"];
const filter = ref("All"),
	selected = ref<BoltOrder | null>(null),
	error = ref("");
const picks = ref<Record<string, number>>({}),
	barcode = ref(""),
	note = ref("");
const filtered = computed(() =>
	filter.value === "Recent"
		? store.recent
		: store.orders.filter((o) => filter.value === "All" || o.workflow_state === filter.value),
);
let openRequest = 0;
async function open(name: string) {
	const request = ++openRequest;
	try {
		const result = await store.detail(name);
		if (request !== openRequest) return;
		selected.value = result;
		picks.value = Object.fromEntries((result.lines || []).map((l) => [l.id, result.picks[l.id] || 0]));
		error.value = "";
		note.value = "";
	} catch (e: any) {
		error.value = e.message;
	}
}
async function reload() {
	await store.refresh();
	if (selected.value) await open(selected.value.name);
}
async function action(kind: string, extra = {}) {
	if (!selected.value) return;
	try {
		const result = await store.act(selected.value, kind, extra);
		await open(result.name);
	} catch (e: any) {
		error.value = e.message || "Action failed. Refresh before trying again.";
	}
}
function scan() {
	const candidates =
		selected.value?.lines?.filter(
			(l) => l.code === barcode.value.trim() || l.barcodes.includes(barcode.value.trim()),
		) || [];
	const line = candidates.find((l) => (picks.value[l.id] || 0) < l.qty);
	if (line) {
		picks.value[line.id] = (picks.value[line.id] || 0) + 1;
		error.value = "";
	} else
		error.value = candidates.length
			? "All units for this product are already picked."
			: "This barcode is not in this order.";
	barcode.value = "";
}
watch(
	[picks, replacementChoices],
	() => {
		preview.value = null;
	},
	{ deep: true },
);
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
async function recover(method: string) {
	if (!selected.value) return;
	try {
		const result = await store.command(method, {
			name: selected.value.name,
			version: selected.value.modified,
		});
		await open(result.name);
	} catch (e: any) {
		error.value = e.message;
	}
}
async function openAdjustments() {
	try {
		const options = await store.command("replacements");
		replacementOptions.value = options.map((r: any) => ({
			...r,
			label: `${r.name} (${r.code}) · €${Number(r.price).toFixed(2)}`,
		}));
		replacementChoices.value = {};
		preview.value = null;
		adjustDialog.value = true;
	} catch (e: any) {
		error.value = e.message;
	}
}
async function previewAdjustment() {
	if (!selected.value) return;
	try {
		preview.value = await store.command("preview_adjustment", {
			name: selected.value.name,
			version: selected.value.modified,
			quantities: picks.value,
			replacements: replacementChoices.value,
		});
		error.value = "";
	} catch (e: any) {
		preview.value = null;
		error.value = e.message;
	}
}
async function confirmAdjustment() {
	if (!selected.value || !preview.value) return;
	try {
		const result = await store.act(selected.value, "ready_adjusted", {
			quantities: picks.value,
			replacements: replacementChoices.value,
			preview_token: preview.value.token,
			note: note.value,
		});
		adjustDialog.value = false;
		await open(result.name);
	} catch (e: any) {
		error.value = e.message;
	}
}
</script>
<style scoped>
.adjust-row {
	padding: 16px 0;
	border-bottom: 1px solid #ddd;
}
.bolt-workspace {
	padding: 24px;
	max-width: 1500px;
	margin: auto;
}
header {
	display: flex;
	justify-content: space-between;
	align-items: center;
	margin-bottom: 20px;
}
h1 {
	font-size: 28px;
}
p {
	margin: 8px 0;
}
.filters,
.actions {
	display: flex;
	gap: 10px;
	flex-wrap: wrap;
	margin: 16px 0;
}
.work-grid {
	display: grid;
	grid-template-columns: minmax(260px, 1fr) minmax(360px, 2fr);
	gap: 24px;
}
.order-card {
	display: block;
	text-align: left;
	width: 100%;
	border: 1px solid #bbb;
	border-radius: 12px;
	padding: 18px;
	margin-bottom: 12px;
	background: rgb(var(--v-theme-surface));
	color: inherit;
}
.order-card span {
	float: right;
}
.selected {
	border: 2px solid #388e3c;
}
.new-order {
	color: #995000;
	font-weight: 600;
}
.order-detail {
	padding: 24px;
	border: 1px solid #bbb;
	border-radius: 12px;
	background: rgb(var(--v-theme-surface));
}
.item {
	display: flex;
	gap: 12px;
	align-items: center;
	border-bottom: 1px solid #ddd;
	padding: 16px 0;
}
.item img {
	width: 64px;
	height: 64px;
	object-fit: contain;
}
.item > div {
	flex: 1;
}
.quantity {
	max-width: 110px;
}
.footnote {
	font-size: 13px;
	opacity: 0.75;
}
.empty {
	display: grid;
	place-items: center;
}
@media (max-width: 800px) {
	.work-grid {
		grid-template-columns: 1fr;
	}
	.adjust-row {
		padding: 16px 0;
		border-bottom: 1px solid #ddd;
	}
	.bolt-workspace {
		padding: 12px;
	}
}
</style>
