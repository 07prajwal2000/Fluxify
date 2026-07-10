# Fluxify Roadmap

This document outlines the priority features and milestones required to elevate Fluxify into a fully-fledged, production-ready REST API engine. Completing these features will pave the way for the upcoming **AI Agent Harness (Builder Mode)**.

## 1. Request Validation & Schemas ✅
Ensuring that incoming data is structurally sound before any business logic is executed.
- **Schema Builder:** Visual interface to define schemas (e.g., using JSON Schema, Zod, or Joi) for Request Body, Query Parameters, and Headers.
- **Validation Logic:** Automatically reject invalid requests with `400 Bad Request` and structured error messages before they reach the main workflow execution.

## 2. Auto-Generated API Documentation ✅
Crucial for any production API. 
- **OpenAPI / Swagger Generation:** Automatically generate and host a Swagger UI or Redoc portal. The documentation will be driven by the configured routes, inputs (from the Schema Builder), and outputs of the workflows.
- Use https://scalar.com/products/api-references/integrations/react to display the API documentation. Its more modern and interactive than Swagger UI or Redoc.

## 3. Environment-Aware Testing (Integration & Config Swaps) ✅
Safe integration testing and deployments without affecting production data. Since Fluxify relies on robust Test Suites, swapping configurations provides the most powerful testing paradigm without the immense UI overhead of block-level mocking.
- **Environment Profiles:** Define distinct environments (e.g., Production, Staging, Testing) for the project.
- **Integration Swapping:** Allow Databases and external integrations to hold different connection strings per environment. Test Suites can execute safely against a "Testing DB" instead of production.
- **App Config Swapping:** Allow `App Config` variables (like third-party HTTP Client URLs and API secrets) to be overridden in the Testing environment. This automatically points external calls to fake/sandbox endpoints at test time without touching the workflow logic.

## 4. Versioning & API Grouping (Optional for nows)
Organizing and evolving APIs without breaking existing clients.
- **API Grouping & Versioning:** Native support for grouping APIs by a group object or prefix (e.g., `/api/v1/...`, `/api/users/...`).
- **Environment Management:** Staging vs. Production deployment profiles with environment-specific variables and secrets.

## 5. Dedicated Middlewares Section
A dedicated layer for request pre-processing and security.
- **JWT Middleware:** Dedicated UI and middleware section for JWT validation and issuance (replacing the purely programmatic approach).
- **API Key Management (Mandatory):** Generate, revoke, and manage API keys for machine-to-machine integrations.
- **Rate Limiters (Optional):** Optional Redis-backed or in-memory rate limiters to protect endpoints.
- **CORS Configuration (Optional):** Fine-grained Cross-Origin Resource Sharing settings.

## 6. Asynchronous Processing & Message Queues
Offloading heavy tasks and integrating with event-driven architectures.
- **Async Workflows (Mandatory):** Ability to trigger another Fluxify workflow asynchronously (fire-and-forget) and immediately return a `202 Accepted` to the client.
- **Message Queues Integrations (Very Important):** First-class integrations with RabbitMQ, Kafka, or AWS SQS.
- **Background Jobs:** Cron scheduling and execution (Currently WIP).

## 7. Server-Sent Events (SSE) & WebSockets
Real-time streaming capabilities.
- **SSE (Server-Sent Events):** Crucial for AI-specific workflows (e.g., streaming LLM responses back to the client).
- **WebSockets:** Bidirectional real-time communication support.

## 8. Caching Blocks
Performance optimizations within the visual builder.
- **Cache Blocks:** While caching integrations (e.g., Redis) already exist, specific drag-and-drop blocks for `Get Cache`, `Set Cache`, and `Invalidate Cache` need to be added to the workflow builder for ease of use.

## 9. File Handling & Storage (Future / Optional)
Since Fluxify is a pure REST API Engine, this is not a primary focus, but remains on the roadmap for extended use cases.
- **S3 API Integrations:** Blocks for handling file uploads and basic file management via S3-compatible APIs.
