import {
	getOpeningStorage,
	setOpeningStorage,
	setPrintTemplate,
	setOfflinePrintContext,
	setTermsAndConditions,
	getBootstrapSnapshot,
	setBootstrapSnapshot,
} from "../offline/index";
import { createBootstrapSnapshotFromRegisterData } from "../offline/bootstrapSnapshot";

declare const __BUILD_VERSION__: string;
declare const frappe: any;

const BUILD_VERSION =
	typeof __BUILD_VERSION__ !== "undefined" ? __BUILD_VERSION__ : null;

async function cachePrintTemplateAndTerms(profile: any) {
	if (!profile || typeof frappe === "undefined" || !navigator.onLine) return;

	try {
		const receipt = await frappe.call({
			method: "posawesome.posawesome.api.print_formats.get_offline_print_context",
			args: { pos_profile: profile.name },
		});
		if (receipt.message?.profile === profile.name) {
			setOfflinePrintContext(receipt.message);
			setPrintTemplate(receipt.message.html || "");
		}
	} catch (e) {
		console.error(
			"Failed to cache the configured receipt layout; keeping the previous cached layout",
			e,
		);
	}

	try {
		const termsName = profile.tc_name || profile.terms_and_conditions;
		if (termsName) {
			const tc = await frappe.call({
				method: "frappe.client.get_value",
				args: {
					doctype: "Terms and Conditions",
					fieldname: "terms",
					filters: { name: termsName },
				},
			});
			if (tc.message && tc.message.terms) {
				setTermsAndConditions(tc.message.terms);
			}
		}
	} catch (e) {
		console.error("Failed to fetch terms and conditions", e);
	}
}

function hasProfileChanged(currentProfile: any, nextProfile: any) {
	if (!nextProfile) return false;
	if (!currentProfile) return true;
	if (currentProfile.name !== nextProfile.name) return true;
	if (currentProfile.modified && nextProfile.modified) {
		return currentProfile.modified !== nextProfile.modified;
	}
	return false;
}

function updateOpeningStorageProfile(profile: any) {
	const cached = getOpeningStorage() as any;
	if (cached?.pos_profile) {
		const updated = { ...cached, pos_profile: profile };
		setOpeningStorage(updated);
		setBootstrapSnapshot(
			createBootstrapSnapshotFromRegisterData(
				updated,
				getBootstrapSnapshot(),
				{ buildVersion: BUILD_VERSION },
			),
		);
	}
}

export async function ensurePosProfile() {
	const bootProfile = frappe?.boot?.pos_profile;
	if (
		bootProfile &&
		bootProfile.warehouse &&
		bootProfile.selling_price_list
	) {
		await cachePrintTemplateAndTerms(bootProfile);
		if (navigator.onLine) {
			try {
				const res = await frappe.call({
					method: "posawesome.posawesome.api.utils.get_active_pos_profile",
					args: { user: frappe.session.user },
				});
				if (
					res.message &&
					hasProfileChanged(bootProfile, res.message)
				) {
					frappe.boot.pos_profile = res.message;
					updateOpeningStorageProfile(res.message);
					await cachePrintTemplateAndTerms(res.message);
					return res.message;
				}
			} catch (e) {
				console.error("Failed to refresh active POS profile", e);
			}
		}
		return bootProfile;
	}
	try {
		const res = await frappe.call({
			method: "posawesome.posawesome.api.utils.get_active_pos_profile",
			args: { user: frappe.session.user },
		});
		if (res.message) {
			frappe.boot.pos_profile = res.message;
			updateOpeningStorageProfile(res.message);
			setBootstrapSnapshot(
				createBootstrapSnapshotFromRegisterData(
					{
						pos_profile: res.message,
						pos_opening_shift: (getOpeningStorage() as any)
							?.pos_opening_shift,
					},
					getBootstrapSnapshot(),
					{ buildVersion: BUILD_VERSION },
				),
			);
			await cachePrintTemplateAndTerms(res.message);
			return res.message;
		}
	} catch (e) {
		console.error("Failed to fetch active POS profile", e);
	}
	const cached = getOpeningStorage() as any;
	if (cached && cached.pos_profile) {
		await cachePrintTemplateAndTerms(cached.pos_profile);
		return cached.pos_profile;
	}
	await cachePrintTemplateAndTerms(bootProfile);
	return bootProfile || null;
}
