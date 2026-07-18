import { useTranslation } from "react-i18next";
import { SUPPORTED_LANGUAGES } from "../i18n";

export function LanguageSelector() {
  const { t, i18n } = useTranslation();

  return (
    <select
      className="language-selector"
      value={i18n.language}
      onChange={(event) => i18n.changeLanguage(event.target.value)}
      aria-label={t("topbar.languageSelector")}
    >
      {SUPPORTED_LANGUAGES.map((language) => (
        <option key={language.code} value={language.code}>
          {language.label}
        </option>
      ))}
    </select>
  );
}
