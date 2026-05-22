// Core exports (no UI dependencies)
export { generateMessageHash, vocoder, createVocoder } from "@vocoder/core";
export type { VocoderCore, LocaleLoader } from "@vocoder/core";
export { PREVIEW_MODE, isPreviewEnabled, isVocoderEnabled } from "./preview";
export { T } from "./T";
export { ordinal, t } from "./translate";
// Type exports
export type {
	ComponentSlot,
	FormatMode,
	LocaleInfo,
	LocaleManifest,
	LocaleManifestEntry,
	LocaleSelectorProps,
	LocalesMap,
	TOptions,
	TProps,
	TranslationsMap,
	VocoderContextValue,
	VocoderProviderProps,
} from "./types";
export { useVocoder, VocoderContext, VocoderProvider } from "./VocoderProvider";
