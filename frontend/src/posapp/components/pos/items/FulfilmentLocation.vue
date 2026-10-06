<template>
	<v-btn
		v-if="item"
		size="small"
		variant="text"
		color="primary"
		prepend-icon="mdi-truck-delivery"
		@click="change"
		>Choose fulfilment location</v-btn
	>
	<v-dialog
		v-model="open"
		max-width="650"
		@keydown.stop
		@update:model-value="
			(value) => {
				if (!value) finish(null);
			}
		"
	>
		<v-card title="Choose fulfilment location">
			<v-card-text>
				<strong>{{ product?.item_name }}</strong>
				<p class="my-2">{{ message }}</p>
				<p v-if="loading">Checking live availability…</p>
				<v-alert v-if="error" type="warning">{{ error }}</v-alert>
				<v-list v-if="!loading && !error">
					<v-list-item
						v-for="location in product?.locations || []"
						:key="location.warehouse"
						:title="location.location_name + (location.is_current ? ' (this shop)' : '')"
						:subtitle="`${location.available_qty} ${product.stock_uom} available`"
						:disabled="location.available_qty < required"
						@click="finish(location)"
					>
						<template #append><v-icon>mdi-chevron-right</v-icon></template>
					</v-list-item>
				</v-list>
				<p class="mt-3">
					Required: {{ required }} {{ product?.stock_uom }}. Stock is reserved when the order is
					submitted.
				</p>
			</v-card-text>
			<v-card-actions><v-spacer /><v-btn @click="finish(null)">Cancel</v-btn></v-card-actions>
		</v-card>
	</v-dialog>
</template>
<script setup>
import { ref, onBeforeUnmount } from "vue";
import { isOffline } from "../../../../offline";
const props = defineProps({ posProfile: Object, item: Object });
const emit = defineEmits(["selected"]);
const open = ref(false),
	loading = ref(false),
	error = ref(""),
	message = ref("");
const product = ref(null),
	required = ref(1);
let resolveChoice = null;
let sequence = 0;
function finish(location) {
	sequence++;
	open.value = false;
	loading.value = false;
	const resolve = resolveChoice;
	resolveChoice = null;
	resolve?.(location);
}
onBeforeUnmount(() => finish(null));
async function choose(line, qty, force = false) {
	if (resolveChoice) return null;
	const version = ++sequence;
	required.value = Math.abs(Number(qty) || 1) * (Number(line.conversion_factor) || 1);
	product.value = null;
	error.value = "";
	message.value = "";
	const choice = new Promise((resolve) => {
		resolveChoice = resolve;
	});
	open.value = force;
	loading.value = true;
	try {
		if (isOffline()) throw new Error("Connect to check and reserve stock at a fulfilment location.");
		const response = await frappe.call({
			method: "jysk_malta.api.stock.pos_location_stock",
			args: { pos_profile: props.posProfile.name, query: line.item_code },
		});
		if (version !== sequence) return choice;
		if (!response.message || response.exc)
			throw new Error("Could not check live stock. Please try again.");
		product.value = response.message.items.find((item) => item.name === line.item_code);
		if (!product.value) throw new Error("No stock product matched this item.");
		const current = product.value.locations.find(
			(row) => row.warehouse === (line.warehouse || props.posProfile.warehouse),
		);
		if (!force && current?.available_qty >= required.value) {
			finish(current);
			return choice;
		}
		message.value = force
			? "Select the source for this order line."
			: "This shop does not have enough available stock. Select another source.";
		if (!product.value.locations.some((row) => row.available_qty >= required.value))
			message.value =
				"No location has enough available stock for this quantity. Reduce the quantity or split it across separate order lines.";
		open.value = true;
	} catch (e) {
		if (version === sequence) {
			error.value = e.message;
			open.value = true;
		}
	} finally {
		if (version === sequence) loading.value = false;
	}
	return choice;
}
async function change() {
	const location = await choose(props.item, props.item.qty, true);
	if (location) emit("selected", location);
}
defineExpose({ choose });
</script>
