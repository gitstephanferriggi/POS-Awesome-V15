<template>
	<v-row justify="center">
		<v-dialog
			v-model="isUpdateCustomerDialogOpen"
			max-width="600px"
			persistent
			@keydown.esc.capture.stop.prevent="handleDialogEscape"
		>
			<v-card>
				<v-card-title class="d-flex align-center">
					<span v-if="customer_id" class="text-h5 text-primary">{{ __("Update Customer") }}</span>
					<span v-else class="text-h5 text-primary">{{ __("Create Customer") }}</span>
					<v-spacer></v-spacer>
					<v-switch
						v-model="hideNonEssential"
						density="compact"
						inset
						hide-details
						color="primary"
						:label="__('Hide Non Essential Fields')"
					></v-switch>
				</v-card-title>
				<v-card-text class="pa-0">
					<v-container>
						<v-row>
							<v-col cols="12">
								<v-text-field
									ref="customerNameField"
									density="compact"
									color="primary"
									:label="frappe._('Customer Name') + ' *'"
									hide-details
									class="pos-themed-input"
									v-model="customer_name"
								></v-text-field>
							</v-col>
							<v-col cols="6">
								<v-text-field
									density="compact"
									color="primary"
									:label="frappe._('Tax ID')"
									class="pos-themed-input"
									hide-details
									v-model="tax_id"
								></v-text-field>
							</v-col>
							<v-col cols="6">
								<v-text-field
									density="compact"
									color="primary"
									:label="frappe._('Mobile No')"
									class="pos-themed-input"
									hide-details
									v-model="mobile_no"
								></v-text-field>
							</v-col>
							<v-col cols="12" v-if="!hideNonEssential">
								<v-text-field
									density="compact"
									color="primary"
									:label="__('Address Line 1')"
									hide-details
									class="pos-themed-input"
									v-model="address_line1"
								></v-text-field>
							</v-col>

							<v-col cols="12" sm="6" v-if="!hideNonEssential">
								<v-autocomplete
									v-if="country === 'Malta'"
									v-model="city"
									:items="cityOptions(originalCity)"
									:custom-filter="cityFilter"
									clearable
									variant="outlined"
									density="compact"
									:label="__('City')"
									class="pos-themed-input"
								></v-autocomplete>
								<v-text-field v-else v-model="city" :label="__('City')" variant="outlined" density="compact" class="pos-themed-input" />
							</v-col>

							<v-col cols="12" sm="6" v-if="!hideNonEssential">
								<v-select
									v-model="country"
									:items="countries"
									variant="outlined"
									density="compact"
									:label="__('Country')"
									class="pos-themed-input"
								></v-select>
							</v-col>

							<v-col cols="12">
								<v-text-field
									density="compact"
									color="primary"
									:label="frappe._('Email Id')"
									class="pos-themed-input"
									hide-details
									v-model="email_id"
								></v-text-field>
							</v-col>
							<v-col cols="6" v-if="!hideNonEssential">
								<v-autocomplete
									clearable
									density="compact"
									auto-select-first
									color="primary"
									:label="frappe._('Customer Group') + ' *'"
									v-model="group"
									:items="groups"
									class="pos-themed-input"
									:no-data-text="__('Group not found')"
									hide-details
									required
								>
								</v-autocomplete>
							</v-col>
							<v-col cols="6" v-if="!hideNonEssential">
								<v-autocomplete
									clearable
									density="compact"
									auto-select-first
									color="primary"
									:label="frappe._('Territory') + ' *'"
									v-model="territory"
									:items="territorys"
									class="pos-themed-input"
									:no-data-text="__('Territory not found')"
									hide-details
									required
								>
								</v-autocomplete>
							</v-col>
							<v-col cols="6" v-if="loyalty_program">
								<v-text-field
									v-model="loyalty_program"
									:label="frappe._('Loyalty Program')"
									density="compact"
									readonly
									hide-details
									class="pos-themed-input"
								></v-text-field>
							</v-col>
							<v-col cols="6" v-if="loyalty_points">
								<v-text-field
									v-model="loyalty_points"
									:label="frappe._('Loyalty Points')"
									density="compact"
									readonly
									hide-details
									class="pos-themed-input"
								></v-text-field>
							</v-col>
						</v-row>
					</v-container>
				</v-card-text>
				<v-card-actions>
					<v-spacer></v-spacer>
					<v-btn color="error" theme="dark" @click="confirm_close">{{ __("Close") }}</v-btn>
					<v-btn color="success" theme="dark" @click="submit_dialog">{{ __("Submit") }}</v-btn>
				</v-card-actions>
			</v-card>
		</v-dialog>

		<!-- Confirmation Dialog -->
		<v-dialog
			v-model="confirmDialog"
			max-width="400px"
			@keydown.esc.capture.stop.prevent="handleConfirmEscape"
		>
			<v-card>
				<v-card-title class="text-h5 text-primary">
					{{ __("Confirm Close") }}
				</v-card-title>
				<v-card-text>
					{{ __("Are you sure you want to close? All entered data will be lost.") }}
				</v-card-text>
				<v-card-actions>
					<v-spacer></v-spacer>
					<v-btn color="primary" @click="confirmDialog = false">
						{{ __("Continue Editing") }}
					</v-btn>
					<v-btn color="error" @click="confirmClose">
						{{ __("Yes, Close") }}
					</v-btn>
				</v-card-actions>
			</v-card>
		</v-dialog>
	</v-row>
