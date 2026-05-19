// Type declaration for @vocoder/locales alias resolved by @vocoder/plugin.
// The alias points to the project's committed locales/ directory.
declare module "@vocoder/locales/*.json" {
	const value: Record<string, string>;
	export default value;
}
