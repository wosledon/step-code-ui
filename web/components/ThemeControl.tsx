import { useEffect, useState } from "react";
import { useI18n } from "../lib/i18n";
import { readThemePreference, useResolvedTheme, writeThemePreference, type ThemePreference } from "../lib/theme";
import { SelectMenu, type SelectOption } from "./ui";

export function ThemeControl(): React.JSX.Element {
	const { t } = useI18n();
	const [preference, setPreference] = useState<ThemePreference>(readThemePreference);
	const resolved = useResolvedTheme();
	const options: SelectOption[] = [
		{ value: "light", label: t("themeLight"), description: t("themeLightDescription"), icon: "sun" },
		{ value: "dark", label: t("themeDark"), description: t("themeDarkDescription"), icon: "moon" },
		{ value: "system", label: t("themeSystem"), description: t("themeSystemDescription"), icon: "cpu" },
	];

	useEffect(() => {
		writeThemePreference(preference);
	}, [preference]);

	return (
		<SelectMenu
			value={preference}
			options={options}
			onChange={(value) => setPreference(value as ThemePreference)}
			label={t("appearance")}
			icon={resolved === "dark" ? "moon" : "sun"}
			showValue={false}
			align="right"
			triggerClassName="theme-trigger"
			menuClassName="theme-menu"
		/>
	);
}
