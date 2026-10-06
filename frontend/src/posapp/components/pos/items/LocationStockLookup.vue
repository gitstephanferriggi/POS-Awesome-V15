<template>
	<v-btn variant="text" color="primary" prepend-icon="mdi-store-search" @click="open = true">
		Stock by location
	</v-btn>
	<v-dialog v-model="open" max-width="850" @keydown.stop>
		<v-card title="Stock by location">
			<v-card-text>
				<p class="mb-3">Scan a barcode or enter an item name, item code or JYSK code.</p>
				<v-text-field
					v-model="query"
					label="Scan or search item"
					autofocus
					clearable
					append-inner-icon="mdi-magnify"
					@keydown.enter.prevent="search"
					@click:append-inner="search"
				/>
				<v-btn color="primary" :loading="loading" :disabled="!query?.trim()" @click="search"
					>Check stock</v-btn
				>
				<v-alert v-if="error" type="warning" class="mt-3">{{ error }}</v-alert>
				<p v-if="checked && !items.length && !error" class="mt-3">No matching products found.</p>
				<v-card v-for="item in items" :key="item.name" variant="outlined" class="mt-4 pa-3">
					<div class="d-flex align-center ga-3 mb-2">
						<v-img v-if="item.image" :src="item.image" width="64" max-width="64" height="64" />
						<div>
							<strong>{{ item.item_name }}</strong>
							<div>{{ item.name }} · JYSK {{ item.jysk_fos_article || "—" }}</div>
						</div>
					</div>
					<p>
						This shop:
						<strong>{{ item.current_available }} {{ item.stock_uom }}</strong> available
					</p>
					<v-table v-if="item.locations.length" density="compact">
						<thead>
							<tr>
								<th>Location</th>
								<th>Available</th>
								<th>Reserved</th>
							</tr>
						</thead>
						<tbody>
							<tr v-for="row in item.locations" :key="row.warehouse">
								<td>
									{{ row.location_name }} <strong v-if="row.is_current">(this shop)</strong>
								</td>
								<td>{{ row.available_qty }} {{ item.stock_uom }}</td>
								<td>{{ row.reserved_qty }} {{ item.stock_uom }}</td>
							</tr>
						</tbody>
					</v-table>
					<p v-else class="mt-2">No available stock at any selling location.</p>
					<p v-if="item.locations.some((row) => !row.is_current)" class="mt-2 text-medium-emphasis">
						Other locations have stock. Discuss delivery or collection with the customer and
						reserve it through the order flow.
					</p>
				</v-card>
				<p v-if="checked && !error" class="mt-3 text-caption">
					Live stock checked {{ checked }}. Quantities are in stock units; this lookup does not
					reserve stock.
				</p>
			</v-card-text>
			<v-card-actions><v-spacer /><v-btn @click="open = false">Close</v-btn></v-card-actions>
		</v-card>
	</v-dialog>
</template>

<script setup>
import { ref, watch } from "vue";
import { isOffline } from "../../../../offline";
const props = defineProps({ posProfile: { type: Object, required: true } });
const open = ref(false);
const query = ref("");
const items = ref([]);
const loading = ref(false);
const error = ref("");
const checked = ref("");
let request = 0;
watch(
	() => props.posProfile?.name,
	() => {
		request++;
		items.value = [];
		checked.value = "";
		loading.value = false;
	},
);
watch(open, () => {
	request++;
	items.value = [];
	checked.value = "";
	error.value = "";
	loading.value = false;
});
async function search() {
	if (!query.value?.trim() || !props.posProfile?.name) return;
	const version = ++request;
	items.value = [];
	error.value = "";
	checked.value = "";
	if (isOffline()) {
		error.value = "Connect to the internet to check live stock at other locations.";
		return;
	}
	loading.value = true;
	try {
		const response = await frappe.call({
			method: "jysk_malta.api.stock.pos_location_stock",
			args: { pos_profile: props.posProfile.name, query: query.value.trim() },
		});
		if (version !== request) return;
		if (!response.message || response.exc) throw new Error("Stock lookup failed");
		items.value = response.message.items;
		checked.value = new Date().toLocaleTimeString();
	} catch {
		if (version === request)
			error.value = "Live stock could not be loaded. Check your connection and try again.";
	} finally {
		if (version === request) loading.value = false;
	}
}
</script>
