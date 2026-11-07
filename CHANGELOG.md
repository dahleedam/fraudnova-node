# Changelog

All notable changes to this project are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.0.2] - 2026-11-07

### Changed

- `parseRetryAfter()` now accepts an HTTP-date only in the RFC 7231 shapes (IMF-fixdate, RFC 850 and asctime, with asctime read as GMT where 1.0.1 read it as local time); other non-numeric values such as `1.5` or `-1` return `null` instead of `0`
- README: compare `error.name` instead of `instanceof` when both the ESM and CommonJS builds are loaded in one process
- CI and release workflows use `actions/checkout@v5` and `actions/setup-node@v5`

### Fixed

- `IpResult.fromData()`, `EmailResult.fromData()` and `PhoneResult.fromData()` treat non-object data as an empty object instead of throwing

## [1.0.1] - 2026-11-07

### Changed

- No code changes. This is the first version published by the release workflow with an npm provenance attestation; 1.0.0 was published by hand.

## [1.0.0] - 2026-11-07

### Added

- Client for every API endpoint: IP, email and phone checks, the three batch checks, balance and my IP
- Typed results with the `flagged()` and `flagReasons()` helpers
- Typed errors for every API error status
- Opt-in retry of HTTP 429 responses, honouring `Retry-After`
- Batch helpers that chunk requests by 100 items
- Bring-your-own `fetch`

[Unreleased]: https://github.com/dahleedam/fraudnova-node/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/dahleedam/fraudnova-node/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/dahleedam/fraudnova-node/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/dahleedam/fraudnova-node/releases/tag/v1.0.0
