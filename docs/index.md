---
layout: home

hero:
  name: "Fluxify"
  text: "Draw your backend. Ship it as code."
  tagline: Build APIs and background jobs on a visual canvas. Fluxify turns what you draw into fast JavaScript and runs it for you.
  image:
    src: /assets/logo.png
    alt: Fluxify Logo
  actions:
    - theme: brand
      text: Get Started
      link: /getting-started/
    - theme: alt
      text: Run it yourself
      link: /deployments/kit
    - theme: alt
      text: View on GitHub
      link: https://github.com/fluxify-rest/Fluxify

features:
  - icon: 🧩
    title: Visual Builder
    details: Drag blocks onto a canvas and connect them. Conditions, loops, parallel steps and error handling are all blocks, so there is no server boilerplate to write.

  - icon: ⚡
    title: Compiled, Not Interpreted
    details: When you save, your flow is translated to JavaScript once. Every request then runs that code directly in Bun, with no flowchart to walk.

  - icon: 🤖
    title: AI Route Builder
    details: Describe the route you want and the AI assistant places and connects the blocks for you. You review and edit the result on the same canvas. Bring your own model - OpenAI, Anthropic, Gemini, Mistral, or any OpenAI-compatible server.

  - icon: 🗄️
    title: Databases and Caches
    details: Read and write PostgreSQL, MySQL and MongoDB with ready-made blocks, or run your own query. Cache and share state with Redis or Memcached.

  - icon: ⏱️
    title: Workflows, Schedules and Triggers
    details: Run background work on a cron, an interval, a one-off time, or when a message lands on a Redis stream. Kafka, NATS JetStream and Amazon SQS triggers are in the Enterprise edition.

  - icon: 📜
    title: Scripting When You Need It
    details: Drop in JavaScript for anything the blocks do not cover. Scripts get the request, JWT helpers and utility libraries. Package your own blocks to reuse them.

  - icon: 🧪
    title: Built-in Test Suites
    details: Describe a request, check the response, and re-run it after every change. Fake a database call or seed test data without touching production.

  - icon: 📡
    title: Observability
    details: Structured logs to the console, Grafana Loki, or any OpenTelemetry backend.

  - icon: 🚀
    title: Self-Host Anywhere
    details: One container to try it in minutes. Separate admin and scalable workers, or a Helm chart for Kubernetes, when you go to production.
---

::: warning Fluxify is in alpha
It is under active development. Some features are still settling and things can change between releases. Feedback and bug reports are very welcome on [GitHub](https://github.com/fluxify-rest/Fluxify/issues).
:::

::: info Open source, with an Enterprise edition
The core - the editor, routes, workflows, schedules and blocks - is free under the Apache 2.0 license. Single sign-on and the Kafka, NATS and SQS triggers need an Enterprise license. See [Editions and licensing](/deployments/editions).
:::
