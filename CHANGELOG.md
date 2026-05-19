# Changelog

All notable changes to the Vocoder SDK will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-02-11

### Added

#### @vocoder/react
- `<T>` component for translations with JSX-friendly syntax
- `VocoderProvider` for managing translation state and locale switching
- `LocaleSelector` component with customizable positioning and styling
- `t()` function for non-JSX translation contexts
- `useVocoder()` hook for accessing translation context
- Server-side rendering support with cookie-based locale detection
- Three phases of translation support:
  - **Phase 1**: Simple variable interpolation (`{name}`, `{count}`)
  - **Phase 2**: ICU MessageFormat (pluralization, select, number/date formatting)
  - **Phase 3**: Rich text with component placeholders (`<link>text</link>`)
- Static translation generation (build-time approach)
- Locale persistence via cookies and localStorage
- RTL language support (Arabic, Hebrew, etc.)
- Comprehensive TypeScript types with strict mode support

#### @vocoder/cli
- `vocoder translate` command for extracting strings and generating translations
- AST-based extraction using Babel parser
- Glob pattern support for file scanning
- Automatic locale file generation (JSON format)
- Build-time translation generation for CI/CD pipelines

#### @vocoder/types
- Shared TypeScript type definitions for all packages
- `TranslationsMap`, `LocalesMap`, `LocaleInfo` interfaces
- Component prop types for T, VocoderProvider, LocaleSelector

### Documentation
- Comprehensive README with installation and usage examples
- Server-side rendering guide
- Security best practices
- Multiple usage examples

[0.1.0]: https://github.com/vocoder/vocoder-sdk/releases/tag/v0.1.0
