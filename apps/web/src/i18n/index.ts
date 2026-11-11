import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import { enGB } from "./en-GB";
import { ptPT } from "./pt-PT";

export const LANGS = ["pt-PT", "en-GB"] as const;
export type Lang = (typeof LANGS)[number];
const STORAGE_KEY = "transitum.lang";

export function currentLang(): Lang {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "en-GB" || saved === "pt-PT") return saved;
  return navigator.language.toLowerCase().startsWith("pt") ? "pt-PT" : "en-GB";
}

export function setLang(lang: Lang) {
  localStorage.setItem(STORAGE_KEY, lang);
  document.documentElement.lang = lang;
  void i18n.changeLanguage(lang);
}

// pt-PT é o idioma por omissão; en-GB disponível (persistido em localStorage)
i18n.use(initReactI18next).init({
  resources: { "pt-PT": ptPT, "en-GB": enGB },
  lng: currentLang(),
  fallbackLng: "pt-PT",
  interpolation: { escapeValue: false },
});
document.documentElement.lang = currentLang();

export default i18n;
