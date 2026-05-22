// Global translate functions bound to the default vocoder singleton from @vocoder/core.
// These read current locale state at call time — not reactive. For reactive translations
// in components, use useVocoder().t or the <T> component instead.
export { t, ordinal } from "@vocoder/core";
