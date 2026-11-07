# Changelog

All notable changes to this project are documented in this file. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.0.0] - 2026-11-07

### Added

- Client for every API endpoint: IP, email and phone checks, the three batch checks, balance and my IP
- Typed results with the `flagged()` and `flagReasons()` helpers
- Typed errors for every API error status
- Opt-in retry of HTTP 429 responses, honouring `Retry-After`
- Batch helpers that chunk requests by 100 items
- Bring-your-own `fetch`

[Unreleased]: https://github.com/dahleedam/fraudnova-node/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/dahleedam/fraudnova-node/releases/tag/v1.0.0
