import { useI18n, type LanguagePreference } from "../lib/i18n";
import { SelectMenu } from "./ui";

export function LanguageControl(): React.JSX.Element {
	const { preference, setPreference, t } = useI18n();
	return (
		<SelectMenu
			value={preference}
			options={[
				{ value: "system", label: t("languageSystem"), description: t("languageSystemDescription"), icon: "cpu" },
				{ value: "zh-CN", label: "简体中文", icon: "globe" },
				{ value: "en", label: "English", icon: "globe" },
			]}
			onChange={(value) => setPreference(value as LanguagePreference)}
			label={t("language")}
			icon="globe"
			showValue={false}
			align="right"
			triggerClassName="theme-trigger"
			menuClassName="theme-menu"
		/>
	);
}