</template>

<script>
import { cityOptions, cityFilter, validCity, customerDefaults } from "../../../../utils/maltaLocalities";
import { isOffline, saveOfflineCustomer } from "../../../../../offline/index";
import { useCustomersStore } from "../../../../stores/customersStore";
import { useUIStore } from "../../../../stores/uiStore";
import { storeToRefs } from "pinia";
import { useToastStore } from "../../../../stores/toastStore";

export default {
	setup() {
		const customersStore = useCustomersStore();
		const uiStore = useUIStore();
		const toastStore = useToastStore();
		const { selectedCustomer, isUpdateCustomerDialogOpen, customerToUpdate } =
			storeToRefs(customersStore);
		return {
			selectedCustomer,
			uiStore,
			toastStore,
			isUpdateCustomerDialogOpen,
			customerToUpdate,
			customersStore,
		};
	},
	data: () => ({
		// customerDialog: false, // Moved to store
		confirmDialog: false,
		pos_profile: "",
		customer_id: "",
		customer_name: "",
		tax_id: "",
		mobile_no: "",
		address_line1: "",
		city: "",
		originalCity: "",
		country: "Malta",
		email_id: "",
		group: "",
		groups: [],
		territory: "",
		territorys: [],
		customer_type: "Individual",
		loyalty_points: null,
		loyalty_program: null,
		hideNonEssential: false,
		countries: [
			"Afghanistan",
			"Australia",
			"Bahrain",
			"Bangladesh",
			"Canada",
			"China",
			"Denmark",
			"France",
			"Germany",
			"India",
			"Indonesia",
			"Italy",
			"Japan",
			"Kuwait",
			"Malaysia",
			"Malta",
			"Nepal",
			"Netherlands",
			"New Zealand",
			"Norway",
			"Oman",
			"Malta",
			"Philippines",
			"Qatar",
			"Saudi Arabia",
			"Singapore",
			"South Korea",
			"Spain",
			"Sri Lanka",
			"Sweden",
			"Switzerland",
			"Syria",
			"Thailand",
			"United Arab Emirates",
			"United Kingdom",
			"United States",
			"Vietnam",
			"Yemen",
		],
	}),
	watch: {
		hideNonEssential(val) {
			if (typeof localStorage !== "undefined") {
				localStorage.setItem("posawesome_hide_non_essential_fields", JSON.stringify(val));
			}
		},

	},
	computed: {},
	methods: {
		cityOptions, cityFilter,
		applyCustomerDefaults() {
			Object.assign(this, customerDefaults(this.pos_profile || {}, {
				group: frappe.defaults.get_user_default("Customer Group"), territory: frappe.defaults.get_user_default("Territory"),
			}));
		},
		focusCustomerNameField() {
			this.$nextTick(() => {
				const field = this.$refs.customerNameField;
				if (field && typeof field.focus === "function") {
					field.focus();
				}
			});
		},
		handleDialogEscape() {
			if (this.confirmDialog) {
				this.confirmClose();
				return;
			}
			this.confirm_close();
		},
		handleConfirmEscape() {
			this.confirmClose();
		},
		confirm_close() {
			// Check if any data has been entered
			if (
				this.customer_name ||
				this.tax_id ||
				this.mobile_no ||
				this.address_line1 ||
				this.email_id || this.city
			) {
				this.confirmDialog = true;
			} else {
				// If no data entered, just close
				this.close_dialog();
			}
		},
		confirmClose() {
			this.confirmDialog = false;
			this.close_dialog();
		},
		close_dialog() {
			this.customersStore.closeUpdateCustomerDialog();
			this.clear_customer();
		},
		clear_customer() {
			this.customer_name = "";
			this.tax_id = "";
			this.mobile_no = "";
			this.address_line1 = "";
			this.city = "";
			this.originalCity = "";
			this.applyCustomerDefaults();
			this.email_id = "";

			this.customer_id = "";
			this.customer_type = "Individual";
			this.loyalty_points = null;
			this.loyalty_program = null;
		},
		getCustomerGroups() {
			if (this.groups.length > 0) return;
			const vm = this;
			frappe.db
				.get_list("Customer Group", {
					fields: ["name"],
					filters: { is_group: 0 },
					limit: 1000,
					order_by: "name",
				})
				.then((data) => {
					if (data.length > 0) {
						data.forEach((el) => {
							vm.groups.push(el.name);
						});
					}
				});
		},
		getCustomerTerritorys() {
			if (this.territorys.length > 0) return;
			const vm = this;
			frappe.db
				.get_list("Territory", {
					fields: ["name"],
					filters: { is_group: 0 },
					limit: 5000,
					order_by: "name",
				})
				.then((data) => {
					if (data.length > 0) {
						data.forEach((el) => {
							vm.territorys.push(el.name);
						});
					}
				});
		},
		async submit_dialog() {
			const vm = this;
			if (!this.customer_name) {
				frappe.throw(__("Customer Name is required"));
				return;
			}

			if (!this.group) {
				frappe.throw(__("Customer group is required"));
				return;
			}

			if (!this.territory) {
				frappe.throw(__("Customer territory is required"));
				return;
			}

			if (!validCity(this.city, this.country, this.originalCity) || (this.address_line1 && !this.city)) {
				frappe.throw(__("Select a city for this address from the list."));
				return;
			}
			// Create args object to use in callback
			const args = {
				customer_id: this.customer_id,
				customer_name: this.customer_name,
				tax_id: this.tax_id,
				mobile_no: this.mobile_no,
				address_line1: this.address_line1,
				city: this.city,
				country: this.country,
				email_id: this.email_id,
				customer_group: this.group,
				territory: this.territory,
				customer_type: this.customer_type,
			};
			const apiArgs = {
				...args,
				company: vm.pos_profile.company,
				pos_profile_doc: JSON.stringify(vm.pos_profile),
				method: this.customer_id ? "update" : "create",
			};

			const customersStore = useCustomersStore();

			if (isOffline()) {
				await saveOfflineCustomer({ args: apiArgs });
				vm.toastStore.show({ title: __("Customer saved offline"), color: "warning" });
				args.name = this.customer_name;
				await customersStore.addOrUpdateCustomer({
					name: args.name,
					customer_name: args.customer_name,
					mobile_no: args.mobile_no,
					email_id: args.email_id,
					tax_id: args.tax_id,
					primary_address: args.address_line1,
					customer_group: args.customer_group,
					territory: args.territory,
					city: args.city,
					country: args.country,
				});
				vm.close_dialog();
				return;
			}

			frappe.call({
				method: "posawesome.posawesome.api.customers.create_customer",
				args: apiArgs,
				callback: async (r) => {
					if (!r.exc && r.message.name) {
						let text = __("Customer created successfully.");
						if (vm.customer_id) {
							text = __("Customer updated successfully.");
						}
						vm.toastStore.show({
							title: text,
							color: "success",
						});
						args.name = r.message.name;
						frappe.utils.play_sound("submit");
						await customersStore.addOrUpdateCustomer({
							name: args.name,
							customer_name: args.customer_name,
							mobile_no: args.mobile_no,
							email_id: args.email_id,
							tax_id: args.tax_id,
							primary_address: args.address_line1,
					customer_group: args.customer_group,
					territory: args.territory,
					city: args.city,
					country: args.country,
						});
						vm.close_dialog();
					} else {
						frappe.utils.play_sound("error");
						vm.toastStore.show({
							title: __("Customer creation failed."),
							color: "error",
						});
					}
				},
			});
		},

	},
	created: function () {
		if (typeof localStorage !== "undefined") {
			const saved = localStorage.getItem("posawesome_hide_non_essential_fields");
			if (saved !== null) {
				this.hideNonEssential = JSON.parse(saved);
			}
		}
		// Watch store state for dialog opening
		this.$watch(
			() => this.isUpdateCustomerDialogOpen,
			(isOpen) => {
				if (isOpen) {
					this.focusCustomerNameField();
					const data = this.customerToUpdate;
					if (data) {
						this.customer_name = data.customer_name || data.name || ""; // fallback
						this.customer_id = data.name;
						this.address_line1 = data.primary_address || data.address_line1 || "";
						this.city = data.city || "";
						this.originalCity = this.city;
						this.country =
							data.country ||
							(this.pos_profile && this.pos_profile.posa_default_country) ||
							"Malta";
						this.tax_id = data.tax_id;
						this.mobile_no = data.mobile_no;
						this.email_id = data.email_id;
						this.group = data.customer_group;
						this.territory = data.territory;
						this.loyalty_points = data.loyalty_points;
						this.loyalty_program = data.loyalty_program;
					} else {
						// Setup for new customer
						this.clear_customer();
					}
				}
			},
		);

		// Watch Store for POS Profile
		this.$watch(
			() => this.uiStore.posProfile,
			(profile) => {
				if (profile) {
					this.pos_profile = profile;
					if (!this.isUpdateCustomerDialogOpen) this.applyCustomerDefaults();
				}
			},
			{ deep: true, immediate: true },
		);

		this.getCustomerGroups();
		this.getCustomerTerritorys();
		// set default values for customer group and territory from user defaults
		this.applyCustomerDefaults();
	},
};
</script>

<style scoped></style>
