# Examples

Find runnable Browser and Cohesion examples and a small lifecycle-owned stopwatch walkthrough.

> **Status:** Implemented examples use compiled components and the current component model.

## What ships today

The external viu-examples repository contains standalone Browser and Cohesion-hosted showcases,
shared components, routing, forms, state, and server-rendered reports. The SDK templates create
viu-app / viu-lib projects; the platforms templates create viu-cohesion / viu-cohesion-web projects.

Use the version pins and API shapes together. During this PR integration the relevant source is
the feature/ci4-fixes-and-hosting-dx work in each repository; main may still show the earlier train.

## How to read the examples in this documentation

SFC examples compile at build time. A typed root describes a registered component rather than
constructing it; generated catalogs aggregate references. C# fragments assume their named
application types/namespaces are available. Deliberately failing diagnostic examples are labelled.

## Working code you can run

- [Stopwatch](stopwatch.md) — reactive elapsed text and component-owned cancellation.
- [Quick Start](../guide/quick-start.md) — a complete packaged Browser project.
- [The Viu SDK & Build](../guide/scaling-up/sdk-and-build.md) — Cohesion Browser/Web composition.

See the [viu-examples source](https://github.com/assimalign/viu-examples) for larger scenarios and
[Project Status](../roadmap/status.md) for preview limits.
